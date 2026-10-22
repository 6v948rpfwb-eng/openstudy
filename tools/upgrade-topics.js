#!/usr/bin/env node
/**
 * upgrade-topics.js —— 把 v1 考点表（只有 name/desc + rules.keywords）升级成 v2（四组 + cues）
 *
 * 为什么单独一步：v1 的 keywords 是给导入器用的（rules 数组），v2 的 cues 是给
 * 方法论视图与归考点用的（挂在考点上）。升级时 keywords 原样搬进 cues，
 * rules 一并保留——导入器（import-md.js）照旧读 rules，不受影响。
 *
 * 用法：node tools/upgrade-topics.js physics
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const subject = process.argv[2]
if (!subject) { console.error('用法：node tools/upgrade-topics.js <学科代号，如 physics>'); process.exit(2) }

const file = join(here, `topics-${subject}.json`)
const v1 = JSON.parse(readFileSync(file, 'utf8'))
if (v1.schema && v1.schema.startsWith('openstudy.topics/2')) { console.log(`${file} 已经是 v2，不改`); process.exit(0) }

// 四组定义以 topics-chemistry.json 为准（第一个 v2 文件），避免两处漂移
const chem = JSON.parse(readFileSync(join(here, 'topics-chemistry.json'), 'utf8'))
const groups = chem.groups

// 物理各考点的组别（按「判据形状 / 动作序列 / 检验方式」判，不是按章节）
const PHYS_GROUP = {
  'P-01': 'A', 'P-02': 'A', 'P-03': 'A', 'P-04': 'A', 'P-05': 'A', 'P-06': 'A',
  'P-07': 'A', 'P-08': 'A', 'P-09': 'A', 'P-10': 'A', 'P-11': 'A', 'P-12': 'A',
  'P-13': 'C',   // 近代物理：记住结论型，会写错字
  'P-14': 'B',   // 力学实验：看图/看数据判对错
  'P-98': 'B',   // 综合判断
  'P-99': null,  // 未分类
}

// rules 里每个 topic 的关键词合并进 cues
const cueMap = {}
for (const r of v1.rules ?? []) {
  const id = r.topic
  if (!id) continue
  cueMap[id] = cueMap[id] ?? []
  for (const kw of r.keywords ?? []) if (!cueMap[id].includes(kw)) cueMap[id].push(kw)
}

const topics = {}
for (const [id, t] of Object.entries(v1.topics)) {
  topics[id] = {
    alias: id,
    name: t.name,
    desc: t.desc,
    group: PHYS_GROUP[id] ?? null,
    cues: cueMap[id] ?? [],
    ...(cueMap[id]?.length ? {} : { fillMe: true }),
  }
}

const out = {
  _说明: '考点表 v2（四组 + cues）。rules 保留给 import-md.js 归考点用；cues 给方法论视图用。归错直接改本文件重跑。',
  schema: 'openstudy.topics/2',
  subject: v1.subject ?? subject,
  title: v1.title,
  source: 'tools/topics-physics.json v1 + 学科-通用/知识状态/考点索引.md',
  groups,
  topics,
  rules: v1.rules ?? [],
}
writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`已升级 ${file}：${Object.keys(topics).length} 个考点，组别 ${JSON.stringify(
  Object.values(topics).reduce((m, t) => (m[t.group ?? 'null'] = (m[t.group ?? 'null'] ?? 0) + 1, m), {}))}`)
