/**
 * mascot.js —— 大肥鱼（页角的看护人）
 *
 * 学多邻国那只鸟的做法，只保留三件有用的事：
 *   1. 你答对/答错，它当场有反应（不打扰，气泡 4 秒自动缩回去）
 *   2. 你在练习页发呆超过 3 分钟，它催一句；催过之后 5 分钟内不再催
 *   3. 连续答错 3 题，它把你往「方法论」标签推
 *
 * 它不会评价你、不会扣分、不会记录你没做的事。
 */

const MASCOT_LINES = {
  hello: ['鱼片，做几题？', '今天的题在这，随手做两道', '来了就做一题，做完可以走'],
  right: ['对！', '这个稳', '就这样，再来一题', '对，记住这个动作'],
  wrong: ['这题记下来了', '错没关系，看必查项', '错了才知道格子在哪是空的', '这题进错题了，等下再看'],
  threeWrong: ['连着错了，先别做。去「方法论」看一眼必查项'],
  done: ['这一轮结束了，分数不用管', '收工。错的题明天还会来'],
  nudge: ['还在吗？做一题就够', '三分钟没动了，一题', '鱼片，随便点一题'],
  idleReady: ['准备好了就开始', '题数随便选，8 题也行'],
}

const MASCOT_SVG = `
<svg viewBox="0 0 120 100" width="100%" height="100%" aria-hidden="true">
  <g class="m-body">
    <path class="m-tail" d="M96 52 C112 40 116 30 118 22 C110 24 100 30 94 40 Z"/>
    <path class="m-tail2" d="M96 52 C114 56 118 66 118 74 C109 71 100 64 94 54 Z"/>
    <ellipse class="m-fish" cx="56" cy="50" rx="42" ry="30"/>
    <path class="m-fin" d="M52 78 C58 92 66 96 74 94 C68 88 64 82 62 76 Z"/>
    <ellipse class="m-fin2" cx="58" cy="44" rx="18" ry="10"/>
  </g>
  <g class="m-face">
    <circle class="m-eye" cx="38" cy="42" r="7"/>
    <circle class="m-pupil" cx="40" cy="42" r="3.2"/>
    <circle class="m-cheek" cx="28" cy="56" r="5"/>
    <path class="m-mouth m-mouth-idle" d="M44 62 q6 5 12 0"/>
    <path class="m-mouth m-mouth-happy" d="M42 60 q8 10 16 0 q-8 4 -16 0"/>
    <path class="m-mouth m-mouth-sad" d="M44 66 q6 -6 12 0"/>
    <path class="m-mouth m-mouth-think" d="M44 63 h12"/>
  </g>
</svg>`

const MASCOT_CSS_ID = 'mascot-style'

let mascotState = { lastSay: 0, lastNudge: 0, wrongStreak: 0, rightStreak: 0, mood: 'idle', timer: null, active: false }
let mascotEl = null

function mascotPick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

export function mountMascot() {
  if (mascotEl) return mascotEl
  const box = document.createElement('div')
  box.id = 'mascot'
  box.className = 'mascot mood-idle'
  box.innerHTML = `${MASCOT_SVG}<div class="m-bubble" id="m-bubble"></div>`
  box.title = '大肥鱼'
  document.body.appendChild(box)
  mascotEl = box
  // 点它一下，它说一句（别让它变成必须点的东西，所以只换了气泡文字）
  box.addEventListener('click', () => mascotSay(mascotPick(MASCOT_LINES.hello), 'idle', 6000))
  // 鼠标键盘一动就算「没发呆」
  document.addEventListener('pointerdown', mascotTouch, { passive: true })
  document.addEventListener('keydown', mascotTouch, { passive: true })
  startIdleWatch()
  return box
}

function setMood(mood) {
  mascotState.mood = mood
  if (!mascotEl) return
  mascotEl.className = `mascot mood-${mood}`
}

/** 让它说一句话。seconds = 气泡停留秒数 */
export function mascotSay(text, mood = 'idle', seconds = 4.5) {
  const box = mountMascot()
  const bubble = box.querySelector('#m-bubble')
  if (!bubble || !text) return
  bubble.textContent = text
  box.classList.add('talking')
  setMood(mood)
  mascotState.lastSay = Date.now()
  clearTimeout(mascotState.hideTimer)
  mascotState.hideTimer = setTimeout(() => {
    box.classList.remove('talking')
    setMood('idle')
  }, seconds * 1000)
}

/** 记录一次作答结果：连对/连错驱动不同反应 */
export function mascotOnAnswer(correct) {
  if (correct) {
    mascotState.rightStreak += 1
    mascotState.wrongStreak = 0
    if (mascotState.rightStreak >= 2) mascotSay(mascotPick(MASCOT_LINES.right), 'happy', 3)
    else mascotSay('对', 'happy', 2.2)
  } else {
    mascotState.wrongStreak += 1
    mascotState.rightStreak = 0
    if (mascotState.wrongStreak >= 3) mascotSay(MASCOT_LINES.threeWrong[0], 'think', 8)
    else mascotSay(mascotPick(MASCOT_LINES.wrong), 'sad', 4)
  }
}

export function mascotOnSessionStart() {
  mascotState.rightStreak = 0
  mascotState.wrongStreak = 0
  mascotSay(mascotPick(MASCOT_LINES.hello), 'happy', 4)
}

export function mascotOnSessionEnd(accuracy) {
  mascotState.rightStreak = 0
  mascotState.wrongStreak = 0
  const text = typeof accuracy === 'number' && accuracy >= 80 ? '这一轮挺稳，收工' : mascotPick(MASCOT_LINES.done)
  mascotSay(text, 'happy', 6)
}

/** 练习页发呆 3 分钟催一句，5 分钟内不重复催 */
function startIdleWatch() {
  if (mascotState.timer) return
  mascotState.timer = setInterval(() => {
    if (!mascotState.active) return
    const idle = Date.now() - mascotState.lastSay
    if (idle > 180000 && Date.now() - mascotState.lastNudge > 300000) {
      mascotState.lastNudge = Date.now()
      mascotSay(mascotPick(MASCOT_LINES.nudge), 'think', 6)
    }
  }, 30000)
}

/** 页面任何交互都算「没发呆」 */
export function mascotTouch() { mascotState.lastSay = Date.now() }

let greeted = false

/** 页面加载完成（题库就绪）时只说一次，别每次 render 都开口 */
export function mascotGreetOnce() {
  if (greeted) return
  greeted = true
  mascotSay(mascotPick(MASCOT_LINES.idleReady), 'idle', 5)
}

/** 是否在练习中（由 app.js 每次 render 时告诉我们），发呆提醒只在练习中触发 */
export function mascotSetActive(v) { mascotState.active = !!v }
