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
  emptyState, finishSession, dueTopics, topicMastery,
  describeTheta, predictPass,
} from '../core/index.js'

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
}

// ---------- 存档 ----------
function saveState() {
  if (!app.bank) return
  try {
    localStorage.setItem(KEY(app.bank.subject), JSON.stringify(app.state))
  } catch (e) {
    console.warn('存档失败', e)
  }
}
function loadState(subject) {
  try {
    const raw = localStorage.getItem(KEY(subject))
    if (!raw) return null
    const s = JSON.parse(raw)
    return s?.version === 1 ? s : null
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
  app.phase = 'ready'
  render()
}

async function tryAutoLoad() {
  // 先试从 ../data 读（用 http 打开时可行）
  try {
    const r = await fetch('../data/example.bank.json')
    if (r.ok) { useBankText(await r.text(), 'example.bank.json'); return true }
  } catch { /* 双击打开时 file:// 会拦 fetch，正常 */ }

  // 兜底：用 build 时内联进来的示例题库（单文件版专供）
  if (typeof __EMBEDDED_BANK__ !== 'undefined' && __EMBEDDED_BANK__) {
    useBankText(__EMBEDDED_BANK__, '内置示例题库')
    return true
  }
  return false
}

// ---------- 渲染 ----------
function render() {
  if (app.phase === 'load') return renderLoad()
  if (app.phase === 'ready') return renderReady()
  if (app.phase === 'practice') return renderPractice()
  if (app.phase === 'done') return renderDone()
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

function nextQuestion() {
  if (app.index >= app.paper.questions.length) return finish()
  app.current = { input: '', picked: null, selfGrade: null, graded: null }
  render()
}

function renderPractice() {
  const q = app.paper.questions[app.index]
  const total = app.paper.questions.length
  const pct = (app.index / total) * 100
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
      return `<button class="${cls}" data-i="${i}" ${c.graded ? 'disabled' : ''}>${'ABCDEFG'[i]}. ${escapeHtml(ch)}</button>`
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
        <div class="sol">${escapeHtml(q.answer.reference ?? '（题库没写参考答案）')}</div>
        ${q.solution ? `<div class="sol" style="margin-top:10px">解析：${escapeHtml(q.solution)}</div>` : ''}
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
        ${c.graded.reason ? `<div class="sol">${escapeHtml(c.graded.reason)}</div>` : ''}
        ${q.solution ? `<div class="sol">解析：${escapeHtml(q.solution)}</div>` : ''}
      </div>`
    }
  }

  const canSubmit = q.type === 'text'
    ? true
    : c.picked !== null || c.input.trim() !== ''

  $root.innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <span class="muted">第 ${app.index + 1} / ${total} 题</span>
        <span class="muted">难度 ${q.difficulty.toFixed(2)} · 预测通过 ${(predictPass(app.state.theta, q.difficulty) * 100).toFixed(0)}%</span>
      </div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <p class="stem" style="margin-top:16px">${escapeHtml(q.stem)}</p>
      ${inputArea}
      ${feedback}
      <div class="row" style="margin-top:16px">
        ${c.graded && q.type !== 'text'
          ? `<button class="btn" id="next">${app.index + 1 === total ? '交卷' : '下一题'}</button>`
          : c.graded && q.type === 'text'
            ? `<span class="muted">选完再点下一题</span>`
            : `<button class="btn" id="submit" ${canSubmit ? '' : 'disabled'}>提交</button>`}
      </div>
    </div>`

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
    app.index++
    nextQuestion()
  })

  document.querySelectorAll('[data-self]').forEach((b) => {
    b.onclick = () => {
      const g = grade({ type: 'text' }, b.dataset.self)
      app.current.graded = g
      // 文字题不参与 θ 更新（无法可靠判分），只记录
      recordAnswer(g, true)
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
}

function finish() {
  const counted = app.answers.filter((a) => a.countsForTheta)
  const { state, report } = finishSession(app.state, app.bank, counted)
  app.state = state
  app.report = report
  app.phase = 'done'
  saveState()
  render()
}

function renderDone() {
  const r = app.report
  const rows = r.topicUpdates.map((t) => `
    <tr><td>${t.name}</td><td>${t.correct}/${t.asked}</td>
    <td>${Math.round(t.accuracy * 100)}%</td>
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
      <b>各考点</b>
      <table><thead><tr><th>考点</th><th>对/做</th><th>正确率</th><th>下次复习</th></tr></thead>
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
