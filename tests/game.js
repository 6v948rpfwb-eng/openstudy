// game.js 的纯逻辑断言（不需要浏览器）
import {
  DAILY_GOAL, STREAK_MIN_XP, xpForAnswer, levelOf, cumNeeded,
  dayKey, rollDay, settleSession, newBadges, withBadges, emptyGame, BADGES,
} from '../core/game.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

console.log('单题经验')
ok(xpForAnswer({ correct: true, firstTime: true }) === 10, '首答对 10')
ok(xpForAnswer({ correct: true, firstTime: false }) === 6, '复习答对 6')
ok(xpForAnswer({ correct: false, firstTime: true }) === 2, '答错也给 2')
ok(xpForAnswer({ correct: true, self: 'full' }) === 8, '主观自评全对 8')
ok(xpForAnswer({ correct: true, self: 'half' }) === 5, '主观自评半对 5')

console.log('等级曲线')
ok(levelOf(0).level === 1, '0 XP 是 1 级')
ok(levelOf(59).level === 1 && levelOf(60).level === 2, '60 XP 升 2 级')
ok(cumNeeded(3) === 60 + 100, '3 级累计 160')
ok(Math.abs(levelOf(120).pct - 0.6) < 1e-9, '120 XP 时 2 级进度 60%')

console.log('跨天与连续天数')
const g1 = settleSession(emptyGame(), { today: '2026-10-20', sessionXp: 30, answered: 5, bestCorrectStreak: 3 })
ok(g1.streak === 1, '第一天练过 streak=1')
ok(g1.xp === 30 && g1.todayXp === 30, 'XP 与今日 XP 都记上')
const g2 = settleSession(g1, { today: '2026-10-21', sessionXp: 20, answered: 5, bestCorrectStreak: 1 })
ok(g2.streak === 2, '第二天接着练 streak=2')
const g3 = settleSession(g2, { today: '2026-10-23', sessionXp: 20, answered: 5, bestCorrectStreak: 1 })
ok(g3.streak === 1, '断了一天，streak 重置为 1')
const g4 = settleSession(g3, { today: '2026-10-23', sessionXp: 10, answered: 3, bestCorrectStreak: 1 })
ok(g4.streak === 1, '同一天再练不重复加天')
ok(g4.todayXp === 30, '同一天 XP 累加')
const low = settleSession(emptyGame(), { today: '2026-10-24', sessionXp: 5, answered: 1 })
ok(low.streak === 0, `不足 ${STREAK_MIN_XP} XP 不算今天练过`)

console.log('成就')
const g5 = settleSession(emptyGame(), { today: '2026-10-25', sessionXp: 120, answered: 12, bestCorrectStreak: 10 })
const fresh = newBadges(g5, { today: '2026-10-25', answered: 12, correct: 12, bestCorrectStreak: 10, hour: 21 })
const ids = fresh.map((b) => b.id).sort()
ok(ids.join(',') === 'day100,first,perfect,streak10', '解锁 开张/全中/十连/单日百点')
ok(newBadges(withBadges(g5, fresh), { today: '2026-10-25', answered: 12, correct: 12, bestCorrectStreak: 10 }).length === 0, '已解锁的不再重复出现')
const night = newBadges(g5, { today: '2026-10-25', answered: 1, correct: 0, hour: 23 }).map((b) => b.id)
ok(night.includes('night'), '22 点后练解锁「夜里也在」')
ok(BADGES.length === 12, '成就共 12 个')
ok(DAILY_GOAL === 60 && STREAK_MIN_XP === 20, '目标 60 XP、连续门槛 20 XP')

console.log('接线检查（源码级）')
import { readFileSync } from 'node:fs'
const appSrc = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
ok(/from '..\/core\/game.js'/.test(appSrc), 'app.js 引入了 game.js')
ok(/function settleGame\s*\(/.test(appSrc) && /settleGame\(\{ answered/.test(appSrc), '交卷时结算经验')
ok(/xpForAnswer\(\{ correct/.test(appSrc), '每答一题算经验')
ok(/\$\{gameStripHTML\(\)\}/.test(appSrc), '首页有等级/目标条')
ok(/\$\{xpPanelHTML\(\)\}/.test(appSrc), '结算页有经验面板')
ok(/\$\{badgeWallHTML\(\)\}/.test(appSrc), '首页有成就墙')

console.log('')
console.log(`通过 ${pass} 项，失败 ${fail} 项`)
if (fail) process.exit(1)
