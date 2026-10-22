/**
 * mascot.js —— 蓝色大肥鱼（DeepSeek 拟人形象），页角的看护人
 *
 * 形象：蓝发小少女（藏青长发带亮蓝发尾、鱼鳍耳、白花边发饰、深蓝水手裙配白围裙、金铃铛、身后鲸尾），
 *      傲娇脸：大蓝眼 + 细眉 + 小嘟嘴。取自 B 站「蓝色大肥鱼」这个 DeepSeek 拟人形象（原角色 zipzippipe）。
 *      手绘 SVG 是简化版，认得出就行；四个心情靠换嘴型（m-mouth-*）和轻轻歪头。
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
<svg viewBox="2 4 128 126" width="100%" height="100%" aria-hidden="true">
<defs>
  <linearGradient id="mg-hair" x1="0.2" y1="0" x2="0.6" y2="1">
    <stop offset="0" stop-color="#2b3d84"/><stop offset="0.6" stop-color="#22306b"/><stop offset="1" stop-color="#4049b8"/>
  </linearGradient>
  <linearGradient id="mg-hairTip" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3d51b5"/><stop offset="1" stop-color="#6c8bff"/>
  </linearGradient>
  <linearGradient id="mg-iris" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#b9d7ff"/><stop offset="0.45" stop-color="#4f86f2"/><stop offset="1" stop-color="#1b3a94"/>
  </linearGradient>
  <linearGradient id="mg-dress" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#232f57"/><stop offset="1" stop-color="#1a2344"/>
  </linearGradient>
  <linearGradient id="mg-tail" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4257c4"/><stop offset="1" stop-color="#6f92ff"/>
  </linearGradient>
</defs>


<!-- 鲸尾 -->
<path d="M80 106 C96 108 110 100 118 88 C122 102 114 116 98 120 C88 122 80 118 78 110 Z" fill="url(#mg-tail)"/>
<path d="M112 90 C120 86 128 88 132 94 C125 93 119 95 115 99 Z" fill="url(#mg-tail)" opacity="0.9"/>

<!-- 后发 -->
<path d="M41 50 C39 28 50 16 64 16 C78 16 89 28 87 50
         C90 64 88 78 84 88 L79 84 L76 94 L70 88 L64 96 L58 88 L52 94 L49 84 L44 88
         C40 78 38 64 41 50 Z" fill="url(#mg-hair)"/>
<!-- 发尾提亮 -->
<path d="M47 84 C50 92 55 97 60 100 L64 96 L58 88 Z" fill="url(#mg-hairTip)" opacity="0.8"/>
<path d="M81 84 C78 92 73 97 68 100 L64 96 L70 88 Z" fill="url(#mg-hairTip)" opacity="0.8"/>

<!-- 呆毛 -->
<path d="M64 16 C62 9 65 5 71 3 C67 8 67 12 68 17 Z" fill="url(#mg-hair)"/>

<!-- 头顶小白花边 -->
<g fill="#ffffff" stroke="#dfe6f7" stroke-width="0.8">
  <path d="M48 26 q4 -6 8 0 q-4 3 -8 0 Z"/>
  <path d="M58 22 q4 -6 8 0 q-4 3 -8 0 Z"/>
  <path d="M68 26 q4 -6 8 0 q-4 3 -8 0 Z"/>
</g>

<!-- 头 -->
<circle cx="64" cy="48" r="21.5" fill="#ffe6d3"/>

<!-- 刘海：中分三撇 -->
<path d="M42.5 50 C44 30 53 21 64 21 C75 21 84 30 85.5 50
         C83 39 78 34 71 36 C71.5 42 68 46 64 48 C60 46 57 42 57.5 36 C50 34 45 39 42.5 50 Z" fill="url(#mg-hair)"/>

<!-- 鱼鳍耳 -->
<g stroke="#8fb2ff" stroke-width="0.7">
  <path d="M43 52 C33 48 24 51 20 58 C28 56 34 58 39 63 Z" fill="#4c7bf0"/>
  <path d="M85 52 C95 48 104 51 108 58 C100 56 94 58 89 63 Z" fill="#4c7bf0"/>
  <path d="M42 60 C34 59 27 62 25 68 C32 66 37 67 41 70 Z" fill="#6e97f8"/>
  <path d="M86 60 C94 59 101 62 103 68 C96 66 91 67 87 70 Z" fill="#6e97f8"/>
</g>

<!-- 眼睛 -->
<ellipse cx="54" cy="51" rx="7.6" ry="8.4" fill="#ffffff"/>
<ellipse cx="74" cy="51" rx="7.6" ry="8.4" fill="#ffffff"/>
<circle cx="54.4" cy="51.8" r="5.3" fill="url(#mg-iris)"/>
<circle cx="74.4" cy="51.8" r="5.3" fill="url(#mg-iris)"/>
<circle cx="54.4" cy="52.2" r="2.2" fill="#151f44"/>
<circle cx="74.4" cy="52.2" r="2.2" fill="#151f44"/>
<circle cx="52.6" cy="49.6" r="1.9" fill="#ffffff"/>
<circle cx="72.6" cy="49.6" r="1.9" fill="#ffffff"/>
<circle cx="56.4" cy="54.4" r="0.9" fill="#ffffff" opacity="0.9"/>
<circle cx="76.4" cy="54.4" r="0.9" fill="#ffffff" opacity="0.9"/>
<path d="M47 46 q7 -4.4 14 -0.6" fill="none" stroke="#2e3a63" stroke-width="1.5" stroke-linecap="round"/>
<path d="M67 45.6 q7 -4 14 0.4" fill="none" stroke="#2e3a63" stroke-width="1.5" stroke-linecap="round"/>
<!-- 眉 -->
<path d="M48.5 40 q6 -2 11 0" fill="none" stroke="#3d51b5" stroke-width="1.4" stroke-linecap="round"/>
<path d="M68.5 40 q6 -1.6 11 0.4" fill="none" stroke="#3d51b5" stroke-width="1.4" stroke-linecap="round"/>
<!-- 腮红 -->
<ellipse cx="45" cy="58" rx="4.6" ry="2.8" fill="#ffb0b8" opacity="0.55"/>
<ellipse cx="83" cy="58" rx="4.6" ry="2.8" fill="#ffb0b8" opacity="0.55"/>

<!-- 嘴 -->
<ellipse class="m-mouth m-mouth-idle" cx="64" cy="62" rx="2.2" ry="2.7" fill="#b8455a"/>
<path class="m-mouth m-mouth-happy" d="M59.5 60.5 q4.5 6 9 0 q-4.5 2.2 -9 0 Z" fill="#b8455a"/>
<path class="m-mouth m-mouth-sad" d="M60.5 63.5 q3.5 -3 7 0" fill="none" stroke="#b8455a" stroke-width="1.8" stroke-linecap="round"/>
<path class="m-mouth m-mouth-think" d="M60.5 62 h7" fill="none" stroke="#b8455a" stroke-width="1.8" stroke-linecap="round"/>

<!-- 身体 -->
<path d="M64 68 C55 68 49 74 47 82 L45 104 C55 110 73 110 83 104 L81 82 C79 74 73 68 64 68 Z" fill="url(#mg-dress)"/>
<!-- 白围裙 -->
<path d="M56 74 L72 74 L74 102 C68 106 60 106 54 102 Z" fill="#ffffff" opacity="0.95"/>
<!-- 水手领 -->
<path d="M52 70 q12 8 24 0 l-2.4 6 q-9.6 5.4 -19.2 0 Z" fill="#e8eefc"/>
<circle cx="64" cy="75" r="2.2" fill="#f2c14e"/>
<!-- 手 -->
<path d="M49 80 q-6 6 -4 12 q4.5 -1.5 6 -7 Z" fill="#ffe6d3"/>
<path d="M79 80 q6 6 4 12 q-4.5 -1.5 -6 -7 Z" fill="#ffe6d3"/>
<!-- 裙摆花边 -->
<path d="M45 104 q4 5 8 0 q4 5 8 0 q4 5 8 0 q4 5 8 0" fill="none" stroke="#e8eefc" stroke-width="1.3"/>
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
