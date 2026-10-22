/**
 * mascot.js —— 蓝色大肥鱼（DeepSeek 拟人形象），页角的看护人
 *
 * 形象：蓝色胖鱼 + 鲸尾 + 傲娇脸（半眯眼、挑眉、嘟嘴），旁边一只白饭碗
 *      （梗来自 B 站「蓝色大肥鱼：我要 token，我要吃白饭」这类 DeepSeek 拟人视频）
 * 性格：傲娇。夸人先「哼」一下，催人直接催，不哄。
 *
 * 只做三件有用的事：
 *   1. 答对/答错当场有反应（气泡几秒后自己缩回去）
 *   2. 连续答错 3 题，把你往「方法论」的必查项推
 *   3. 练习页发呆超 3 分钟催一句（5 分钟内不重复催）
 * 不算分、不评价、不记录你没做的事。
 */

const MASCOT_LINES = {
  hello: ['哼，来了就先做两题', '不是我等你，是题在这', '做吧，我看着呢'],
  right: ['这还用想？对', '嗯，还行吧', '算你厉害', '对，记住这个动作'],
  wrong: ['哼，这题我记下了', '错一次没什么……才怪', '必查项又没查吧', '这题进错题了'],
  threeWrong: ['连着错？先去看「方法论」的必查项，别硬做'],
  done: ['收工。别急着夸自己', '这一轮结束，错的明天还来', '行吧，比刚才强'],
  nudge: ['三分钟了，做一题总可以吧', '喂，还在吗', '不做一题不许玩'],
  idleReady: ['题库好了，随便挑两题', '准备好了就说一声'],
}

const MASCOT_SVG = `
<svg viewBox="0 0 130 112" width="100%" height="100%" aria-hidden="true">
  <defs>
    <linearGradient id="mBody" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0" stop-color="#94a9ff"/><stop offset="0.5" stop-color="#5c79f6"/><stop offset="1" stop-color="#3b4fc9"/>
    </linearGradient>
    <linearGradient id="mFin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8ea4ff"/><stop offset="1" stop-color="#4154cb"/>
    </linearGradient>
    <radialGradient id="mBelly" cx="0.45" cy="0.4" r="0.75">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.7"/><stop offset="1" stop-color="#dfe6ff" stop-opacity="0.2"/>
    </radialGradient>
  </defs>

  <g class="m-body">
    <!-- 尾巴（两瓣），从身体右侧长出去 -->
    <path d="M101 56 C117 43 125 35 128 25 C118 28 107 36 100 45 Z" fill="url(#mFin)"/>
    <path d="M101 60 C119 63 127 71 129 81 C118 78 107 70 100 61 Z" fill="url(#mFin)" opacity="0.9"/>
    <!-- 背鳍 -->
    <path d="M54 27 C62 13 74 9 84 13 C76 19 70 25 67 31 Z" fill="url(#mFin)" opacity="0.85"/>
    <!-- 身体 -->
    <ellipse cx="60" cy="58" rx="45" ry="33" fill="url(#mBody)"/>
    <!-- 肚子 -->
    <ellipse cx="55" cy="70" rx="27" ry="15" fill="url(#mBelly)"/>
    <!-- 胸鳍 -->
    <path d="M46 77 C42 90 50 98 62 96 C54 90 50 85 52 75 Z" fill="url(#mFin)" opacity="0.8"/>
    <!-- 头顶高光 -->
    <ellipse cx="42" cy="37" rx="11" ry="5" fill="#ffffff" opacity="0.22" transform="rotate(-20 42 37)"/>
  </g>

  <g class="m-face">
    <!-- 眼睛：半眯（上眼皮压住一半） -->
    <ellipse class="m-eye" cx="40" cy="52" rx="9.5" ry="9"/>
    <circle class="m-pupil" cx="42.5" cy="53.5" r="4.6"/>
    <circle cx="41" cy="51.5" r="1.5" fill="#ffffff"/>
    <path class="m-lid" d="M30.5 48.5 q9.5 -7 19 0"/>
    <!-- 挑眉：只挑靠近鼻子那一侧 -->
    <path class="m-brow" d="M34 36.5 q8 -3.5 14.5 0.5"/>
    <!-- 腮红 -->
    <ellipse class="m-cheek" cx="26" cy="64" rx="6" ry="4"/>
    <ellipse class="m-cheek" cx="56" cy="68" rx="5" ry="3.4" opacity="0.6"/>
    <!-- 嘴：四种心情 -->
    <path class="m-mouth m-mouth-idle" d="M45.5 68 q4.5 4.5 9 0"/>
    <path class="m-mouth m-mouth-happy" d="M44 66 q7 11 15 1 q-8 5 -15 -1 Z"/>
    <path class="m-mouth m-mouth-sad" d="M47 71 q6 -6 11 -1"/>
    <path class="m-mouth m-mouth-think" d="M46 69.5 h11"/>
  </g>

  <!-- 白饭碗：梗里它最惦记的东西 -->
  <g class="m-bowl">
    <ellipse cx="30" cy="103" rx="15" ry="4" fill="#e9edf6"/>
    <path d="M17 96 q13 16 26 0 Z" fill="#ffffff" stroke="#d7ddeb" stroke-width="1.3"/>
    <path d="M20 96 q2 -7 10 -7 q8 0 10 7 Z" fill="#f8fafd" stroke="#dfe4f0" stroke-width="1.1"/>
    <path d="M22 92 q3 -3 8 -3 q5 0 8 3" fill="none" stroke="#e4e9f4" stroke-width="1"/>
  </g>
</svg>`

let mascotState = { lastSay: 0, lastNudge: 0, wrongStreak: 0, rightStreak: 0, mood: 'idle', timer: null, active: false }
let mascotEl = null
let greeted = false

function mascotPick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

export function mountMascot() {
  if (mascotEl) return mascotEl
  const box = document.createElement('div')
  box.id = 'mascot'
  box.className = 'mascot mood-idle'
  box.innerHTML = `${MASCOT_SVG}<div class="m-bubble" id="m-bubble"></div>`
  box.title = '蓝色大肥鱼'
  document.body.appendChild(box)
  mascotEl = box
  box.addEventListener('click', () => mascotSay(mascotPick(MASCOT_LINES.hello), 'think', 6000))
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

export function mascotOnAnswer(correct) {
  if (correct) {
    mascotState.rightStreak += 1
    mascotState.wrongStreak = 0
    if (mascotState.rightStreak >= 2) mascotSay(mascotPick(MASCOT_LINES.right), 'happy', 3)
    else mascotSay('哼，对', 'happy', 2.2)
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
  mascotSay(mascotPick(MASCOT_LINES.hello), 'think', 4)
}

export function mascotOnSessionEnd(accuracy) {
  mascotState.rightStreak = 0
  mascotState.wrongStreak = 0
  const text = typeof accuracy === 'number' && accuracy >= 80 ? '这种题都做对了，哼' : mascotPick(MASCOT_LINES.done)
  mascotSay(text, 'happy', 6)
}

export function mascotGreetOnce() {
  if (greeted) return
  greeted = true
  mascotSay(mascotPick(MASCOT_LINES.idleReady), 'idle', 5)
}

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

export function mascotTouch() { mascotState.lastSay = Date.now() }

export function mascotSetActive(v) { mascotState.active = !!v }
