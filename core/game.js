/**
 * game.js —— 鼓励机制（经验值 / 等级 / 连续天数 / 成就）
 *
 * 这一层只做纯计算，不碰 DOM、不碰 localStorage：页面把「这一场答了什么」喂进来，
 * 它吐回新的存档与「这场新解锁了什么」。所有数字写死在下面的常量里，改规则只改这里。
 */

export const DAILY_GOAL = 60            // 每天的经验目标
export const STREAK_MIN_XP = 20         // 当天攒够这么多 XP 才算「今天练过」，连续天数才 +1
export const BADGE_SOFT = 3             // 展示用：成就墙一行几个

/** 单题经验：第一次答对给得最多，复习答对少一点，答错也给参与分（不然不敢做难题） */
export function xpForAnswer({ correct, firstTime, self }) {
  if (self === 'full') return 8
  if (self === 'half') return 5
  if (self === 'none') return 2
  if (correct === true) return firstTime ? 10 : 6
  if (correct === false) return 2
  return 0
}

/** 等级曲线：升到下一级要 60 + 40×(当前级−1) 点，累计需求见 cumNeeded() */
export function needForLevel(level) {
  return 60 + 40 * (level - 1)
}
export function cumNeeded(level) {
  let sum = 0
  for (let l = 1; l < level; l++) sum += needForLevel(l)
  return sum
}

/** xp → { level, into, need, pct } */
export function levelOf(xp) {
  let level = 1
  while (xp >= cumNeeded(level + 1)) level++
  const base = cumNeeded(level)
  const need = needForLevel(level)
  const into = xp - base
  return { level, into, need, pct: Math.max(0, Math.min(1, into / need)) }
}

export function emptyGame() {
  return {
    xp: 0,
    streak: 0,
    lastDoneDay: '',
    todayXp: 0,
    todayDay: '',
    answered: 0,
    sessions: 0,
    bestCorrectStreak: 0,
    badges: {},          // id → 解锁那天的 YYYY-MM-DD
  }
}

/** 本地日期 YYYY-MM-DD（不依赖时区库；跨天判断统一用它） */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(y, m - 1, d + delta)
  return dayKey(t.getTime())
}

/** 把存档里「今天」的那一格对齐到当前日期（跨天清零今日经验，但不动连续天数） */
export function rollDay(game, today) {
  if (game.todayDay === today) return game
  return { ...game, todayDay: today, todayXp: 0 }
}

/**
 * 结算一场：把这场攒的 xp 记进去，按规则更新今日经验、连续天数、作答总数。
 * ctx: { today, sessionXp, answered, bestCorrectStreak, hour }
 */
export function settleSession(game, ctx) {
  const today = ctx.today || dayKey()
  const g = rollDay(game, today)
  const todayXp = g.todayXp + Math.max(0, ctx.sessionXp || 0)
  let streak = g.streak
  let lastDoneDay = g.lastDoneDay
  const qualified = todayXp >= STREAK_MIN_XP
  if (qualified && lastDoneDay !== today) {
    streak = lastDoneDay && shiftDay(lastDoneDay, 1) === today ? streak + 1 : 1
    lastDoneDay = today
  }
  return {
    ...g,
    xp: g.xp + Math.max(0, ctx.sessionXp || 0),
    todayXp,
    streak,
    lastDoneDay,
    answered: g.answered + (ctx.answered || 0),
    sessions: g.sessions + 1,
    bestCorrectStreak: Math.max(g.bestCorrectStreak || 0, ctx.bestCorrectStreak || 0),
  }
}

/** 成就表：都是可判定的，没有「努力」「坚持」这种判定不了的说法 */
export const BADGES = [
  { id: 'first', icon: '🌱', name: '开张', desc: '完成第一场练习' },
  { id: 'perfect', icon: '🎯', name: '全中', desc: '一场练习全对（至少 8 题）' },
  { id: 'streak10', icon: '🔥', name: '十连', desc: '连续答对 10 题（不中断）' },
  { id: 'day100', icon: '💥', name: '单日百点', desc: '一天攒到 100 XP' },
  { id: 'streak7', icon: '📅', name: '七日不断', desc: '连续 7 天练过' },
  { id: 'streak30', icon: '🏔️', name: '三十日不断', desc: '连续 30 天练过' },
  { id: 'q100', icon: '📚', name: '百题', desc: '累计做满 100 题' },
  { id: 'q500', icon: '🗂️', name: '五百题', desc: '累计做满 500 题' },
  { id: 'level5', icon: '⭐', name: '五级', desc: '等级到 5' },
  { id: 'level10', icon: '🌟', name: '十级', desc: '等级到 10' },
  { id: 'night', icon: '🌙', name: '夜里也在', desc: '22 点以后还在练' },
  { id: 'early', icon: '🌅', name: '早起的', desc: '7 点以前开始练' },
]

/** 判定这场新解锁了哪些成就（已经有的不再返回） */
export function newBadges(game, ctx) {
  const today = ctx.today || dayKey()
  const lv = levelOf(game.xp).level
  const has = (id) => Boolean(game.badges[id])
  const hit = {
    first: game.sessions >= 1,
    perfect: (ctx.answered || 0) >= 8 && (ctx.correct || 0) === ctx.answered,
    streak10: (ctx.bestCorrectStreak || 0) >= 10,
    day100: game.todayXp >= 100,
    streak7: game.streak >= 7,
    streak30: game.streak >= 30,
    q100: game.answered >= 100,
    q500: game.answered >= 500,
    level5: lv >= 5,
    level10: lv >= 10,
    night: typeof ctx.hour === 'number' && ctx.hour >= 22,
    early: typeof ctx.hour === 'number' && ctx.hour < 7,
  }
  return BADGES.filter((b) => hit[b.id] && !has(b.id)).map((b) => ({ ...b, day: today }))
}

/** 把新解锁的写回存档 */
export function withBadges(game, fresh) {
  if (!fresh.length) return game
  const badges = { ...game.badges }
  for (const b of fresh) badges[b.id] = b.day
  return { ...game, badges }
}
