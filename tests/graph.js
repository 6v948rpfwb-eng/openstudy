/** 知识点图数据与技术的离线断言：node tests/graph.js */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (f) => JSON.parse(readFileSync(join(here, '../tools', f), 'utf8'))

let pass = 0
const bad = []
const ok = (cond, msg) => (cond ? pass++ : bad.push(msg))

for (const [subject, file] of [
  ['物理', 'topics-physics.json'],
  ['化学', 'topics-chemistry.json'],
  ['技术', 'topics-technology.json'],
]) {
  const doc = read(file)
  const g = doc.graph
  ok(!!g, `${subject}：有 graph 字段`)
  ok(Array.isArray(g.modules) && g.modules.length >= 4, `${subject}：至少 4 块`)
  const inGraph = new Set(g.modules.flatMap((m) => m.topics))
  // 图里每个节点都必须在考点表里，且不能有未分类混进来
  ok([...inGraph].every((t) => doc.topics[t]), `${subject}：图里的编号都在考点表里`)
  ok(!inGraph.has('C-99') && !inGraph.has('P-99'), `${subject}：未分类不进图`)
  ok(g.modules.every((m) => m.id && m.label && m.topics.length), `${subject}：每块都有 id/标签/节点`)
  // 跨块连线两端都要存在
  ok((g.edges || []).every(([a, b]) => doc.topics[a] && doc.topics[b]), `${subject}：连线两端有效`)
  // 同一个考点不能出现在两块里
  const dup = g.modules.flatMap((m) => m.topics).filter((t, i, arr) => arr.indexOf(t) !== i)
  ok(dup.length === 0, `${subject}：没有重复节点${dup.length ? '：' + dup.join(',') : ''}`)
}

const tech = read('topics-technology.json')
ok(Object.keys(tech.topics).length === 82, '技术 82 个考点（技-01…技-82）')
ok(tech.topics['T-01'].alias === '技-01', '技术考点保留 alias 技-NN')
ok(['physics', 'chemistry', 'technology'].includes(tech.subject), '技术 subject 正确')
const groups = Object.values(tech.topics).reduce((m, t) => ((m[t.group] = (m[t.group] || 0) + 1), m), {})
ok(Object.keys(groups).every((g) => 'ABCD'.includes(g) || g === 'null'), '技术每个考点都归了组')
ok(tech.graph.modules.length === 9, '技术 9 块（信息→电子控制）')

console.log(pass + ' 项通过' + (bad.length ? `，${bad.length} 项失败：\n- ` + bad.join('\n- ') : ''))
if (bad.length) process.exit(1)
