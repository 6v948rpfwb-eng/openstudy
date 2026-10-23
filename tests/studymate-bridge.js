#!/usr/bin/env node
/**
 * tests/studymate-bridge.js —— 题库桥的离线断言
 *
 * 跑法：node tests/studymate-bridge.js（零依赖，自己造样例课件，不碰真实工作区）
 * 守的是：只收「客观题」且字段齐全；topic 必须是考点表里的字符串 id；
 *        id 唯一；answer 存下标数组；export 出来的三档与误解条目形状正确。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const work = mkdtempSync(join(tmpdir(), 'smbridge-'))

let pass = 0
let fail = 0
const ok = (cond, name, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.log(`✗ ${name}${extra ? '  ' + extra : ''}`)
}

// ── 造样例：一份课件、三种题型混排、有一道字段不全 ──────────────────────
mkdirSync(join(work, 'lessons'))
writeFileSync(join(work, 'lessons', '0001-demo.quiz.json'), JSON.stringify({
  '函数 y=ax^2+bx+c 的开口由 a 决定。': [
    { kind: '客观题', q: 'y=2x^2 开口方向？', opts: ['向上', '向下'], ans: 0, why: 'a=2>0' },
    { q: 'y=-x^2 顶点坐标？', opts: ['(0,0)', '(1,0)', '(-1,0)'], ans: 0, why: '顶点在对称轴处' },
    { kind: '客观题', q: '字段不全的题', opts: ['只有一个'], ans: 0 },
  ],
  '二次函数对称轴是 x=-b/(2a)。': [
    { kind: '预测验证', 预测: '对称轴在 y 轴右侧', 比对: 'b=0 时就是 y 轴' },
    { kind: '客观题', q: 'y=x^2-2x 的对称轴？', opts: ['x=1', 'x=-1'], ans: 0, why: '-b/2a=1' },
  ],
}))

const bankPath = join(work, 'math.bank.json')
const out = execFileSync(process.execPath, [
  join(root, 'tools', 'studymate-bridge.js'), 'import',
  '--dir', work, '--subject', 'math',
  '--topics', join(root, 'tools', 'topics-math.json'),
  '--out', bankPath,
], { encoding: 'utf8' })

const bank = JSON.parse(readFileSync(bankPath, 'utf8'))
const topicsDoc = JSON.parse(readFileSync(join(root, 'tools', 'topics-math.json'), 'utf8'))

ok(bank.questions.length === 3, '只收 3 道客观题（跳过预测验证与字段不全）', `实得 ${bank.questions.length}`)
ok(/跳过非客观题 1/.test(out), '统计里记下跳过的非客观题', out.trim())
ok(/字段不全 1/.test(out), '统计里记下字段不全的题', out.trim())
ok(bank.questions.every((q) => typeof q.topic === 'string'), 'topic 是字符串')
ok(bank.questions.every((q) => bank.topics[q.topic]), '每个 topic 都在考点表里')
ok(new Set(bank.questions.map((q) => q.id)).size === bank.questions.length, 'id 不重复')
ok(bank.questions.every((q) => q.id.startsWith('sm-')), 'id 带 sm- 前缀')
ok(bank.questions.every((q) => q.type === 'choice'), '题型统一为 choice')
ok(bank.questions.every((q) => Array.isArray(q.choices) && q.choices.length >= 2), '选项至少两项')
ok(bank.questions.every((q) => Array.isArray(q.answer.value) && q.answer.value.length === 1), 'answer.value 存一个下标')
ok(bank.questions.every((q) => /StudyMate · .+ 第\d+题/.test(q.source)), 'source 记下了来源课件与题号', bank.questions[0]?.source)
ok(bank.questions.every((q) => typeof q.anchorText === 'string' && q.anchorText.length > 0), '保留了锚点原文')

// ── 反向导出 ─────────────────────────────────────────────────────────
const outDir = join(work, 'sm-out')
mkdirSync(outDir)
execFileSync(process.execPath, [
  join(root, 'tools', 'studymate-bridge.js'), 'export',
  '--subject', 'physics', '--out-dir', outDir,
], { encoding: 'utf8' })

const progress = JSON.parse(readFileSync(join(outDir, 'progress.json'), 'utf8'))
const statuses = new Set(Object.values(progress.nodes).map((n) => n.status))
ok(Object.keys(progress.nodes).length > 0, 'progress 里有节点')
ok([...statuses].every((s) => ['未开始', '学习中', '已学完'].includes(s)), '三档词表合法', [...statuses].join(','))
ok(typeof progress.updated_at === 'string' && progress.project, 'progress 有 updated_at 与 project')

const miscon = readFileSync(join(outDir, 'misconceptions.yaml'), 'utf8')
ok(/^# 误解记录/m.test(miscon), 'misconceptions 有标题行')
ok(!/✅/.test(miscon), '误解记录里不含已掌握的条目')

console.log(`\n${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
