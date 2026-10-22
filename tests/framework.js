/** framework.js 的离线断言：node tests/framework.js */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { GROUP_ORDER, groupOf, groupStepsFor, checksFor, guessTopics, loadForTopic } from '../core/framework.js'

const here = dirname(fileURLToPath(import.meta.url))
const doc = JSON.parse(readFileSync(join(here, '../tools/topics-chemistry.json'), 'utf8'))

let pass = 0
const bad = []
const ok = (cond, msg) => (cond ? pass++ : bad.push(msg))

ok(Object.keys(doc.groups).length === 4, '四组')
ok(GROUP_ORDER.every((g) => doc.groups[g]?.steps?.length > 0), '每组都有动作序列')
ok(Object.keys(doc.topics).length === 46, '化学 46 个考点（45 + 未分类 C-99）')
ok(doc.topics['C-99']?.group === null, 'C-99 未分类没有组别')

ok(groupOf(doc, 'C-02') === 'C', 'C-02 属 C 组')
ok(groupOf(doc, 'C-32') === 'A', 'C-32 属 A 组')
ok(groupOf(doc, 'C-00') === null, '不存在的考点返回 null')

const steps = groupStepsFor(doc, 'C-02')
ok(steps.length >= 4, 'C 组动作序列至少 4 步')
ok(steps[0].includes('触发点'), 'C 组第一步是认触发点')

const checks = checksFor(doc, 'C-32')
ok(checks.some((c) => c.includes('均摊法')), 'C-32 的必查项含均摊法')
ok(checks.length > doc.groups.A.checks.length, '条目级必查项比组级多')

const g = guessTopics(doc, '下列电子排布式书写正确的是，核素符号为 ¹⁴²Nd')
ok(g.length > 0 && g[0].topicId === 'C-02', '特征词能命中 C-02')

const view = loadForTopic(doc, 'C-13')
ok(view.groupName === '条件→方程→边界', 'C-13 组名正确')
ok(view.errorType === '方法性', 'C-13 错误类型为方法性')

ok(loadForTopic(doc, 'C-00') === null, '不存在的考点返回 null')

console.log(bad.length ? '✗ 失败：\n  ' + bad.join('\n  ') : `✓ 全部通过（${pass} 项）`)
if (bad.length) process.exitCode = 1
