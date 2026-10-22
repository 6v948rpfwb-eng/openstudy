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

const $root = document.getElementById('root')
const KEY = (subject) => `openstudy.state.${subject}`

const app = {
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

// ---------- 渲染 ----------
function render() {
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

function renderReady() {
  const { bank, state } = app
  const due = dueTopics(state, bank)
  const topicRows = Object.entries(bank.topics).map(([id, t]) => {
    const rec = state.topics[id]
    return `<tr>
      <td>${id}</td><td>${t.name}</td>
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
    </div>

    <div class="card">
      <b>各考点</b>
      <table><thead><tr><th>编号</th><th>考点</th><th>对/做</th><th>掌握度</th><th>下次</th></tr></thead>
      <tbody>${topicRows}</tbody></table>
    </div>`

  document.getElementById('start').onclick = () => startSession(Number(document.getElementById('n').value))
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
  })
  app.paper = { questions: picked, meta }
  app.index = 0
  app.answers = []
  app.phase = 'practice'
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
  drawNextEndless()
}

/** 按当前 θ 抽下一道；同一场里尽量不重复出已经出过的题 */
function drawNextEndless() {
  let picked = null
  for (let attempt = 0; attempt < 8; attempt++) {
    const res = composePaper(app.bank, { theta: app.state.theta, n: 1, progress: app.state })
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
