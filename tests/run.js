/**
 * run.js —— 不装任何东西，直接跑：node tests/run.js
 *
 * 它做四件事：
 *   1. 校验题库
 *   2. 组一张卷，打印难度分布
 *   3. 模拟作答并结算
 *   4. 打印复习排程
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { loadBank, validateBank } from '../core/bank.js'
import { composePaper } from '../core/select.js'
import { grade } from '../core/grade.js'
import { emptyState, finishSession, dueTopics } from '../core/state.js'
import { describeTheta } from '../core/irt.js'

const here = dirname(fileURLToPath(import.meta.url))
const bankPath = join(here, '..', 'data', 'example.bank.json')

const line = (s = '') => console.log(s)

line('=== 1. 加载题库 ===')
const { bank, warnings } = loadBank(readFileSync(bankPath, 'utf8'))
line(`学科：${bank.title}（${bank.subject}）`)
line(`考点 ${Object.keys(bank.topics).length} 个，题目 ${bank.questions.length} 道`)
if (warnings.length) {
  line('提醒：')
  for (const w of warnings) line('  - ' + w)
}

line()
line('=== 2. 组卷（θ = 0.35）===')
const { picked, meta } = composePaper(bank, { theta: 0.35, n: 6 })
for (const q of picked) {
  line(`  [${q.id}] 难度 ${q.difficulty.toFixed(2)}  ${q.stem.slice(0, 30)}`)
}
line(`难度分布：min ${meta.difficultySpread.min} / mean ${meta.difficultySpread.mean} / max ${meta.difficultySpread.max}`)
line(`实际出题 ${meta.actual} 道`)

line()
line('=== 3. 模拟作答 ===')
const state = emptyState(bank.subject)
const answers = picked.map((q, i) => {
  // 故意让后半部分答错，看能力会不会降
  let input
  if (q.type === 'text') input = 'none'
  else if (q.type === 'choice') input = i < picked.length / 2 ? q.answer.value : 0
  else input = i < picked.length / 2 ? q.answer.value[0] : -999

  const g = grade(q, input)
  line(`  [${q.id}] ${g.correct ? '对' : '错'}  ${g.reason ?? ''}`)
  return { question: q, correct: g.correct === true, input }
})

line()
line('=== 4. 结算 ===')
const { report } = finishSession(state, bank, answers)
line(`答对 ${report.correct} / ${report.asked}，正确率 ${(report.accuracy * 100).toFixed(0)}%`)
line(`能力 θ：${report.thetaBefore} → ${report.thetaAfter}（${report.thetaDelta >= 0 ? '+' : ''}${report.thetaDelta}），${report.level}`)
line('各考点：')
for (const t of report.topicUpdates) {
  line(`  ${t.topicId} ${t.name}：${t.correct}/${t.asked}，下次 ${t.nextDueDays} 天后`)
}

line()
line('=== 5. 复习排程 ===')
const due = dueTopics(state, bank, Date.now() + 2 * 86400000) // 假装过了两天
if (due.length === 0) line('  （两天后没有到期的考点）')
for (const d of due) line(`  ${d.topicId} ${d.name}：逾期 ${d.lateDays} 天`)

line()
line('=== 6. 校验器自身的测试 ===')
const bad = validateBank({
  subject: 'x',
  topics: { A: { name: 'a' } },
  questions: [{ id: 'q1', topic: 'A', type: 'numeric', difficulty: 2, stem: 'x', answer: { value: 1 } }],
})
line(`故意给一个难度=2、无来源的题 → ok=${bad.ok}`)
for (const e of bad.errors) line('  ✗ ' + e)

line()
line('=== 7. 独立表现 vs 重复表现 ===')
{
  const q = bank.questions.find((x) => x.type === 'numeric') ?? bank.questions[0]
  line(`用同一道题（id ${q.id}，难度 ${q.difficulty}）连做三遍，全答对：`)

  const s = emptyState('测试')
  const r1 = finishSession(s, bank, [{ question: q, correct: true }]).report
  const r2 = finishSession(s, bank, [{ question: q, correct: true }]).report
  const r3 = finishSession(s, bank, [{ question: q, correct: true }]).report

  const show = (tag, r) =>
    line(`  ${tag}  θ ${r.thetaBefore} → ${r.thetaAfter}  涨 ${r.thetaDelta}  证据权重 ${r.trace[0].weight.toFixed(3)}`)
  show('第1遍（新题）', r1)
  show('第2遍（重复）', r2)
  show('第3遍（重复）', r3)

  const ok1 = r1.thetaDelta > r2.thetaDelta && r2.thetaDelta > r3.thetaDelta && r3.thetaDelta > 0
  line(`  → 增幅递减：${ok1 ? '对' : '错'}`)

  // 重复题答错不打折
  const s2 = emptyState('测试')
  finishSession(s2, bank, [{ question: q, correct: true }])
  const rw = finishSession(s2, bank, [{ question: q, correct: false }]).report
  line(`  重复题答错：证据权重 ${rw.trace[0].weight.toFixed(3)}（应保持 1，答错是硬证据）`)

  // 主观题不计入能力
  const s3 = emptyState('测试')
  const rt = finishSession(s3, bank, [{ question: q, correct: true, countsForTheta: false }]).report
  line(`  主观题（countsForTheta:false）：θ ${rt.thetaBefore} → ${rt.thetaAfter}，计入 ${rt.scored} 道、跳过 ${rt.unscored} 道`)
  line(`  → θ 未变：${rt.thetaAfter === rt.thetaBefore ? '对' : '错'}`)

  // 组卷时新题优先
  const { meta: m2 } = composePaper(bank, { theta: 0.35, n: 6, progress: s })
  line(`  带上"做过 3 遍"的记录再组 6 题：新题 ${m2.pickedFresh} 道 / 重复题 ${m2.pickedRepeat} 道`)
}

line()
line('=== 8. 一题一结算（不限模式靠的就是它）===')
{
  const s = emptyState('测试')
  const q = bank.questions.find((x) => x.type === 'numeric') || bank.questions[0]

  // 连做 3 题，每次都只传一条答案，模拟「做一题结算一题」
  const thetaPath = [s.theta]
  for (let i = 0; i < 3; i += 1) {
    const { state, report } = finishSession(s, bank, [{ question: q, correct: true }])
    Object.assign(s, state)
    thetaPath.push(s.theta)
    line(`  第 ${i + 1} 题结算：计入 ${report.scored} 道 / 跳过 ${report.unscored} 道，θ ${report.thetaBefore} → ${report.thetaAfter}`)
    if (report.scored !== 1) { line('  → 单题结算应只计入 1 道，出错'); process.exitCode = 1 }
  }
  line(`  θ 轨迹：${thetaPath.map((v) => v.toFixed(3)).join(' → ')}`)
  const rose = thetaPath.every((v, i) => i === 0 || v > thetaPath[i - 1])
  line(`  → 每次都涨：${rose ? '对' : '错'}`)
  if (!rose) process.exitCode = 1

  line(`  seen 记录：${q.id} 做了 ${s.seen?.[q.id]?.times ?? 0} 次（应为 3）`)
  if ((s.seen?.[q.id]?.times ?? 0) !== 3) process.exitCode = 1

  // 答错也要能单题结算
  const { report: rBad } = finishSession(s, bank, [{ question: q, correct: false }])
  line(`  再答错一次：θ ${rBad.thetaBefore} → ${rBad.thetaAfter}（应下降）`)
  if (!(rBad.thetaAfter < rBad.thetaBefore)) { line('  → 答错θ未下降，出错'); process.exitCode = 1 }
}

line()
line(`能力描述：θ=0.2 → ${describeTheta(0.2)}；θ=0.5 → ${describeTheta(0.5)}；θ=0.9 → ${describeTheta(0.9)}`)
line('全部跑通。')
