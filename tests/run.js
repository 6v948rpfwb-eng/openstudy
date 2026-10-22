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
line(`能力描述：θ=0.2 → ${describeTheta(0.2)}；θ=0.5 → ${describeTheta(0.5)}；θ=0.9 → ${describeTheta(0.9)}`)
line('全部跑通。')
