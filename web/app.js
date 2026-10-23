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
  emptyState, finishSession, dueTopics, topicMastery, migrateState, seenCount,
  describeTheta, predictPass,
} from '../core/index.js'
import { renderMathText } from '../core/math.js'
import { loadForTopic } from '../core/framework.js'
import { DAILY_GOAL, xpForAnswer, levelOf, dayKey, settleSession, newBadges, withBadges, BADGES } from '../core/game.js'
import { iconSVG, BADGE_ICONS } from './icons.js'
import { mountMascot, mascotSay, mascotOnAnswer, mascotOnSessionStart, mascotOnSessionEnd, mascotSetActive, mascotGreetOnce } from './mascot.js'

const $root = document.getElementById('root')
const KEY = (subject) => `openstudy.state.${subject}`

const GAME_KEY = 'openstudy.game'
function loadGame() {
  try {
    const raw = localStorage.getItem(GAME_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { /* 忽略 */ }
  return { xp: 0, streak: 0, lastDoneDay: '', todayXp: 0, todayDay: '', answered: 0, sessions: 0, bestCorrectStreak: 0, badges: {} }
}
function saveGame(g) {
  try { localStorage.setItem(GAME_KEY, JSON.stringify(g)) } catch (e) { /* 忽略 */ }
}

const app = {
  opts: loadOpts(),
  game: loadGame(),
  sessionXp: 0,
  correctStreak: 0,
  bestStreak: 0,
  gameInfo: null,
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
    if (v !== app.view) { app.view = v; navReset(); render() }
  })
}

// ---------- 右上角学科切换 ----------
// 构建时把多个 --bank 内联成 __EMBEDDED_BANKS__（key = 题库 subject，值是题目 JSON 文本）。
// 只有一个学科时不显示切换按钮。
const BANKS = (typeof __EMBEDDED_BANKS__ !== 'undefined' && __EMBEDDED_BANKS__) ? __EMBEDDED_BANKS__ : null
const BANK_KEYS = BANKS ? Object.keys(BANKS) : []
const SUBJECT_LABEL = { physics: '物理', chemistry: '化学', technology: '技术', math: '数学', chinese: '语文', english: '英语' }

const SUBJECT_STYLE = {
  physics: { glyph: '物', name: '物理', bg: 'linear-gradient(160deg,#41c08a,#26996a)' },
  chemistry: { glyph: '化', name: '化学', bg: 'linear-gradient(160deg,#7b6cf6,#5a49d6)' },
  technology: { glyph: '技', name: '技术', bg: 'linear-gradient(160deg,#f0a44b,#d9842a)' },
  math: { glyph: '数', name: '数学', bg: 'linear-gradient(160deg,#6a83ff,#4356e0)' },
  english: { glyph: '英', name: '英语', bg: 'linear-gradient(160deg,#38b6c4,#1f8b98)' },
  chinese: { glyph: '语', name: '语文', bg: 'linear-gradient(160deg,#e0705f,#c14e3d)' },
  default: { glyph: '科', name: '学科', bg: 'linear-gradient(160deg,#9aa6c4,#77839f)' },
}

function bankTitle(key) {
  try { return JSON.parse(BANKS[key]).title || SUBJECT_LABEL[key] || key } catch (e) { return SUBJECT_LABEL[key] || key }
}

function renderSubjects() {
  const box = document.getElementById('subjects')
  if (!box) return
  if (BANK_KEYS.length < 2) { box.innerHTML = ''; return }
  const cur = app.bank ? app.bank.subject : ''
  box.innerHTML = BANK_KEYS.map((k) => {
    const c = SUBJECT_STYLE[k] || SUBJECT_STYLE.default
    return `<button class="subjcard ${k === cur ? 'on' : ''}" data-bank="${k}" title="${bankTitle(k)}">
      <span class="subjicon" style="background:${c.bg}">${c.glyph}</span>
      <span class="subjlabel">${c.name}</span>
    </button>`
  }).join('')
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
  navReset()
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


// 题干排版：把「行｜列」串成的表格还原成真表格，其余按段落/小问分行
/* ── 公式渲染（KaTeX）───────────────────────────────────────────────
   题库里若带 TeX 原文（stemTex / choicesTex / solutionTex），就交给 KaTeX 排版；
   没有 TeX 的题库仍走原来的纯文本通路（stemToHtml）。两种可以混着用。 */
const KATEX_OK = () => typeof window !== 'undefined' && window.katex && typeof window.katex.renderToString === 'function'
const katexCache = new Map()
function texOnly(tex, display) {
  if (!KATEX_OK() || !tex) return null
  const key = (display ? 'D' : 'I') + tex
  if (katexCache.has(key)) return katexCache.get(key)
  let out = null
  try {
    out = window.katex.renderToString(tex, { displayMode: !!display, throwOnError: false, strict: false, trust: false })
  } catch { out = null }
  katexCache.set(key, out)
  return out
}
/** 把「中文 + $行内公式$ + $$独立公式$$」的原文切成块渲染；没 KaTeX 就退回纯文本 */
function texMixed(text) {
  const src = String(text ?? '')
  if (!KATEX_OK() || !/(\$|\\\(|\\\[)/.test(src)) return null
  const parts = []
  let rest = src
  // $$...$$ 与 $...$ 两档；不跨行匹配，避免把正常美元符号吃掉
  const re = /\$\$([^$]+?)\$\$|\$([^$\n]+?)\$/g
  let last = 0
  let m
  while ((m = re.exec(src))) {
    if (m.index > last) parts.push(fwEsc(src.slice(last, m.index)))
    const display = m[1] !== undefined
    const body = display ? m[1] : m[2]
    const html = texOnly(body, display)
    parts.push(html || fwEsc(display ? `$$${body}$$` : `$${body}$`))
    last = re.lastIndex
  }
  if (last < src.length) parts.push(fwEsc(src.slice(last)))
  return parts.join('').replace(/\n/g, '<br>')
}
/** 优先 TeX，其次纯文本 */
function mathThen(tex, plainText) {
  const h = texMixed(tex)
  return h == null ? stemToHtml(plainText) : `<div class="texblock">${h}</div>`
}


/** 原文里的断行与零散空格：汉字之间直接吞掉，汉字与字母/数字之间留一个空格 */
function tidyText(input) {
  const isCJK = (ch) => !!ch && /[\u4e00-\u9fff]/.test(ch)
  let t = String(input ?? '').replace(/\r/g, '')
  t = t.replace(/\s*\n\s*/g, (m, off, str) => {
    const prev = str[off - 1] || ''
    const next = str[off + m.length] || ''
    return (isCJK(prev) && isCJK(next)) ? '' : ' '
  })
  t = t.replace(/[ \t]{2,}/g, ' ')
  t = t.replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '$1')
  t = t.replace(/[ \t]+([，。、；：？！“”‘’（）《》])/g, '$1')
  t = t.replace(/([，。、；：？！“”‘’（）《》])[ \t]+/g, '$1')
  return t.trim()
}

/** m_A 这种字母下标：换成真正的下标标签，和数字下标（detex 已转成 ₁）不冲突 */
function subify(html) {
  return String(html).replace(/([A-Za-zΑ-ω])_([A-Za-z0-9]{1,3})(?![<\w])/g, '$1<sub>$2</sub>')
}

function stemToHtml(text) {
  const raw = tidyText(text)
  const tokens = raw.split(/；(?=[^；]{0,60}｜)|；(?!)/).flatMap((x) => x.split('\n'))
    .map((x) => x.trim()).filter(Boolean)
  const out = []
  let table = null
  const flush = () => {
    if (!table) return
    const rows = table.map((cells) => `<tr>${cells.map((c) => `<td>${subify(renderMathText(c))}</td>`).join('')}</tr>`).join('')
    out.push(`<div class="tblwrap"><table class="stemtable">${rows}</table></div>`)
    table = null
  }
  let prose = []
  const flushProse = () => {
    if (!prose.length) return
    out.push(`<p class="sp">${subify(renderMathText(prose.join('；')))}</p>`)
    prose = []
  }
  for (const tk of tokens) {
    if (tk.includes('｜')) {
      flushProse()
      const cells = tk.split('｜').map((c) => c.trim()).filter(Boolean)
      if (cells.length >= 2) { (table = table || []).push(cells); continue }
    }
    flush()
    prose.push(tk)
  }
  flush(); flushProse()
  // 小问 (1)(2)(3) 各自成行，别挤在一段里
  return out.join('').replace(/<p class="sp">([\s\S]*?)<\/p>/g, (m, inner) =>
    inner.replace(/\s*[（(]([1-9])([）)])\s*/g, '</p><p class="sp sub">（$1）').replace(/^([\s\S]*?)<\/p><p class="sp sub">/, '$1</p><p class="sp sub">'))
}

function renderTabs() {
  const bar = document.getElementById('tabs')
  if (!bar) return
  if (!FW_SUBJECTS.length) { bar.innerHTML = ''; return }
  const canBack = backTarget() !== null
  bar.innerHTML = `
    ${canBack ? `<button class="tab backbtn" id="backbtn" title="返回上一级">↩</button>` : ''}
    <button class="tab ${app.view === 'practice' ? 'on' : ''}" data-v="practice">练习</button>
    <button class="tab ${app.view === 'framework' ? 'on' : ''}" data-v="framework">方法论</button>
    <button class="tab ${app.view === 'map' ? 'on' : ''}" data-v="map">知识图</button>`
  const bb = bar.querySelector('#backbtn')
  if (bb) bb.onclick = () => { goBack() }
  bar.querySelectorAll('.tab[data-v]').forEach((b) => {
    b.onclick = () => {
      if (app.view !== b.dataset.v) { app.view = b.dataset.v; navReset() }
      else navReset() // 已经在这一页：再点一次回到最外层
      syncHash()
      render()
    }
  })
}

// ---------- 返回上一级 ----------
// 层级：做题中 → 练习根 → 知识块 → 单个考点；方法论同理（分类 → 题型）；知识图（块 → 单个知识点）
function backTarget() {
  if (app.phase === 'practice') return 'exitSession'
  if (app.view === 'practice') {
    if (app.nav.topic) return 'practice.topic'
    if (app.nav.block) return 'practice.block'
    return null
  }
  if (app.view === 'framework') {
    if (app.mnav.method) return 'framework.method'
    if (app.mnav.group) return 'framework.group'
    return null
  }
  if (app.view === 'map') {
    if (app.kb.node) return 'map.node'
    if (app.kb.block) return 'map.block'
    return null
  }
  return null
}

function goBack() {
  const t = backTarget()
  if (!t) return
  if (t === 'exitSession') {
    app.phase = 'ready'
    app.session = null
  } else if (t === 'practice.topic') app.nav.topic = null
  else if (t === 'practice.block') app.nav.block = null
  else if (t === 'framework.method') app.mnav.method = null
  else if (t === 'framework.group') app.mnav.group = null
  else if (t === 'map.node') app.kb.node = null
  else if (t === 'map.block') app.kb.block = null
  render()
}

// ---------- 通用：状态、面包屑、小块 ----------
function navReset() { app.nav.block = null; app.nav.topic = null; app.kb.block = null; app.kb.node = null; app.mnav.group = null; app.mnav.method = null }

function stateOfTopic(t) {
  return t.state === '✅' ? 'ok' : t.state === '🟡' ? 'mid' : t.state === '🔴' ? 'bad' : 'none'
}
function countStates(topics, ids) {
  const c = { ok: 0, mid: 0, bad: 0, none: 0, total: 0 }
  for (const id of ids) {
    const t = topics[id]
    if (!t) continue
    c[stateOfTopic(t)]++
    c.total++
  }
  return c
}
function stateChips(c) {
  return [
    c.ok ? `<span class="chip ok">已会 ${c.ok}</span>` : '',
    c.mid ? `<span class="chip mid">待确认 ${c.mid}</span>` : '',
    c.bad ? `<span class="chip bad">错的 ${c.bad}</span>` : '',
    c.none ? `<span class="chip none">没测 ${c.none}</span>` : '',
  ].join('')
}
function miniBar(c) {
  const n = c.total || 1
  const seg = (k, cls) => (c[k] ? `<i class="${cls}" style="flex:${c[k] / n}"></i>` : '')
  return `<span class="bar">${seg('ok', 'ok')}${seg('mid', 'mid')}${seg('bad', 'bad')}${seg('none', 'none')}</span>`
}
function crumbTrail(parts) {
  return `<div class="crumbs">${parts
    .map((p, i) =>
      i === parts.length - 1
        ? `<span class="crumb-cur">${fwEsc(p.label)}</span>`
        : `<button class="crumb" data-crumb="${i}">${fwEsc(p.label)}</button><i>›</i>`
    )
    .join('')}</div>`
}
function bindCrumbs(parts) {
  $root.querySelectorAll('[data-crumb]').forEach((b) => {
    b.onclick = () => {
      const p = parts[Number(b.dataset.crumb)]
      if (p && p.go) p.go()
    }
  })
}
/** 一个考点的细节卡：判据 / 动作序列 / 必查项 */
function topicDetailHTML(doc, tid, extra = '') {
  const t = doc.topics[tid]
  const view = loadForTopic(doc, tid)
  const cues = t.cues && t.cues.length ? t.cues.map((c) => `<span class="cue">${fwEsc(c)}</span>`).join('') : '<span class="muted">还没写判据词</span>'
  return `<div class="card">
    <div class="row" style="justify-content:space-between;align-items:center">
      <div><span class="tid">${fwEsc(t.alias || tid)}</span> <b>${fwEsc(t.name)}</b></div>
      <span class="fst ${FST_CLASS(t.state)}">${fwEsc(t.state || '未测')}</span>
    </div>
    <div class="muted" style="margin-top:8px">属于 <span class="gbadge b${t.group}">${t.group}</span> ${fwEsc(doc.groups[t.group]?.label || '')}</div>
    <div class="muted" style="margin-top:10px">判据（表 1）——看到这些词就该想到这个考点</div>
    <div class="cues">${cues}</div>
    <div class="muted" style="margin-top:12px">动作序列（表 2）= 组级 ${view ? view.steps.length - (t.extraSteps || []).length : 0} 步 + 本题补充</div>
    <ol>${(view ? view.steps : []).map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ol>
    <div class="muted" style="margin-top:12px">必查项（表 3）</div>
    <ul>${(view ? view.checks : []).map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ul>
    ${t.errorType ? `<p class="muted" style="margin-top:10px">上次的错误类型：${fwEsc(t.errorType)}${t.stateDetail ? ' · ' + fwEsc(t.stateDetail) : ''}</p>` : ''}
    ${extra}
  </div>`
}

// ---------- 方法论视图：按题型（问题导向） ----------
// 数据来源 tools/data/methods-*.json；每个方法 = 一类题的「触发特征 → 动作序列 → 必查项」
function methodDocs() { return typeof __METHOD_DOCS__ !== 'undefined' ? __METHOD_DOCS__ : {} }
function knowledgeDocs() { return typeof __KNOWLEDGE_DOCS__ !== 'undefined' ? __KNOWLEDGE_DOCS__ : {} }
function curSubject() { return (app.bank && app.bank.subject) || app.fw.subject }
function topicState(tid) {
  const t = app.bank && app.bank.topics ? app.bank.topics[tid] : null
  return t ? t.state : null
}
function knNodeById(doc, nid) { return (doc.nodes || {})[nid] || null }

function renderMethods() {
  const subj = curSubject()
  const doc = methodDocs()[subj]
  const m = app.mnav
  if (!doc) {
    $root.innerHTML = `<div class="card"><b>方法论</b><div class="muted" style="margin-top:6px">这一科按题型整理的方法还没写。物理已经有了，化学与技术待补。</div></div>`
    return
  }
  const list = doc.methods || []

  // 第三层：一个方法的完整打法
  if (m.method) {
    const it = list.find((x) => x.id === m.method)
    if (it) {
      const kdoc = knowledgeDocs()[subj]
      const chips = (it.topics || []).flatMap((tid) => {
        const hit = kdoc ? Object.entries(kdoc.nodes).filter(([, n]) => n.topic === tid) : []
        if (!hit.length) return [`<button class="kchip" disabled title="${fwEsc(tid)}">${fwEsc(tid)}</button>`]
        return hit.map(([nid, n]) => `<button class="kchip" data-jump="${fwEsc(nid)}" title="${fwEsc(tid)}">${fwEsc(n.name)}</button>`)
      }).join('')
      $root.innerHTML = crumbTrail([
        { label: '全部题型' },
        { label: `${it.group} ${doc.groups[it.group]?.label || ''}`, go: () => { m.method = null; m.group = it.group; render() } },
        { label: it.name },
      ]) + `<div class="card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><span class="gbadge b${it.group}">${it.group}</span> <b>${fwEsc(it.name)}</b></div>
          <span class="muted">${fwEsc(it.id)}</span>
        </div>
        <div class="muted" style="margin-top:12px">什么时候用（题面出现这些就归这一类）</div>
        <ul class="mtight">${(it.trigger || []).map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ul>
        <div class="muted" style="margin-top:12px">动作序列（照着做，别跳步）</div>
        <ol class="mtight">${(it.steps || []).map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ol>
        <div class="muted" style="margin-top:12px">必查项（做完逐条核对）</div>
        <ul class="mtight">${(it.checks || []).map((x) => `<li>${fwEsc(x)}</li>`).join('')}</ul>
        <div class="muted" style="margin-top:12px">用到哪些知识点（点一下去知识图）</div>
        <div class="kchips">${chips || '<span class="muted">没标</span>'}</div>
      </div>`
      bindCrumbs([null, { go: () => { m.method = null; m.group = it.group; render() } }])
      $root.querySelectorAll('[data-jump]').forEach((b) => {
        b.onclick = () => { app.view = 'map'; app.kb.block = null; app.kb.node = b.dataset.jump; render(); syncHash() }
      })
      return
    }
  }

  // 第二层：某一组（A/B/C/D）里的题型
  if (m.group) {
    const g = m.group
    const info = doc.groups[g] || {}
    const items = list.filter((x) => x.group === g)
    const rows = items.map((x) => `<button class="trow" data-m="${fwEsc(x.id)}">
        <span class="tid">${fwEsc(x.id)}</span>
        <span class="tname">${fwEsc(x.name)}</span>
        <span class="muted tside">${(x.steps || []).length} 步</span>
      </button>`).join('')
    $root.innerHTML = crumbTrail([{ label: '全部题型' }, { label: `${g} ${info.label || ''}` }]) + `
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><span class="gbadge b${g}">${g}</span> <b>${fwEsc(info.label || g)}</b></div>
          <span class="muted">${items.length} 类题</span>
        </div>
        <div class="muted" style="margin-top:6px">${fwEsc(info.desc || '')}</div>
      </div>
      <div class="tlist">${rows}</div>`
    bindCrumbs([{ go: () => { m.group = null; render() } }])
    $root.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { m.method = b.dataset.m; render() } })
    return
  }

  // 第一层：四个组
  const cards = Object.entries(doc.groups || {}).map(([g, info]) => {
    const n = list.filter((x) => x.group === g).length
    return `<button class="bcard" data-g="${g}">
      <span class="gbadge b${g} bbig">${g}</span>
      <span class="btitle">${fwEsc(info.label || g)}</span>
      <span class="muted">${n} 类题 · ${fwEsc(info.desc || '')}</span>
    </button>`
  }).join('')
  $root.innerHTML = `<div class="card">
      <div><strong>${fwEsc(doc.title || '方法论')}</strong></div>
      <div class="muted" style="margin-top:4px">这里按「题目长什么样」分类。点进去看这一类题的触发特征、动作序列和必查项。</div>
    </div><div class="bgrid">${cards}</div>`
  $root.querySelectorAll('[data-g]').forEach((b) => { b.onclick = () => { m.group = b.dataset.g; m.method = null; render() } })
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


// ---------- 问大肥鱼：拼好上下文，一键复制到 DSH 对话框 ----------
// 思路：网页没法直接调用 DSH（本地服务要令牌），所以这里负责「把问题连同题目、考点、
// 你的作答一起整理成一段话」，复制到剪贴板，切到 DSH 粘贴发送即可。
function buildAskPrompt(info) {
  const it = info || {}
  const lines = []
  const head = ['【开卷提问】']
  if (it.subject) head.push(`学科：${it.subjectName || it.subject}`)
  if (it.view) head.push(`视图：${it.view}`)
  if (it.topicName) head.push(`考点：${it.topicName}${it.topicId ? '（' + it.topicId + '）' : ''}`)
  lines.push(head.join(' ｜ '))
  if (it.stem) lines.push('', '题干：' + String(it.stem).replace(/\s+/g, ' ').trim())
  if (Array.isArray(it.choices) && it.choices.length) {
    const abc = 'ABCDEFGHIJ'
    lines.push('选项：' + it.choices.map((c, i) => `${abc[i]}. ${String(c).trim()}`).join('  '))
  }
  if (it.myAnswer !== undefined && it.myAnswer !== null && it.myAnswer !== '') {
    lines.push('我的答案：' + it.myAnswer)
  }
  if (it.correct !== undefined && it.correct !== null) {
    lines.push('系统判定：' + (it.correct ? '对' : '错') + (it.reference ? `　参考：${String(it.reference).replace(/\s+/g, ' ').slice(0, 200)}` : ''))
  }
  if (it.note) lines.push('备注：' + it.note)
  lines.push('', '我的问题：' + (it.question || '（待填）'))
  return lines.join('\n')
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (e) { /* 下面用兜底方案 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand && document.execCommand('copy')
    document.body.removeChild(ta)
    return !!ok
  } catch (e) { return false }
}

/** 复制 + 记进提问队列（队列是给「回到 DSH 里翻旧问题」用的备份） */
async function askFromPage(info) {
  const text = buildAskPrompt(info)
  const copied = await copyText(text)
  const saved = await sendQuestion({
    subject: info?.subject,
    questionId: info?.questionId ?? null,
    stem: info?.stem ?? null,
    myAnswer: info?.myAnswer ?? null,
    correct: info?.correct ?? null,
    reference: info?.reference ?? null,
    message: info?.question || '（未写问题）',
  })
  return { copied, saved: saved.ok, text }
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
    // 不要用 alert：它会阻塞页面，后续所有 JS（包括自动化脚本）都会卡死
    app.phase = 'load'
    const box = document.getElementById('root')
    if (box) box.innerHTML = `<section class="card"><h2>题库「${escHtml(name)}」没通过校验</h2><p class="muted">改好题库文件后刷新页面。</p><ul class="errlist">${res.errors.slice(0, 12).map((e) => `<li>${escHtml(e)}</li>`).join('')}</ul></section>`
    return
  }
  app.bank = res.bank

  // 题干写了「图」但没有配图的题：看不见图，做它没意义，先挡在组卷之外。
  // （这些题来自文字转写本，或者原图抓不到；给它们补上 figure 后刷新就自动回来）
  const noFig = (q) => !q.noFigure && /图/.test(q.stem || '') && !q.figure
  app.bank.hiddenNoFig = res.bank.questions.filter(noFig).length
  if (app.bank.hiddenNoFig) app.bank.questions = res.bank.questions.filter((q) => !noFig(q))

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
app.map = { cur: null, k: 1 }
app.nav = { block: null, topic: null }
app.kb = { block: null, node: null }
app.mnav = { group: null, method: null }

// 考点按知识块分组（练习页第一层用）
function blocksOf(doc) {
  const g = doc.graph || {}
  const topics = doc.topics || {}
  const blocks = (g.modules || []).map((m) => ({ id: m.id, label: m.label, topics: (m.topics || []).filter((t) => topics[t]) }))
  const seen = new Set(blocks.flatMap((b) => b.topics))
  const extra = Object.keys(topics).filter((t) => !seen.has(t))
  return { blocks, extra }
}

// ---------- 知识点图视图：纯知识点（概念 / 公式 / 易混 / 前置） ----------
function renderKnowledge() {
  const subj = curSubject()
  const doc = knowledgeDocs()[subj]
  const kb = app.kb
  if (!doc) {
    $root.innerHTML = `<div class="card"><b>知识点图</b><div class="muted" style="margin-top:6px">这一科的知识点还没整理。物理已经有了，化学与技术待补。</div></div>`
    return
  }
  const nodes = doc.nodes || {}

  // 第三层：一个知识点的内容
  if (kb.node && nodes[kb.node]) {
    const n = nodes[kb.node]
    const st = topicState(n.topic)
    const link = (id, cls) => {
      const t = nodes[id]
      return `<button class="kchip ${cls}" data-jump="${fwEsc(id)}">${fwEsc(t ? t.name : id)}</button>`
    }
    const nexts = Object.entries(nodes).filter(([, x]) => (x.prereq || []).includes(kb.node)).map(([id]) => id)
    $root.innerHTML = crumbTrail([
      { label: '知识块' },
      { label: (doc.blocks.find((b) => b.id === n.block) || {}).label || n.block, go: () => { kb.node = null; kb.block = n.block; render() } },
      { label: n.name },
    ]) + `<div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div><b>${fwEsc(n.name)}</b> <span class="muted">${fwEsc(n.topic || '')}</span></div>
        <span class="fst ${FST_CLASS(st)}">${fwEsc(st || '未测')}</span>
      </div>
      <div class="muted" style="margin-top:12px">要点</div>
      <ul class="mtight">${(n.core || []).map((x) => `<li>${renderMathText(x)}</li>`).join('')}</ul>
      ${(n.formulas || []).length ? `<div class="muted" style="margin-top:12px">公式</div>
        <div class="fbox">${(n.formulas || []).map((f) => `<div class="fml">${renderMathText(f)}</div>`).join('')}</div>` : ''}
      ${(n.confusions || []).length ? `<div class="muted" style="margin-top:12px">最容易错的地方</div>
        <ul class="mtight warn">${(n.confusions || []).map((x) => `<li>${renderMathText(x)}</li>`).join('')}</ul>` : ''}
      <div class="muted" style="margin-top:12px">要先会</div>
      <div class="kchips">${(n.prereq || []).map((id) => link(id, 'pre')).join('') || '<span class="muted">没有前置</span>'}</div>
      <div class="muted" style="margin-top:10px">学会了才能学</div>
      <div class="kchips">${nexts.map((id) => link(id, 'next')).join('') || '<span class="muted">没有后继</span>'}</div>
    </div>`
    bindCrumbs([null, { go: () => { kb.node = null; kb.block = n.block; render() } }])
    $root.querySelectorAll('[data-jump]').forEach((b) => { b.onclick = () => { kb.node = b.dataset.jump; kb.block = nodes[b.dataset.jump].block; render() } })
    return
  }

  // 第二层：一个知识块里的知识点
  if (kb.block) {
    const blk = doc.blocks.find((b) => b.id === kb.block)
    const ids = Object.keys(nodes).filter((id) => nodes[id].block === kb.block)
    const rows = ids.map((id) => {
      const n = nodes[id]
      const st = topicState(n.topic)
      const first = (n.core || [])[0] || ''
      return `<button class="trow" data-jump="${fwEsc(id)}">
        <span class="tid">${fwEsc(id)}</span>
        <span class="tname">${fwEsc(n.name)}
          <span class="tsub">${fwEsc(first.length > 34 ? first.slice(0, 34) + '…' : first)}</span></span>
        <span class="fst ${FST_CLASS(st)}">${fwEsc(st || '未测')}</span>
      </button>`
    }).join('')
    $root.innerHTML = crumbTrail([{ label: '知识块' }, { label: blk ? blk.label : kb.block }]) + `
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><b>${fwEsc(blk ? blk.label : kb.block)}</b></div>
          <span class="muted">${ids.length} 个知识点</span>
        </div>
        <div class="muted" style="margin-top:6px">${fwEsc(blk ? blk.note : '')}</div>
        <div style="margin-top:10px"><button class="btn ghost" id="fullmap">看全景图</button></div>
      </div>
      <div class="tlist">${rows}</div>`
    bindCrumbs([{ go: () => { kb.block = null; render() } }])
    $root.querySelectorAll('[data-jump]').forEach((b) => { b.onclick = () => { kb.node = b.dataset.jump; render() } })
    const fb = document.getElementById('fullmap')
    if (fb) fb.onclick = () => renderKnowledgeFullMap(doc)
    return
  }

  // 第一层：知识块
  const cards = doc.blocks.map((b) => {
    const ids = Object.keys(nodes).filter((id) => nodes[id].block === b.id)
    const c = countStates(app.bank && app.bank.topics ? app.bank.topics : {}, ids.map((id) => nodes[id].topic).filter(Boolean))
    return `<button class="bcard" data-b="${fwEsc(b.id)}">
      <span class="btitle">${fwEsc(b.label)}</span>
      <span class="muted">${ids.length} 个知识点</span>
      ${miniBar(c)}
      <span class="bchips">${stateChips(c)}</span>
    </button>`
  }).join('')
  $root.innerHTML = `<div class="card">
      <div><strong>${fwEsc(doc.title || '知识点图')}</strong></div>
      <div class="muted" style="margin-top:4px">这里只有知识点本身：定义、公式、易混点、前置关系。怎么解题去「方法论」。</div>
    </div><div class="bgrid">${cards}</div>`
  $root.querySelectorAll('[data-b]').forEach((b) => { b.onclick = () => { app.kb.block = b.dataset.b; app.kb.node = null; render() } })
}

// 全景图：每个知识块一列，前置关系画箭头
function renderKnowledgeFullMap(doc) {
  const nodes = doc.nodes || {}
  const COL_W = 210, NODE_H = 40, GAP = 12, PAD = 14, TOP = 34, NW = 190
  const pos = new Map()
  doc.blocks.forEach((b, ci) => {
    Object.keys(nodes).filter((id) => nodes[id].block === b.id).forEach((id, ri) => {
      pos.set(id, { x: PAD + ci * COL_W, y: TOP + ri * (NODE_H + GAP) })
    })
  })
  const maxRows = Math.max(...doc.blocks.map((b) => Object.keys(nodes).filter((id) => nodes[id].block === b.id).length))
  const W = PAD * 2 + doc.blocks.length * COL_W
  const H = TOP + maxRows * (NODE_H + GAP) + 16
  let svg = `<svg class="kmap" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
  doc.blocks.forEach((b, ci) => { svg += `<text class="kmap-col" x="${PAD + ci * COL_W}" y="22">${fwEsc(b.label)}</text>` })
  for (const [id, n] of Object.entries(nodes)) {
    for (const pre of n.prereq || []) {
      const a = pos.get(pre), b = pos.get(id)
      if (!a || !b) continue
      const x1 = a.x + NW, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2
      const dx = Math.max(30, Math.abs(x2 - x1) / 2)
      svg += `<path class="kmap-edge" d="M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}"/>`
    }
  }
  for (const [id, p] of pos) {
    const n = nodes[id]
    const st = topicState(n.topic)
    const s = st === '✅' ? 'ok' : st === '🟡' ? 'mid' : st === '🔴' ? 'bad' : 'none'
    const label = n.name.length > 16 ? n.name.slice(0, 16) + '…' : n.name
    svg += `<g class="knode st-${s}" data-jump="${fwEsc(id)}" transform="translate(${p.x},${p.y})">
      <rect class="kbox" width="${NW}" height="${NODE_H}" rx="9"/>
      <text class="kid" x="9" y="15">${fwEsc(id)}</text>
      <text class="kname" x="9" y="30">${fwEsc(label)}</text>
    </g>`
  }
  svg += '</svg>'
  $root.innerHTML = `<div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <b>${fwEsc(doc.title || '')} · 全景图</b>
        <button class="btn ghost" id="backlist">返回列表</button>
      </div>
      <div class="mztools">
        <button class="mzbtn" id="mzOut">−</button><span class="mzpct" id="mzpct">100%</span>
        <button class="mzbtn" id="mzIn">+</button><button class="mzbtn" id="mzFit">适应宽度</button>
        <button class="mzbtn" id="mzReset">100%</button>
        <span class="muted">滚轮滚动 · 按住拖动 · 双指捏合缩放</span>
      </div>
      <div class="mapwrap" id="mapwrap">${svg}</div>
    </div>`
  document.getElementById('backlist').onclick = () => render()
  setupMapZoom()
  $root.querySelectorAll('.knode').forEach((g) => { g.onclick = () => { app.kb.node = g.dataset.jump; render() } })
}

function setupMapZoom() {
  const wrap = $root.querySelector('#mapwrap')
  const svg = wrap && wrap.querySelector('svg.kmap')
  if (!wrap || !svg) return
  const W = Number(svg.getAttribute('width')), H = Number(svg.getAttribute('height'))
  wrap.style.maxHeight = '78vh'

  const apply = () => {
    const k = Math.min(2.2, Math.max(0.35, app.map.k || 1))
    app.map.k = k
    svg.style.width = W * k + 'px'
    svg.style.height = H * k + 'px'
    const val = $root.querySelector('#mzVal')
    if (val) val.textContent = Math.round(k * 100) + '%'
  }
  const zoomAt = (k, cx, cy) => {
    const before = app.map.k || 1
    const rect = wrap.getBoundingClientRect()
    const px = (cx ?? rect.width / 2), py = (cy ?? rect.height / 2)
    const sx = (wrap.scrollLeft + px) / before, sy = (wrap.scrollTop + py) / before
    app.map.k = k
    apply()
    wrap.scrollLeft = sx * app.map.k - px
    wrap.scrollTop = sy * app.map.k - py
  }

  $root.querySelector('#mzIn').onclick = () => zoomAt((app.map.k || 1) * 1.2)
  $root.querySelector('#mzOut').onclick = () => zoomAt((app.map.k || 1) / 1.2)
  $root.querySelector('#mzOne').onclick = () => zoomAt(1)
  $root.querySelector('#mzFit').onclick = () => {
    const k = (wrap.clientWidth - 4) / W
    app.map.k = Math.min(1, Math.max(0.35, k))
    apply()
    wrap.scrollLeft = 0
  }

  wrap.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return           // 普通滚轮=滚动，捏合/^滚轮=缩放
    e.preventDefault()
    const rect = wrap.getBoundingClientRect()
    zoomAt((app.map.k || 1) * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - rect.left, e.clientY - rect.top)
  }, { passive: false })

  let down = null
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    down = { x: e.clientX, y: e.clientY, l: wrap.scrollLeft, t: wrap.scrollTop }
    mapDragMoved = false
    wrap.classList.add('dragging')
  })
  wrap.addEventListener('pointermove', (e) => {
    if (!down) return
    const dx = e.clientX - down.x, dy = e.clientY - down.y
    if (Math.abs(dx) + Math.abs(dy) > 4) mapDragMoved = true
    wrap.scrollLeft = down.l - dx
    wrap.scrollTop = down.t - dy
  })
  const end = () => { down = null; wrap.classList.remove('dragging') }
  wrap.addEventListener('pointerup', end)
  wrap.addEventListener('pointercancel', end)
  wrap.addEventListener('pointerleave', end)

  apply()
}


// 悬浮「问」按钮：任何视图都能用，自动带上当前学科与所在位置
function wireAskFloat() {
  const btn = document.getElementById('askfloat')
  const panel = document.getElementById('askpanel')
  const ta = document.getElementById('askpanel-text')
  const copyBtn = document.getElementById('askpanel-copy')
  const closeBtn = document.getElementById('askpanel-close')
  const msg = document.getElementById('askpanel-msg')
  if (!btn || !panel) return
  btn.onclick = () => {
    panel.hidden = !panel.hidden
    if (!panel.hidden && ta) { ta.value = ''; ta.focus() }
  }
  if (closeBtn) closeBtn.onclick = () => { panel.hidden = true }
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const text = (ta?.value || '').trim()
      const where = { practice: '练习', framework: '方法论', map: '知识图' }[app.view] || '练习'
      const topicId = app.nav?.topic || app.kb?.node || app.mnav?.method || null
      const r = await askFromPage({
        subject: app.bank?.subject,
        subjectName: app.bank?.title,
        view: where,
        topicId,
        topicName: topicId ? (app.bank?.topics?.[topicId]?.name
          || (FW_DOCS[app.bank?.subject]?.topics?.[topicId]?.name)) : null,
        question: text || '（未写问题，请补充）',
      })
      if (msg) {
        msg.textContent = r.copied
          ? '已复制，切到 DSH 窗口 ⌘V 粘贴发送'
          : '复制没成功，手动复制下面这段'
      }
      if (!r.copied && msg) msg.textContent = r.text.slice(0, 80) + '…'
    }
  }
}


// ---------- 小提示点：能力水平后面那个 ⓘ ----------
const THETA_HELP = [
  '每道题有难度 b，你的能力记作 θ，两者都在 0–1 之间。',
  '这道题你大概几成会：θ 和 b 相等是五成；θ 比 b 高 0.25 是七成，低 0.25 是三成。',
  '答完一题会挪 θ：答对往上加，答错往下减；这题本来就不该会却做对了，加得多。',
  '同一道题第二次做对只算一半证据，第三次算三分之一；答错永远算满。',
  '想涨得快：做没做过的题，难度比自己现在高一点点。',
]

function infoDot(title, lines) {
  const body = lines.map((x) => `<li>${escapeHtml(x)}</li>`).join('')
  return `<span class="infowrap">`
    + `<button class="infodot" type="button" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">i</button>`
    + `<span class="infopop" role="note"><b>${escapeHtml(title)}</b><ul>${body}</ul></span></span>`
}

// ---------- 渲染 ----------
function render() {
  mountMascot()
  wireAskFloat()
  mascotSetActive(app.phase === 'practice')
  renderSubjects()
  renderTabs()
  if (app.view === 'framework') return renderMethods()
  if (app.view === 'map') return renderKnowledge()
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

/** 从 source 里拆出「卷名 + 题号」：整卷练习靠它把同一份卷子的题挑出来按顺序做 */
function paperOf(q) {
  const s = (q.source || '').trim()
  const m = s.match(/^(.*?)\s*第\s*(\d+)/)
  if (m) return { paper: m[1].trim().replace(/[（(\s]+$/, ''), no: Number(m[2]) }
  return { paper: s || '未标注卷', no: 0 }
}

function papersOf(bank) {
  const map = new Map()
  for (const q of bank.questions) {
    const { paper, no } = paperOf(q)
    if (!map.has(paper)) map.set(paper, [])
    map.get(paper).push({ q, no })
  }
  return [...map.entries()]
    .map(([paper, arr]) => ({ paper, n: arr.length, qs: arr.sort((a, b) => a.no - b.no).map((x) => x.q) }))
    .filter((p) => p.n >= 4)
    .sort((a, b) => b.n - a.n || a.paper.localeCompare(b.paper))
}

function renderReady() {
  const { bank, state } = app
  const mastered = masteredView(bank)
  const due = dueTopics(state, bank)
  const nav = app.nav
  const doc = FW_DOCS[bank.subject]
  const { blocks, extra } = doc ? blocksOf(doc) : { blocks: [], extra: [] }
  const inBlock = new Set(blocks.flatMap((m) => m.topics))
  const bused = Object.keys(bank.topics).filter((id) => !inBlock.has(id))
  const perTopic = {}
  for (const q of bank.questions) perTopic[q.topic] = (perTopic[q.topic] || 0) + 1
  const qOf = (ids) => ids.reduce((n, id) => n + (perTopic[id] || 0), 0)
  const topics = bank.topics
  const papers = papersOf(bank)

  // 第三层：单个考点
  if (nav.topic && topics[nav.topic]) {
    const t = topics[nav.topic]
    const rec = state.topics[nav.topic]
    const backBlock = blocks.find((m) => m.topics.includes(nav.topic))
    const stats = `
      <div class="stat" style="margin-top:12px">
        <div><b>${perTopic[nav.topic] || 0}</b>题库题数</div>
        <div><b>${rec ? `${rec.correct}/${rec.attempts}` : '—'}</b>对/做</div>
        <div><b>${rec ? Math.round(topicMastery(rec) * 100) + '%' : '—'}</b>掌握度</div>
        <div><b>${rec?.dueAt ? daysUntil(rec.dueAt) : '—'}</b>下次复习</div>
      </div>
      <div class="row" style="margin-top:12px">
        <button class="btn" id="drillOne" ${perTopic[nav.topic] ? '' : 'disabled'}>只练这个考点（最多 10 题）</button>
      </div>`
    $root.innerHTML = crumbTrail([
      { label: bank.title || '练习', go: () => { navReset(); render() } },
      { label: backBlock ? backBlock.label : '其它', go: () => { nav.topic = null; nav.block = backBlock ? backBlock.id : '__extra__'; render() } },
      { label: t.name },
    ]) + topicDetailHTML(doc || { topics: {}, groups: {} }, nav.topic, stats)
    bindCrumbs([
      { go: () => { navReset(); render() } },
      { go: () => { nav.topic = null; nav.block = backBlock ? backBlock.id : '__extra__'; render() } },
    ])
    const b = $root.querySelector('#drillOne')
    if (b) b.onclick = () => startTopicSession(nav.topic)
    return
  }

  // 第二层：一块里的考点
  if (nav.block) {
    const blk = blocks.find((m) => m.id === nav.block)
    const ids = blk ? blk.topics.filter((id) => topics[id]) : bused
    const label = blk ? blk.label : '其它考点'
    const c = countStates(topics, ids)
    const rows = ids.map((id) => {
      const t = topics[id]
      const rec = state.topics[id]
      return `<button class="trow" data-t="${fwEsc(id)}">
        <span class="tid">${fwEsc(t.alias || id)}</span>
        <span class="tname">${fwEsc(t.name)}</span>
        <span class="fst ${FST_CLASS(t.state)}">${fwEsc(t.state || '未测')}</span>
        <span class="tmeta">${perTopic[id] || 0} 题</span>
      </button>`
    }).join('')
    $root.innerHTML = crumbTrail([
      { label: bank.title || '练习', go: () => { navReset(); render() } },
      { label },
    ]) + `
      <div class="card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div><b>${fwEsc(label)}</b></div><span class="muted">${ids.length} 个考点 · ${qOf(ids)} 道题</span>
        </div>
        <div style="margin-top:8px">${miniBar(c)} ${stateChips(c)}</div>
      </div>
      <div class="tlist">${rows || '<div class="card muted">这一块没有题</div>'}</div>`
    bindCrumbs([{ go: () => { navReset(); render() } }])
    $root.querySelectorAll('[data-t]').forEach((b) => {
      b.onclick = () => { nav.topic = b.dataset.t; render() }
    })
    return
  }

  // 第一层：概览 + 知识块卡片
  const all = countStates(topics, Object.keys(topics))
  const cards = blocks.map((m) => {
    const ids = m.topics.filter((id) => topics[id])
    const c = countStates(topics, ids)
    return `<button class="bcard" data-b="${fwEsc(m.id)}">
      <span class="btitle">${fwEsc(m.label)}</span>
      <span class="muted">${ids.length} 个考点 · ${qOf(ids)} 题</span>
      ${miniBar(c)}
      <span class="bchips">${stateChips(c)}</span>
    </button>`
  }).join('')
  const exCard = bused.length
    ? `<button class="bcard" data-b="__extra__">
        <span class="btitle">其它考点</span>
        <span class="muted">${bused.length} 个考点 · ${qOf(bused)} 题</span>
        ${miniBar(countStates(topics, bused))}<span class="bchips">${stateChips(countStates(topics, bused))}</span>
      </button>`
    : ''
  const other = due.length
    ? `<div class="card"><b>该复习了</b>
        <p class="muted" style="margin:6px 0 0">${due.map((d) => `<span class="tag due">${d.name} 逾期 ${d.lateDays} 天</span>`).join('')}</p>
      </div>`
    : ''

  $root.innerHTML = `
    ${gameStripHTML()}
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div>
          <b>${bank.title}</b>
          <div class="muted">${Object.keys(bank.topics).length} 个考点 · ${bank.questions.length} 道题</div>
        </div>
        <button class="btn plain" id="reset">重置进度</button>
      </div>
      <div class="stat">
        <div><b>${state.theta.toFixed(2)}</b>能力 θ${infoDot('能力水平怎么算', THETA_HELP)}</div>
        <div><b>${describeTheta(state.theta)}</b>水平</div>
        <div><b>${state.log.length}</b>练过场次</div>
        <div><b>${due.length}</b>到期考点</div>
      </div>
      <div style="margin-top:12px">${miniBar(all)} ${stateChips(all)}</div>
      ${app.bank.hiddenNoFig ? `<p class="muted" style="margin-top:12px">另有 ${app.bank.hiddenNoFig} 道题原卷有图、但图没抓到（多为文字转写本里的「[图：…]」），先不出给你做；补齐图以后会自己回来。</p>` : ''}
      ${app.warnings.length ? `<p class="muted" style="margin-top:12px">题库提醒：${app.warnings.slice(0, 2).join('；')}${app.warnings.length > 2 ? ' …' : ''}</p>` : ''}
    </div>

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
        依据《知识状态库》：已掌握 ${mastered.topics.length} 个考点（${mastered.questions.length} 道题）默认不出；🔴 照样出。
      </p>
    </div>

    ${papers.length ? `<div class="card">
      <div class="row" style="justify-content:space-between">
        <div><b>整卷</b><div class="muted">按原卷顺序从头做到尾，不抽题、不跳题</div></div>
        <span class="muted">共 ${papers.length} 份</span>
      </div>
      <div class="plist">
        ${papers.slice(0, 10).map((p) => `<button class="prow" data-paper="${fwEsc(p.paper)}">
          <span class="pname">${fwEsc(p.paper)}</span>
          <span class="muted">${p.n} 题</span>
        </button>`).join('')}
      </div>
      ${papers.length > 10 ? `<p class="muted" style="margin:8px 0 0">只列出题数最多的 10 份</p>` : ''}
    </div>` : ''}

    ${other}
    ${badgeWallHTML()}
    <div class="muted" style="margin:18px 0 8px 2px">按知识块看考点（点进去还能只练这个考点）</div>
    <div class="bgrid">${cards}${exCard}</div>`

  document.getElementById('start').onclick = () => startSession(Number(document.getElementById('n').value))
  const skip = document.getElementById('skipMastered')
  if (skip) skip.onchange = () => { app.opts.skipMastered = skip.checked; saveOpts(); render() }
  document.getElementById('reset').onclick = () => {
    if (!confirm('确定清空这个学科的进度？')) return
    localStorage.removeItem(KEY(bank.subject))
    app.state = emptyState(bank.subject)
    render()
  }
  $root.querySelectorAll('[data-paper]').forEach((b) => {
    b.onclick = () => startPaperSession(b.dataset.paper)
  })
  $root.querySelectorAll('[data-b]').forEach((b) => {
    b.onclick = () => { nav.block = b.dataset.b; nav.topic = null; render() }
  })
}

/** 整卷：把同一份卷子的题按题号顺序做整场 */
function startPaperSession(name) {
  const p = papersOf(app.bank).find((x) => x.paper === name)
  if (!p) { mascotSay('这份卷子的题没找着', 'think', 5); return }
  app.mode = 'paper'
  app.paperName = name
  app.paper = { questions: p.qs, meta: null }
  app.index = 0
  app.answers = []
  app.phase = 'practice'
  mascotOnSessionStart()
  nextQuestion()
}

/** 只练一个考点：把题库缩到该考点的题，再走正常组卷 */
function startTopicSession(tid, n = 10) {
  const pool = app.bank.questions.filter((q) => q.topic === tid)
  if (!pool.length) { mascotSay('这个考点题库里没题', 'think', 5); return }
  const sub = { ...app.bank, questions: pool }
  const { picked, meta } = composePaper(sub, {
    theta: app.state.theta,
    n: Math.min(n, pool.length),
    progress: app.state,
    skipMastered: false,
    band: 0.95,
  })
  if (!picked.length) { mascotSay('这个考点暂时抽不出题', 'think', 5); return }
  app.mode = 'paper'
  app.paper = { questions: picked, meta }
  app.index = 0
  app.answers = []
  app.sessionXp = 0
  app.correctStreak = 0
  app.bestStreak = 0
  app.gameInfo = null
  app.phase = 'practice'
  mascotOnSessionStart()
  nextQuestion()
}

function startSession(n) {
  app.sessionXp = 0
  app.correctStreak = 0
  app.bestStreak = 0
  app.gameInfo = null
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
  if (app.endless && app.endless.asked > 0) {
    settleGame({ answered: app.endless.asked, correct: app.endless.correct })
  }
  render()
}

function nextQuestion() {
  if (app.index >= app.paper.questions.length) return finish()
  app.current = { input: '', picked: null, selfGrade: null, graded: null }
  render()
}

/** 跳到某道题：可以随时前后跳，没作答的题保持空白，交卷时算未作答 */
function jumpTo(i) {
  if (!app.paper || i < 0 || i >= app.paper.questions.length) return
  app.index = i
  app.current = { input: '', picked: null, selfGrade: null, graded: null }
  // 回看时把之前的选择还原出来
  const a = app.answers[i]
  if (a) {
    app.current.picked = a.picked ?? null
    app.current.input = a.input ?? ''
    app.current.graded = { correct: a.correct }
  }
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
      return `<button class="${cls}" data-i="${i}" ${c.graded ? 'disabled' : ''}>${'ABCDEFG'[i]}. ${subify(q.choicesTex && q.choicesTex[i] ? (texMixed(q.choicesTex[i]) ?? renderMathText(ch)) : renderMathText(ch))}</button>`
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
      ${isEndless() ? '' : `<div class="qnav">${app.paper.questions.map((_, i) => {
        const a = app.answers[i]
        const st = !a ? '' : (a.correct ? ' ok' : ' bad')
        return `<button class="qno${i === app.index ? ' cur' : ''}${st}" data-q="${i}">${i + 1}</button>`
      }).join('')}</div>`}
      ${/图/.test(q.stem) && !(q.figures || []).length ? `<p class="muted figwarn">这题原文提到图，但题库里没有配图；文字部分能做的照做，需要读图的可以跳过。</p>` : ''}
      <div class="stem" style="margin-top:18px">${q.stemTex ? mathThen(q.stemTex, q.stem) : stemToHtml(q.stem)}</div>
      ${figureHtml}${figureNote}
      ${inputArea}
      ${feedback}
      ${/图/.test(q.stem) && !(q.figures || []).length && !c.graded ? `<div class="row" style="margin-top:12px"><button class="btn plain" id="skipfig">跳过这题</button></div>` : ''}
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
          <button class="btn plain" id="askbtn">复制提问（粘到 DSH 里问我）</button>
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
      if (msg) msg.textContent = '整理中…'
      const r = await askFromPage({
        subject: app.bank?.subject,
        subjectName: app.bank?.title,
        view: '练习',
        topicId: q?.topic,
        topicName: app.bank?.topics?.[q?.topic]?.name,
        questionId: q?.id,
        stem: q?.stem,
        choices: q?.choices ?? null,
        myAnswer: c.graded ? (app.current.picked ?? app.current.input ?? '') : null,
        correct: c.graded ? c.graded.correct : null,
        reference: q?.answer?.reference ?? null,
        question: text,
      })
      if (msg) {
        msg.textContent = r.copied
          ? '已复制。切到 DSH 窗口，⌘V 粘贴后回车，我就能看到完整题目和你的问题。'
          : '复制没成功：手动选中下面的文字复制也行'
      }
      if (r.copied && ta) ta.value = ''
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
  const sf = document.getElementById('skipfig')
  if (sf) sf.onclick = () => { app.index = Math.min(app.index + 1, app.paper.questions.length - 1); app.current = { input: '', picked: null, selfGrade: null, graded: null }; render() }
  $root.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => jumpTo(Number(b.dataset.q))
  })
  document.getElementById('next')?.addEventListener('click', () => {
    if (isEndless()) return drawNextEndless()
    app.index++
    nextQuestion()
  })
  document.getElementById('stop')?.addEventListener('click', () => finishEndless())

  document.querySelectorAll('[data-self]').forEach((b) => {
    b.onclick = () => {
      const g = grade({ type: 'text' }, b.dataset.self)
      // 同一题允许改判：重复点只是把这一格的结论换成新的，不会多记一次
      if (app.current.graded && app.current.graded.self === b.dataset.self) return
      g.self = b.dataset.self
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
  // 按「第几题」写，不是 push：之前用 push，同一题反复点自评会多插几条，
  // 题号条第 i 格就串到别的题上，看起来「后面全错」。同一题再判就覆盖，不重复计数。
  app.answers[app.index] = {
    question: q,
    correct: g.correct === true,
    countsForTheta,
    input: app.current.input,
  }
  // 经验值：第一次答对给得最多；同一题改判只覆盖，不重复记账
  const firstTime = seenCount(app.state, q.id) === 0
  const self = app.current && app.current.self
  const xp = xpForAnswer({ correct: g.correct === true, firstTime, self })
  const before = app.answers[app.index].xp || 0
  app.answers[app.index].xp = xp
  app.sessionXp += xp - before
  if (g.correct === true) { app.correctStreak += 1; app.bestStreak = Math.max(app.bestStreak, app.correctStreak) }
  else if (g.correct === false) app.correctStreak = 0
  if (isEndless()) settleEndless()
}

/** 结算这一场的经验值、连续天数与成就，写回存档 */
function settleGame({ answered, correct }) {
  const before = app.game
  const today = dayKey()
  let g = settleSession(before, { today, sessionXp: app.sessionXp, answered, bestCorrectStreak: app.bestStreak })
  const fresh = newBadges(g, {
    today, answered, correct, bestCorrectStreak: app.bestStreak,
    hour: new Date().getHours(),
  })
  g = withBadges(g, fresh)
  app.game = g
  saveGame(g)
  app.gameInfo = {
    sessionXp: app.sessionXp,
    answered,
    correct,
    levelBefore: levelOf(before.xp),
    levelAfter: levelOf(g.xp),
    fresh,
    streak: g.streak,
    todayXp: g.todayXp,
    goal: DAILY_GOAL,
  }
}

function finish() {
  const counted = app.answers.filter((a) => a.countsForTheta)
  const { state, report } = finishSession(app.state, app.bank, counted)
  app.state = state
  app.report = report
  app.phase = 'done'
  settleGame({ answered: counted.length, correct: counted.filter((a) => a.correct === true).length })
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
        <div><b>${r.thetaBefore} → ${r.thetaAfter}</b>能力${infoDot('能力水平怎么算', THETA_HELP)}</div>
        <div><b>${r.level}</b>水平</div>
      </div>
    </div>
    ${xpPanelHTML()}
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
    ${xpPanelHTML()}
    <div class="card">
      <b>这一轮做完了</b>
      <div class="stat">
        <div><b>${e.correct}/${e.asked}</b>答对</div>
        <div><b>${acc}%</b>正确率</div>
        <div><b>${e.thetaStart} → ${app.state.theta}</b>能力${infoDot('能力水平怎么算', THETA_HELP)}</div>
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

// ---------- 鼓励机制：状态条 / 结算面板 ----------
function gameStripHTML() {
  const g = app.game
  const lv = levelOf(g.xp)
  const pct = Math.round(lv.pct * 100)
  const goalPct = Math.min(100, Math.round((g.todayXp / DAILY_GOAL) * 100))
  const done = g.todayXp >= DAILY_GOAL
  return `
    <div class="card gamecard">
      <div class="grow">
        <div class="lvbox">
          <div class="lvnum">${iconSVG('star', 12, 'lvstar')}<span>${lv.level}</span></div>
          <div class="lvtext">
            <b>等级 ${lv.level}</b>
            <div class="muted">${lv.into} / ${lv.need} XP 到下一级（累计 ${g.xp}）</div>
          </div>
        </div>
        <div class="xpbar"><i style="width:${pct}%"></i></div>
      </div>
      <div class="gside">
        <div class="goalring" ${done ? 'data-done="1"' : ''}>
          <svg viewBox="0 0 40 40" width="46" height="46">
            <circle cx="20" cy="20" r="16" class="ringbg"></circle>
            <circle cx="20" cy="20" r="16" class="ringfg" pathLength="100" style="stroke-dasharray:${goalPct} 100"></circle>
          </svg>
          <span class="ringtxt">${done ? iconSVG('check', 14) : goalPct + '%'}</span>
        </div>
        <div class="goaltxt">
          <b>${done ? '今日达成' : `今日 ${g.todayXp}/${DAILY_GOAL}`}</b>
          <div class="muted">${done ? '明天再来一轮' : '再做几题就够'}</div>
        </div>
        <div class="streakbox" title="每天攒够 20 XP 算一天">
          <span class="flame">${iconSVG('flame', 16)}</span><b>${g.streak}</b><span class="muted">天连续</span>
        </div>
      </div>
    </div>`
}

function badgeWallHTML() {
  const got = app.game.badges
  const cells = BADGES.map((b) => {
    const on = Boolean(got[b.id])
    const ic = on ? (BADGE_ICONS[b.id] || 'star') : 'lock'
    return `<div class="badge ${on ? 'on' : ''}" title="${escapeHtml(b.desc)}${on ? '（' + got[b.id] + ' 解锁）' : '（未解锁）'}">
      <div class="bmedal">${iconSVG(ic, 22)}</div>
      <div class="bname">${b.name}</div>
    </div>`
  }).join('')
  const n = BADGES.filter((b) => got[b.id]).length
  return `<div class="card">
    <div class="row" style="justify-content:space-between">
      <b>成就墙</b><span class="muted">${n}/${BADGES.length} 已解锁</span>
    </div>
    <div class="badges">${cells}</div>
  </div>`
}

function xpPanelHTML() {
  const info = app.gameInfo
  if (!info) return ''
  const up = info.levelAfter.level > info.levelBefore.level
  const fresh = info.fresh || []
  const goalPct = Math.min(100, Math.round((info.todayXp / info.goal) * 100))
  return `
    <div class="card xpcard">
      <div class="xpline">
        <div class="xpbig">+${info.sessionXp} XP</div>
        <div class="muted">本场 ${info.answered} 题，对 ${info.correct} 题</div>
      </div>
      <div class="xpbar big"><i style="width:${Math.round(info.levelAfter.pct * 100)}%"></i></div>
      <div class="muted" style="margin-top:6px">
        等级 ${info.levelAfter.level}（${info.levelAfter.into}/${info.levelAfter.need} XP）
        ${up ? `<b class="uplevel">升级了！${info.levelBefore.level} → ${info.levelAfter.level}</b>` : ''}
      </div>
      <div class="xpline" style="margin-top:10px">
        <div>今日目标 <b>${info.todayXp}/${info.goal}</b>（${goalPct}%）</div>
        <div>连续 <span class="flame">${iconSVG('flame', 16)}</span><b>${info.streak}</b> 天</div>
      </div>
      ${fresh.length ? `<div class="newbadges">
        <b>新成就</b>
        ${fresh.map((b) => `<span class="badgepill">${iconSVG(BADGE_ICONS[b.id] || 'star', 15)} ${b.name}</span>`).join('')}
      </div>` : ''}
    </div>`
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

// 测试钩子：把纯函数挂到 globalThis，方便 node 里离线断言（不影响页面行为）
if (typeof globalThis !== 'undefined') {
  globalThis.__openstudy = { buildAskPrompt, askFromPage, stemToHtml }
}
