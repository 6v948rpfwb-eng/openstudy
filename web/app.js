/**
 * app.js —— 网页界面
 *
 * 三种模式：
 *   1. 直接双击 dist/openstudy.html（引擎已内联）
 *   2. 用 http 打开本目录（引擎从 ../core 加载）
 *   3. 把题库 JSON 拖进页面
 */

import {
  loadBank, validateBank,
  composePaper,
  grade,
  emptyState, finishSession, dueTopics, topicMastery, migrateState,
  describeTheta, predictPass,
} from '../core/index.js'
import { renderMathText } from '../core/math.js'
import { loadForTopic } from '../core/framework.js'
import { mountMascot, mascotSay, mascotOnAnswer, mascotOnSessionStart, mascotOnSessionEnd, mascotSetActive, mascotGreetOnce } from './mascot.js'

const $root = document.getElementById('root')
const KEY = (subject) => `openstudy.state.${subject}`

const app = {
  opts: loadOpts(),
  bank: null,
  warnings: [],
  state: null,
  paper: null,
  index: 0,
  answers: [],
  phase: 'load',   // load | ready | practice | done
  current: null,   // 当前题的临时作答
  report: null,
  mode: 'paper',   // paper = 一次做完固定题数；endless = 做一题结算一题
  endless: null,
}

const isEndless = () => app.mode === 'endless'

// ---------- 方法论视图（四组 + 三张表） ----------
// 双击单文件时，build.js 把 tools/topics-*.json 内联成常量 __FRAMEWORK_DOCS__；
// 用 http 打开 index.html 时没有这个常量，标签页自动隐藏，练习功能不受影响。
const FW_DOCS = (typeof __FRAMEWORK_DOCS__ !== 'undefined') ? __FRAMEWORK_DOCS__ : {}
const FW_SUBJECTS = Object.keys(FW_DOCS)
const FST_CLASS = (s) => (s === '✅' ? 'ok' : s === '🟡' ? 'mid' : s === '🔴' ? 'bad' : 'none')
const fwEsc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

app.view = 'practice'                                  // practice | framework
app.fw = { subject: FW_SUBJECTS[0] || '', group: 'all', only: 'all' }
// 地址栏 hash：`#framework` 落在方法论页，`#subject=chemistry` 直接进化学。
// 两者可组合：`#framework&subject=chemistry`
function pageParams() {
  if (typeof location === 'undefined') return {}
  const out = {}
  // 查问号后面的（?subject=chemistry）——`open` 命令常把 # 后面的片段丢掉，查问号更可靠
  const search = (location.search || '').replace(/^\?/, '')
  for (const kv of search.split('&')) {
    if (!kv) continue
    const i = kv.indexOf('=')
    if (i > 0) out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1))
  }
  // 再看 # 后面的（#framework / #subject=chemistry / #framework&subject=chemistry）
  for (const kv of (location.hash || '').replace(/^#/, '').split('&')) {
    if (!kv) continue
    const i = kv.indexOf('=')
    if (i < 0) out[kv] = true
    else out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1))
  }
  return out
}
const hashNow = pageParams()
if (FW_SUBJECTS.length && (hashNow.framework || hashNow.view === 'framework')) app.view = 'framework'
if (FW_SUBJECTS.length && (hashNow.map || hashNow.view === 'map')) app.view = 'map'
let pendingSubject = typeof hashNow.subject === 'string' ? hashNow.subject : null
// 没在地址栏指定学科时，沿用上次切的学科（换学科是习惯，不该每次回默认）
if (!pendingSubject) {
  try { pendingSubject = localStorage.getItem('openstudy.lastSubject') } catch (e) { /* 隐私模式忽略 */ }
}

/** 把当前视图与学科写回地址栏（file:// 下改 hash 不会重新加载页面） */
function syncHash() {
  if (typeof history === 'undefined' || !history.replaceState) return
  const parts = []
  if (app.view === 'framework') parts.push('framework')
  else if (app.view === 'map') parts.push('map')
  const sub = app.bank ? app.bank.subject : ''
  if (sub) parts.push('subject=' + encodeURIComponent(sub))
  try { history.replaceState(null, '', '#' + parts.join('&')) } catch (e) { /* file:// 某些情况不让改，忽略 */ }
}
// 地址栏改 hash 时原地切换（file:// 下改 hash 不会重新加载页面）
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const h = pageParams()
    const v = (h.framework || h.view === 'framework') ? 'framework'
      : (h.map || h.view === 'map') ? 'map' : 'practice'
    if (h.subject && BANKS && BANKS[h.subject] && app.bank && app.bank.subject !== h.subject) {
      switchBank(h.subject)
      return
    }
    if (v !== app.view) { app.view = v; render() }
  })
}

// ---------- 右上角学科切换 ----------
// 构建时把多个 --bank 内联成 __EMBEDDED_BANKS__（key = 题库 subject，值是题目 JSON 文本）。
// 只有一个学科时不显示切换按钮。
const BANKS = (typeof __EMBEDDED_BANKS__ !== 'undefined' && __EMBEDDED_BANKS__) ? __EMBEDDED_BANKS__ : null
const BANK_KEYS = BANKS ? Object.keys(BANKS) : []
const SUBJECT_LABEL = { physics: '物理', chemistry: '化学', technology: '技术', math: '数学', chinese: '语文', english: '英语' }

function bankTitle(key) {
  try { return JSON.parse(BANKS[key]).title || SUBJECT_LABEL[key] || key } catch (e) { return SUBJECT_LABEL[key] || key }
}

function renderSubjects() {
  const box = document.getElementById('subjects')
  if (!box) return
  if (BANK_KEYS.length < 2) { box.innerHTML = ''; return }
  const cur = app.bank ? app.bank.subject : ''
  box.innerHTML = BANK_KEYS.map((k) =>
    `<button class="subj ${k === cur ? 'on' : ''}" data-bank="${k}">${bankTitle(k)}</button>`).join('')
  box.querySelectorAll('[data-bank]').forEach((b) => {
    b.onclick = () => switchBank(b.dataset.bank)
  })
  // 地址栏指定了学科：等题库加载完再切（题库是异步/自动加载的）
  if (pendingSubject) {
    const want = pendingSubject
    pendingSubject = null
    if (BANKS[want] && (!app.bank || app.bank.subject !== want)) { switchBank(want); return }
  }
}

/** 换学科：题库、存档、做卷进度全部换掉，方法论视图跟着切 */
function switchBank(key) {
  if (!BANKS || !BANKS[key]) return
  if (app.bank && app.bank.subject === key) return
  app.paper = null
  app.index = 0
  app.answers = []
  app.current = null
  app.report = null
  app.endless = null
  app.phase = 'load'
  if (FW_DOCS[key]) app.fw.subject = key
  useBankText(BANKS[key], key)
  try { localStorage.setItem('openstudy.lastSubject', key) } catch (e) { /* 忽略 */ }
  syncHash()
}

function renderTabs() {
  const bar = document.getElementById('tabs')
  if (!bar) return
  if (!FW_SUBJECTS.length) { bar.innerHTML = ''; return }
  bar.innerHTML = `
    <button class="tab ${app.view === 'practice' ? 'on' : ''}" data-v="practice">练习</button>
    <button class="tab ${app.view === 'framework' ? 'on' : ''}" data-v="framework">方法论</button>
    <button class="tab ${app.view === 'map' ? 'on' : ''}" data-v="map">知识图</button>`
  bar.querySelectorAll('.tab').forEach((b) => {
    b.onclick = () => {
      app.view = b.dataset.v
      syncHash()
      render()
    }
  })
}

function renderFramework() {
  // 默认看本页题库所属学科的方法论（物理页先给物理，化学页先给化学）
  if (app.bank && FW_DOCS[app.bank.subject] && app.bank.subject !== app.fw.subject) app.fw.subject = app.bank.subject
  const doc = FW_DOCS[app.fw.subject]
  if (!doc) { $root.innerHTML = '<div class="card">没有方法论数据</div>'; return }

  const topics = Object.entries(doc.topics)
  const byGroup = {}
  let tested = 0
  for (const [, t] of topics) {
    byGroup[t.group] = (byGroup[t.group] || 0) + 1
    if (t.state) tested++
  }

  const subjectChips = FW_SUBJECTS.length > 1
    ? `<div class="fchips">${FW_SUBJECTS.map((k) => `<button class="fchip ${k === app.fw.subject ? 'on' : ''}" data-sub="${k}">${fwEsc(FW_DOCS[k].title || k)}</button>`).join('')}</div>`
    : ''

  const groups = Object.entries(doc.groups).map(([g, info]) => `
    <details class="gcard">
      <summary><span class="gbadge b${g}">${g}</span>${fwEsc(info.label)}
        <span class="muted">${byGroup[g] || 0} 个考点</span></summary>
      <div class="muted" style="margin-top:8px">动作序列（表 2）</div>
      <ol>${info.steps.map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ol>
      <div class="muted" style="margin-top:8px">必查项（表 3）</div>
      <ul>${info.checks.map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ul>
    </details>`).join('')

  const GROUPS = [['all', '全部组'], ['A', 'A 条件→方程→边界'], ['B', 'B 证据→判断'], ['C', 'C 触发→精确复现'], ['D', 'D 骨架→成文']]
  const ONLYS = [['all', '全部状态'], ['tested', '只看已测'], ['bad', '只看未掌握']]
  const chips = (items, cur, kind) => items.map(([k, label]) =>
    `<button class="fchip ${cur === k ? 'on' : ''}" data-${kind}="${k}">${label}</button>`).join('')

  const rows = topics.filter(([, t]) => {
    if (app.fw.group !== 'all' && t.group !== app.fw.group) return false
    if (app.fw.only === 'tested' && !t.state) return false
    if (app.fw.only === 'bad' && t.state !== '🔴') return false
    return true
  }).map(([id, t]) => {
    const view = loadForTopic(doc, id)
    const steps = view ? view.steps : []
    const checks = view ? view.checks : []
    return `
      <details class="fwcard">
        <summary><span class="gbadge b${t.group}">${t.group}</span>${fwEsc(t.name)}
          <span class="fst ${FST_CLASS(t.state)}">${t.state || '未测'}</span>
          ${t.errorType ? `<span class="tag">${fwEsc(t.errorType)}</span>` : ''}
          <span class="muted">${fwEsc(t.alias || id)}</span></summary>
        ${t.cues && t.cues.length ? `<div class="cues">${t.cues.map((c) => `<span class="cue">${fwEsc(c)}</span>`).join('')}</div>` : ''}
        <div class="muted" style="margin-top:8px">动作序列</div>
        <ol>${steps.map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ol>
        <div class="muted" style="margin-top:8px">必查项</div>
        <ul>${checks.map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ul>
      </details>`
  }).join('')

  $root.innerHTML = `
    <div class="card">
      <div><strong>${fwEsc(doc.title || app.fw.subject)} · 四组方法论与三张表</strong></div>
      <div class="muted" style="margin-top:4px">考点 ${topics.length} · 已测 ${tested} · 判据形状 / 动作序列 / 检验方式 三者相同才同组</div>
      <div class="muted" style="margin-top:4px">A 条件→方程→边界 · B 证据→判断 · C 触发→精确复现 · D 骨架→成文</div>
      ${subjectChips}
    </div>
    ${groups}
    <div class="fchips">${chips(GROUPS, app.fw.group, 'group')}</div>
    <div class="fchips">${chips(ONLYS, app.fw.only, 'only')}</div>
    ${rows || '<div class="card muted">没有符合条件的考点</div>'}
    <p class="muted" style="margin-top:16px">点标题展开动作序列与必查项；必查项里带具体错题坑的，是从你的真实错题补的。</p>`

  $root.querySelectorAll('[data-sub]').forEach((b) => {
    b.onclick = () => { app.fw.subject = b.dataset.sub; render() }
  })
  $root.querySelectorAll('[data-group]').forEach((b) => {
    b.onclick = () => { app.fw.group = b.dataset.group; render() }
  })
  $root.querySelectorAll('[data-only]').forEach((b) => {
    b.onclick = () => { app.fw.only = b.dataset.only; render() }
  })
}

// ---------- 存档 ----------
function saveState(attempt) {
  if (!app.bank) return
  try {
    localStorage.setItem(KEY(app.bank.subject), JSON.stringify(app.state))
  } catch (e) {
    console.warn('存档失败', e)
  }
  pushRemote(app.state, attempt || null)
}

// ---------- 和本地服务器（serve.js）对账 ----------
// 没有服务器时全部静默跳过，行为和以前一样：只用 localStorage。
// 用 file:// 直接双击打开时 API_BASE 为 null，不会去 fetch 一个不存在的接口。
const API_BASE = (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) ? '' : null

async function pushRemote(state, attempt) {
  if (API_BASE === null || !state || !state.subject) return
  try {
    await fetch(`${API_BASE}/api/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: state.subject, state, attempt }),
    })
  } catch { /* 服务器不在，只存本地 */ }
}

async function pullRemote(subject) {
  if (API_BASE === null) return null
  try {
    const r = await fetch(`${API_BASE}/api/state?subject=${encodeURIComponent(subject)}`)
    if (!r.ok) return null
    const j = await r.json()
    return j && j.state ? j.state : null
  } catch { return null }
}

async function sendQuestion(payload) {
  if (API_BASE === null) return { ok: false, reason: 'offline' }
  try {
    const r = await fetch(`${API_BASE}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) return { ok: false, reason: 'bad' }
    return { ok: true }
  } catch { return { ok: false, reason: 'offline' } }
}
/** 组卷偏好：默认跳过《知识状态库》里已掌握的考点 */
function loadOpts() {
  try {
    const raw = localStorage.getItem('openstudy.opts')
    if (raw) return { skipMastered: true, ...JSON.parse(raw) }
  } catch (e) { /* 隐私模式忽略 */ }
  return { skipMastered: true }
}
function saveOpts() {
  try { localStorage.setItem('openstudy.opts', JSON.stringify(app.opts)) } catch (e) { /* 忽略 */ }
}

function loadState(subject) {
  try {
    const raw = localStorage.getItem(KEY(subject))
    if (!raw) return null
    const s = JSON.parse(raw)
    // 不在这里判版本：旧存档由 migrateState 补齐字段，见 useBankText
    return s && typeof s === 'object' ? s : null
  } catch { return null }
}

// ---------- 载入题库 ----------
function useBankText(text, name) {
  const res = validateBank(JSON.parse(text))
  if (!res.ok) {
    alert(`题库「${name}」有问题：\n\n` + res.errors.join('\n'))
    return
  }
  app.bank = res.bank
  app.warnings = res.warnings
  app.state = loadState(app.bank.subject) ?? emptyState(app.bank.subject)
  migrateState(app.state)
  app.phase = 'ready'
  render()
  mascotGreetOnce()

  // 后台跟本地服务器对一次账：服务器上的记录更全就换成服务器的
  pullRemote(app.bank.subject).then((remote) => {
    if (!remote) return
    const localN = (app.state.log || []).length
    const remoteN = (remote.log || []).length
    if (remoteN > localN) {
      app.state = remote
      migrateState(app.state)
      try { localStorage.setItem(KEY(app.bank.subject), JSON.stringify(app.state)) } catch { /* 忽略 */ }
      if (app.phase === 'ready') render()
    }
  })
}

async function tryAutoLoad() {
  // 单文件构建产物：题库已在构建时选定并内联，直接用。
  // 不能先去 fetch —— 用 http 打开时 ../data/example.bank.json 也在，
  // 会把真题顶掉、换成 9 道示例题（2026-10-22 修）。
  if (typeof __EMBEDDED_BANK__ !== 'undefined' && __EMBEDDED_BANK__) {
    useBankText(__EMBEDDED_BANK__, '内置题库')
    return true
  }

  // 开发模式（web/index.html，无内联）：从 ../data 读示例题库
  try {
    const r = await fetch('../data/example.bank.json')
    if (r.ok) { useBankText(await r.text(), 'example.bank.json'); return true }
  } catch { /* file:// 下 fetch 被拦，正常 */ }
  return false
}

// ---------- 知识点图视图 ----------
// 数据来自同一份 topics-*.json 的 graph 字段：
//   modules = [{ id, label, topics: [编号…] }]  每列 = 一块知识，列内按数组顺序学
//   edges   = [[起点, 终点], …]                跨列的前提关系
// 列内自动连成一条向下的链；跨列画曲线。节点状态直接读考点表的 state。
app.map = { cur: null }

function renderMap() {
  if (app.bank && FW_DOCS[app.bank.subject] && app.bank.subject !== app.fw.subject) app.fw.subject = app.bank.subject
  const doc = FW_DOCS[app.fw.subject]
  const graph = doc && doc.graph
  if (!graph || !graph.modules || !graph.modules.length) {
    $root.innerHTML = '<div class="card">这个学科还没有知识点图</div>'
    return
  }

  const COL_W = 178, NODE_H = 44, GAP = 14, PAD = 12, TOP = 36, NW = 162
  const topics = doc.topics
  const pos = new Map()
  graph.modules.forEach((m, ci) => {
    m.topics.forEach((tid, ri) => {
      pos.set(tid, { x: PAD + ci * COL_W, y: TOP + ri * (NODE_H + GAP), module: m.id })
    })
  })
  const maxRows = Math.max(...graph.modules.map((m) => m.topics.length))
  const W = PAD * 2 + graph.modules.length * COL_W
  const H = TOP + maxRows * (NODE_H + GAP) + 20

  let svg = `<svg class="kmap" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
  graph.modules.forEach((m, ci) => {
    svg += `<text class="kmap-col" x="${PAD + ci * COL_W}" y="24">${fwEsc(m.label)}</text>`
  })
  graph.modules.forEach((m) => {
    for (let i = 0; i + 1 < m.topics.length; i++) {
      const a = pos.get(m.topics[i]), b = pos.get(m.topics[i + 1])
      if (!a || !b) continue
      svg += `<path class="kmap-link" d="M${a.x + NW / 2} ${a.y + NODE_H} L${b.x + NW / 2} ${b.y}"/>`
    }
  })
  for (const [from, to] of graph.edges || []) {
    const a = pos.get(from), b = pos.get(to)
    if (!a || !b) continue
    const x1 = a.x + (b.x > a.x ? NW : NW / 2), y1 = a.y + NODE_H / 2
    const x2 = b.x + (b.x > a.x ? 0 : NW / 2), y2 = b.y + NODE_H / 2
    const dx = Math.max(40, Math.abs(x2 - x1) / 2)
    svg += `<path class="kmap-edge${b.x > a.x ? '' : ' back'}" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"/>`
  }
  for (const [tid, p] of pos) {
    const t = topics[tid]
    if (!t) continue
    const st = t.state === '✅' ? 'ok' : t.state === '🟡' ? 'mid' : t.state === '🔴' ? 'bad' : 'none'
    const full = String(t.name || tid)
    const maxLen = 14
    const label = full.length > maxLen ? full.slice(0, maxLen) + '…' : full
    svg += `<g class="knode g${t.group || 'x'} st-${st}${app.map.cur === tid ? ' on' : ''}" data-t="${fwEsc(tid)}" transform="translate(${p.x},${p.y})">`
    svg += `<rect class="kbox" width="${NW}" height="${NODE_H}" rx="10"/>`
    svg += `<text class="kid" x="10" y="16">${fwEsc(tid)}</text>`
    svg += `<text class="kname" x="10" y="33">${fwEsc(label)}</text>`
    if (st !== 'none') svg += `<circle class="kdot" cx="${NW - 12}" cy="12" r="4"/>`
    svg += `</g>`
  }
  svg += '</svg>'

  const cur = app.map.cur && topics[app.map.cur] ? app.map.cur : null
  const detail = cur ? `
    <div class="card kdetail">
      <div class="row"><b>${fwEsc(cur)} · ${fwEsc(topics[cur].name)}</b>
        <span class="fst ${FST_CLASS(topics[cur].state)}">${fwEsc(topics[cur].state || '未测')}</span></div>
      <div class="muted" style="margin-top:6px">判据（表 1）：${(topics[cur].cues || []).length ? fwEsc((topics[cur].cues || []).join('、')) : '还没写'}</div>
      <div class="muted" style="margin-top:8px">动作序列（表 2 = 组级 + 本题补充）</div>
      <ol>${groupStepsFor(doc, cur).map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ol>
      <div class="muted" style="margin-top:8px">必查项（表 3）</div>
      <ul>${checksFor(doc, cur).map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ul>
    </div>` : `<div class="muted" style="margin:10px 0 0 2px">点方块看它的判据、动作序列、必查项。</div>`

  const legend = `<div class="klegend">
    <span><i class="lg gA"></i>A 条件→方程</span><span><i class="lg gB"></i>B 证据→判断</span>
    <span><i class="lg gC"></i>C 触发→复现</span><span><i class="lg gD"></i>D 骨架→成文</span>
    <span class="sep"></span><span><i class="dot ok"></i>已会</span><span><i class="dot mid"></i>待确认</span>
    <span><i class="dot bad"></i>没做出来</span><span><i class="dot none"></i>没测</span></div>`

  $root.innerHTML = `<div class="card">
      <div class="row"><b>${fwEsc(doc.title || app.fw.subject)} · 知识点图</b>
        <span class="muted">${graph.modules.length} 块、${pos.size} 个考点、${(graph.edges || []).length} 条跨块连线</span></div>
      ${legend}
      <div class="mapwrap">${svg}</div>
    </div>${detail}`

  $root.querySelectorAll('.knode').forEach((g) => {
    g.onclick = () => { app.map.cur = g.dataset.t; renderMap() }
  })
}

// ---------- 渲染 ----------
function render() {
  mountMascot()
  mascotSetActive(app.phase === 'practice')
  renderSubjects()
  renderTabs()
  if (app.view === 'framework') return renderFramework()
  if (app.view === 'map') return renderMap()
  if (app.phase === 'load') return renderLoad()
  if (app.phase === 'ready') return renderReady()
  if (app.phase === 'practice') return renderPractice()
  if (app.phase === 'done') return isEndless() ? renderEndlessDone() : renderDone()
}

function renderLoad() {
  $root.innerHTML = `
    <div class="card">
      <div class="drop" id="drop">
        把题库 JSON 拖到这里<br><br>
        或者 <button class="btn ghost" id="pick" style="margin-top:6px">选择文件</button>
        <input type="file" id="file" accept=".json,application/json" hidden>
      </div>
      <p class="muted" style="margin-top:14px">
        题库格式见 <code>docs/格式说明.md</code>。每道题必须有 <code>source</code>（出处），否则会被拒绝加载。
      </p>
    </div>`

  const pick = (text, name) => {
    try { useBankText(text, name) } catch (e) { alert('解析失败：' + e.message) }
  }

  document.getElementById('pick').onclick = () => document.getElementById('file').click()
  document.getElementById('file').onchange = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    f.text().then((t) => pick(t, f.name))
  }

  const drop = document.getElementById('drop')
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over') }
  drop.ondragleave = () => drop.classList.remove('over')
  drop.ondrop = (e) => {
    e.preventDefault(); drop.classList.remove('over')
    const f = e.dataTransfer?.files?.[0]
    if (f) f.text().then((t) => pick(t, f.name))
  }

  tryAutoLoad()
}

/** 已掌握（且当时没做错）的考点与题数 —— 这些默认不再出 */
function masteredView(bank) {
  const topics = Object.entries(bank.topics).filter(([, t]) => t.mastered === true && t.retry !== true)
  const ids = new Set(topics.map(([id]) => id))
  const questions = bank.questions.filter((q) => ids.has(q.topic))
  return { topics, questions }
}

function renderReady() {
  const { bank, state } = app
  const mastered = masteredView(bank)
  const due = dueTopics(state, bank)
  const topicRows = Object.entries(bank.topics).map(([id, t]) => {
    const rec = state.topics[id]
    const kb = t.state === '✅' ? '✅ 已会' : t.state === '🔴' ? '🔴 错的' : t.state === '🟡' ? '🟡 待确认' : '⬜ 没测'
    return `<tr>
      <td>${id}</td><td>${t.name}</td>
      <td class="muted" title="${(t.stateDetail || '').replace(/"/g, '')}">${kb}</td>
      <td>${rec ? `${rec.correct}/${rec.attempts}` : '—'}</td>
      <td>${rec ? Math.round(topicMastery(rec) * 100) + '%' : '—'}</td>
      <td>${rec?.dueAt ? daysUntil(rec.dueAt) : '—'}</td>
    </tr>`
  }).join('')

  $root.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <b>${bank.title}</b>
          <div class="muted">${Object.keys(bank.topics).length} 个考点 · ${bank.questions.length} 道题</div>
        </div>
        <button class="btn plain" id="reset">重置进度</button>
      </div>
      <div class="stat">
        <div><b>${state.theta.toFixed(2)}</b>能力 θ</div>
        <div><b>${describeTheta(state.theta)}</b>水平</div>
        <div><b>${state.log.length}</b>练过场次</div>
        <div><b>${due.length}</b>到期考点</div>
      </div>
      ${app.warnings.length ? `<p class="muted" style="margin-top:12px">题库提醒：${app.warnings.slice(0, 3).join('；')}${app.warnings.length > 3 ? ' …' : ''}</p>` : ''}
    </div>

    ${due.length ? `<div class="card">
      <b>该复习了</b>
      <p class="muted" style="margin:6px 0 0">
        ${due.map((d) => `<span class="tag due">${d.name} 逾期 ${d.lateDays} 天</span>`).join('')}
      </p>
    </div>` : ''}

    <div class="card">
      <div class="row">
        <span class="muted">题数</span>
        <select id="n" style="padding:8px;border-radius:8px;border:1px solid var(--line);font:inherit">
          <option value="8">8 题（约 5 分钟）</option>
          <option value="12" selected>12 题（约 8 分钟）</option>
          <option value="20">20 题（约 15 分钟）</option>
          <option value="0">不限（做一题结算一题，随时停）</option>
        </select>
        <button class="btn" id="start">开始练习</button>
      </div>
      <label class="switch">
        <input type="checkbox" id="skipMastered" ${app.opts.skipMastered ? 'checked' : ''}>
        <span>只为没掌握的考点出题</span>
      </label>
      <p class="muted" style="margin:6px 0 0">
        依据《知识状态库》：已掌握 ${mastered.topics.length} 个考点（${mastered.questions.length} 道题）默认不出；
        当时没做出来的（🔴）照样出，🟡 待确认的也出。
      </p>
    </div>

    <div class="card">
      <b>各考点</b>
      <table><thead><tr><th>编号</th><th>考点</th><th>知识状态</th><th>对/做</th><th>掌握度</th><th>下次</th></tr></thead>
      <tbody>${topicRows}</tbody></table>
    </div>`

  document.getElementById('start').onclick = () => startSession(Number(document.getElementById('n').value))
  const skip = document.getElementById('skipMastered')
  if (skip) skip.onchange = () => { app.opts.skipMastered = skip.checked; saveOpts(); render() }
  document.getElementById('reset').onclick = () => {
    if (!confirm('确定清空这个学科的进度？')) return
    localStorage.removeItem(KEY(bank.subject))
    app.state = emptyState(bank.subject)
    render()
  }
}

function startSession(n) {
  if (!n) return startEndless()
  app.mode = 'paper'
  const { picked, meta } = composePaper(app.bank, {
    theta: app.state.theta,
    n,
    progress: app.state,
    skipMastered: app.opts.skipMastered,
  })
  if (!picked.length) {
    // 开了「只为没掌握的考点出题」，但这科的题全在已掌握考点里
    mascotSay('这科的题你都会了。想练就把上面那个开关关掉', 'think', 7)
    return
  }
  app.paper = { questions: picked, meta }
  app.index = 0
  app.answers = []
  app.phase = 'practice'
  mascotOnSessionStart()
  nextQuestion()
}

// ---------- 不限模式：做一题、结算一题 ----------
function startEndless() {
  app.mode = 'endless'
  app.endless = { asked: 0, correct: 0, thetaStart: app.state.theta, drawn: new Set(), topicTally: {} }
  app.paper = { questions: [], meta: null }
  app.index = 0
  app.answers = []
  app.phase = 'practice'
  mascotOnSessionStart()
  drawNextEndless()
}

/** 按当前 θ 抽下一道；同一场里尽量不重复出已经出过的题 */
function drawNextEndless() {
  let picked = null
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = composePaper(app.bank, { theta: app.state.theta, n: 1, progress: app.state, skipMastered: app.opts.skipMastered })
    const cand = res.picked[0]
    if (!cand) break
    picked = cand
    if (!app.endless.drawn.has(cand.id)) break
  }
  if (!picked) return finishEndless()
  app.endless.drawn.add(picked.id)
  app.paper.questions.push(picked)
  app.index = app.paper.questions.length - 1
  app.current = { input: '', picked: null, selfGrade: null, graded: null }
  render()
}

/** 一道题刚记完，就地把这一道结算掉 —— θ 立刻更新并存盘 */
function settleEndless() {
  const a = app.answers[app.answers.length - 1]
  if (!a) return
  if (a.countsForTheta) {
    const { state, report } = finishSession(app.state, app.bank, [a])
    app.state = state
    for (const t of report.topicUpdates) {
      const k = t.name
      app.endless.topicTally[k] = app.endless.topicTally[k] || { name: k, asked: 0, correct: 0 }
      app.endless.topicTally[k].asked += t.asked
      app.endless.topicTally[k].correct += t.correct
    }
  }
  app.endless.asked++
  if (a.correct) app.endless.correct++
  saveState({
    mode: 'endless',
    questionId: a.question.id,
    topic: a.question.topic,
    type: a.question.type,
    correct: a.correct,
    counted: !!a.countsForTheta,
    difficulty: a.question.difficulty,
  })
}

function finishEndless() {
  app.phase = 'done'
  render()
}

function nextQuestion() {
  if (app.index >= app.paper.questions.length) return finish()
  app.current = { input: '', picked: null, selfGrade: null, graded: null }
  render()
}

function renderPractice() {
  const q = app.paper.questions[app.index]
  const total = app.paper.questions.length
  const pct = isEndless() ? null : (app.index / total) * 100
  const c = app.current

  let inputArea = ''
  if (q.type === 'numeric') {
    inputArea = `<input type="text" id="ans" placeholder="填数值，可带单位" autocomplete="off"
      value="${escapeAttr(c.input)}" ${c.graded ? 'disabled' : ''}>`
  } else if (q.type === 'choice') {
    inputArea = q.choices.map((ch, i) => {
      let cls = 'choice'
      if (c.graded) {
        const correct = q.answer.value.includes(i)
        if (correct) cls += ' right'
        else if (c.picked === i) cls += ' wrong'
      } else if (c.picked === i) cls += ' picked'
      return `<button class="${cls}" data-i="${i}" ${c.graded ? 'disabled' : ''}>${'ABCDEFG'[i]}. ${renderMathText(ch)}</button>`
    }).join('')
  } else {
    inputArea = `<textarea id="ans" rows="4" placeholder="写下你的思路"
      style="width:100%;padding:11px 13px;font:inherit;border:1px solid var(--line);border-radius:10px;background:#fdfcfa"
      ${c.graded ? 'disabled' : ''}>${escapeHtml(c.input)}</textarea>`
  }

  let feedback = ''
  if (c.graded) {
    if (q.type === 'text') {
      feedback = `<div class="feedback ok">
        <b>参考答案</b>
        <div class="sol">${renderMathText(q.answer.reference ?? '（题库没写参考答案）')}</div>
        ${q.solution ? `<div class="sol" style="margin-top:10px">解析：${renderMathText(q.solution)}</div>` : ''}
        <div style="margin-top:12px" class="row">
          <span class="muted">自己判：</span>
          <button class="btn ghost" data-self="full">对了</button>
          <button class="btn ghost" data-self="half">半对</button>
          <button class="btn ghost" data-self="none">错了</button>
        </div>
      </div>`
    } else {
      const ok = c.graded.correct
      feedback = `<div class="feedback ${ok ? 'ok' : 'no'}">
        <b>${ok ? '对' : '错'}</b>
        ${c.graded.reason ? `<div class="sol">${renderMathText(c.graded.reason)}</div>` : ''}
        ${q.solution ? `<div class="sol">解析：${renderMathText(q.solution)}</div>` : ''}
      </div>`
    }
  }

  const canSubmit = q.type === 'text'
    ? true
    : c.picked !== null || c.input.trim() !== ''

  // 题目配图：figure 可能是字符串，也可能是字符串数组
  const figList = q.figure ? (Array.isArray(q.figure) ? q.figure : [q.figure]) : []
  const figureHtml = figList.length
    ? `<div class="figbox">${figList.map((src) => `<img class="fig" src="${escapeAttr(src)}" alt="题目配图">`).join('')}</div>`
    : ''

  // 原文有图、但题库没收到这张图：明确提示，别让人对着 [图 …] 那行文字硬猜
  const missingFigure = !figList.length && /\[图[：: ]/.test(q.stem || '')
  const figureNote = missingFigure
    ? `<div class="fignote">原题这里有图，题库只收到文字描述。若某个选项必须看图才能判断，做完把它标成「不会」——那是缺图，不是你的错。</div>`
    : ''

  // 这题以前做过几次？0 = 新题。做过的话答对只算一半证据（见 core/state.js）
  const seenTimes = app.state?.seen?.[q.id]?.times ?? 0
  const freshTag = seenTimes === 0
    ? `<span class="tag ok" title="没做过：答对算完整证据">新题</span>`
    : `<span class="tag due" title="做过 ${seenTimes} 次：答对只算 1/${seenTimes + 1} 证据">复习 · 做过 ${seenTimes} 次</span>`

  $root.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <span class="muted">${isEndless() ? `第 ${app.index + 1} 题 · 不限` : `第 ${app.index + 1} / ${total} 题`} ${freshTag}</span>
        <span class="muted">难度 ${q.difficulty.toFixed(2)} · 预测通过 ${(predictPass(app.state.theta, q.difficulty) * 100).toFixed(0)}%</span>
      </div>
      ${isEndless() ? '' : `<div class="progress"><i style="width:${pct}%"></i></div>`}
      <p class="stem" style="margin-top:16px">${renderMathText(q.stem)}</p>
      ${figureHtml}${figureNote}
      ${inputArea}
      ${feedback}
      <div class="row" style="margin-top:16px">
        ${c.graded
          ? `<button class="btn" id="next">${isEndless() ? '下一题' : (app.index + 1 === total ? '交卷' : '下一题')}</button>`
            + (isEndless() ? `<button class="btn plain" id="stop" style="margin-left:8px">结束</button>` : '')
          : `<button class="btn" id="submit" ${canSubmit ? '' : 'disabled'}>提交</button>`}
      </div>
      <details class="askbox">
        <summary>这题想问</summary>
        <textarea id="asktext" rows="3" placeholder="想问什么？比如：为什么 B 不对、这一步怎么来的"></textarea>
        <div class="row" style="margin-top:8px">
          <button class="btn plain" id="askbtn">记进提问队列</button>
          <span class="muted" id="askmsg"></span>
        </div>
      </details>
    </div>`

  const askBtn = document.getElementById('askbtn')
  if (askBtn) {
    askBtn.onclick = async () => {
      const ta = document.getElementById('asktext')
      const msg = document.getElementById('askmsg')
      const text = (ta?.value || '').trim()
      if (!text) { if (msg) msg.textContent = '先写点什么'; return }
      const q = app.paper.questions[app.index]
      if (msg) msg.textContent = '记录中…'
      const r = await sendQuestion({
        subject: app.bank?.subject,
        questionId: q?.id,
        stem: q?.stem,
        myAnswer: c.graded ? (app.current.picked ?? app.current.input ?? '') : null,
        correct: c.graded ? c.graded.correct : null,
        reference: q?.answer?.reference ?? null,
        message: text,
      })
      if (msg) {
        msg.textContent = r.ok
          ? '已记下。回到对话里说「看看提问队列」，我就能看到。'
          : '没连上本地服务器，这次没记下（用 打开练习.sh 启动才有服务器）'
      }
      if (r.ok && ta) ta.value = ''
    }
  }

  const ansEl = document.getElementById('ans')
  if (ansEl && !c.graded) {
    ansEl.oninput = (e) => { app.current.input = e.target.value }
    if (q.type === 'numeric') {
      ansEl.onkeydown = (e) => { if (e.key === 'Enter') doSubmit() }
      ansEl.focus()
    }
  }

  document.querySelectorAll('.choice').forEach((b) => {
    b.onclick = () => {
      if (app.current.graded) return
      app.current.picked = Number(b.dataset.i)
      render()
    }
  })

  document.getElementById('submit')?.addEventListener('click', doSubmit)
  document.getElementById('next')?.addEventListener('click', () => {
    if (isEndless()) return drawNextEndless()
    app.index++
    nextQuestion()
  })
  document.getElementById('stop')?.addEventListener('click', () => finishEndless())

  document.querySelectorAll('[data-self]').forEach((b) => {
    b.onclick = () => {
      const g = grade({ type: 'text' }, b.dataset.self)
      app.current.graded = g
      // 文字题不参与 θ 更新（无法可靠判分），只记录
      recordAnswer(g, false)
      render()
    }
  })
}

function doSubmit() {
  const q = app.paper.questions[app.index]
  const c = app.current
  if (c.graded) return

  const input = q.type === 'choice' ? c.picked : c.input
  const g = grade(q, input)
  c.graded = g
  recordAnswer(g, q.type !== 'text')
  mascotOnAnswer(g.correct === true)
  render()
}

function recordAnswer(g, countsForTheta) {
  const q = app.paper.questions[app.index]
  app.answers.push({
    question: q,
    correct: g.correct === true,
    countsForTheta,
    input: app.current.input,
  })
  if (isEndless()) settleEndless()
}

function finish() {
  const counted = app.answers.filter((a) => a.countsForTheta)
  const { state, report } = finishSession(app.state, app.bank, counted)
  app.state = state
  app.report = report
  app.phase = 'done'
  mascotOnSessionEnd(report.asked ? Math.round((report.correct / report.asked) * 100) : null)
  saveState({
    mode: 'paper',
    scored: report.scored,
    unscored: report.unscored,
    correct: counted.filter((a) => a.correct === true).length,
    thetaBefore: report.thetaBefore,
    thetaAfter: report.thetaAfter,
  })
  render()
}

function renderDone() {
  const r = app.report
  const ind = r.independence ?? { independentAsked: r.asked, independentCorrect: r.correct, repeatAsked: 0, repeatCorrect: 0, discounted: 0 }
  const rows = r.topicUpdates.map((t) => `
    <tr><td>${t.name}</td><td>${t.correct}/${t.asked}</td>
    <td>${Math.round(t.accuracy * 100)}%</td>
    <td>${Math.round((t.independentCorrect / Math.max(1, t.independentAsked)) * 100) || 0}%</td>
    <td>${t.nextDueDays} 天后</td></tr>`).join('')

  $root.innerHTML = `
    <div class="card">
      <b>这一场做完了</b>
      <div class="stat">
        <div><b>${r.correct}/${r.asked}</b>答对</div>
        <div><b>${Math.round(r.accuracy * 100)}%</b>正确率</div>
        <div><b>${r.thetaBefore} → ${r.thetaAfter}</b>能力</div>
        <div><b>${r.level}</b>水平</div>
      </div>
    </div>
    <div class="card">
      <b>这份成绩的证据有多硬</b>
      <p class="muted" style="margin:8px 0 0">
        新题（完整证据）：<b>${ind.independentCorrect}/${ind.independentAsked}</b>
        ${ind.repeatAsked ? `　重复题（折算 ${ind.discounted} 道）：<b>${ind.repeatCorrect}/${ind.repeatAsked}</b>` : ''}
      </p>
      ${ind.repeatAsked ? `<p class="muted" style="margin:8px 0 0">
        重复题答对只算 1/(做过次数+1) 的证据 —— 可能是真会，也可能只是记住了这题的答案，外部看不出来。
        想要完整证据，得换一道<b>没做过</b>的新题。
      </p>` : ''}
      ${r.unscored ? `<p class="muted" style="margin:8px 0 0">另有 ${r.unscored} 道主观题：自评只记录，不计入能力估计。</p>` : ''}
    </div>
    <div class="card">
      <b>各考点</b>
      <table><thead><tr><th>考点</th><th>对/做</th><th>正确率</th><th>新题正确率</th><th>下次复习</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
    ${r.needReview.length ? `<div class="card">
      <b>需要补的</b>
      <p class="muted" style="margin:6px 0 0">${r.needReview.map((t) => `<span class="tag due">${t.name}</span>`).join('')}</p>
    </div>` : ''}
    <div class="card">
      <button class="btn" id="again">再来一场</button>
      <button class="btn plain" id="home" style="margin-left:8px">回到首页</button>
    </div>`

  document.getElementById('again').onclick = () => startSession(app.paper.questions.length)
  document.getElementById('home').onclick = () => { app.phase = 'ready'; render() }
}

function renderEndlessDone() {
  const e = app.endless
  const acc = e.asked ? Math.round((e.correct / e.asked) * 100) : 0
  const rows = Object.values(e.topicTally).map((t) => `
    <tr><td>${t.name}</td><td>${t.correct}/${t.asked}</td>
    <td>${Math.round((t.correct / Math.max(1, t.asked)) * 100)}%</td></tr>`).join('')

  $root.innerHTML = `
    <div class="card">
      <b>这一轮做完了</b>
      <div class="stat">
        <div><b>${e.correct}/${e.asked}</b>答对</div>
        <div><b>${acc}%</b>正确率</div>
        <div><b>${e.thetaStart} → ${app.state.theta}</b>能力</div>
        <div><b>${describeTheta(app.state.theta)}</b>水平</div>
      </div>
      <p class="muted" style="margin:10px 0 0">
        不限模式下每交一题就更新一次能力并存盘，所以随时可以停，停下来之前的都已经算过账了。
      </p>
    </div>
    ${rows ? `<div class="card">
      <b>这一轮碰到的考点</b>
      <table><thead><tr><th>考点</th><th>对/做</th><th>正确率</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>` : ''}
    <div class="card">
      <button class="btn" id="again">再开一轮</button>
      <button class="btn plain" id="home" style="margin-left:8px">回到首页</button>
    </div>`

  document.getElementById('again').onclick = () => startEndless()
  document.getElementById('home').onclick = () => { app.phase = 'ready'; render() }
}

// ---------- 小工具 ----------
function daysUntil(ts) {
  const d = Math.round((ts - Date.now()) / 86400000)
  if (d <= 0) return '已到期'
  return `${d} 天后`
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]))
}
function escapeAttr(s) { return escapeHtml(s) }

render()
