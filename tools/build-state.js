#!/usr/bin/env node
/**
 * build-state.js —— 把《知识状态库》的已测结论写进考点表
 *
 * 目的：题库别再给他出「已经会了」的题。判定规则写在下面「判定规则」一节，
 * 有争议就改规则重跑，不要手改 topics-*.json 里的 state 字段。
 *
 * 数据源（只读）：
 *   高三学习/学科-通用/知识状态/知识状态库.md  —— 表格行：| 物-01 | 名称 | 状态 | 证据 | 错误类型 |
 * 映射：
 *   化学：考点表的 alias 就叫「化-01」，直接对上
 *   物理：考点表是 14 个粗分组（P-01…），索引是 39 个细项（物-01…），
 *         用下面的 PHYS_MAP 显式对应，不猜
 *
 * 判定规则：
 *   retry    = 组内有任何一条 🔴（当时没做出来）→ 出题时**照样要出**
 *   mastered = 组内至少一条已测，且全是 ✅，且没有 🔴 → 默认不再出（可在页面上关掉）
 *   state    = ✅（mastered）｜🔴（有错）｜🟡（有待确认）｜⬜（没测过）
 *
 * 用法：node tools/build-state.js [--dry-run]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DRY = process.argv.includes('--dry-run')
const STATE_MD = resolve(here, '../../../高三学习/学科-通用/知识状态/知识状态库.md')

// 物-01…物-39 → 考点表的 P 组（按考点名对应，不按顺序）
const PHYS_MAP = {
  'P-01': ['物-01', '物-02', '物-12'],
  'P-02': ['物-03'],
  'P-03': ['物-04'],
  'P-04': ['物-05', '物-06', '物-07'],
  'P-05': ['物-08', '物-09'],
  'P-06': ['物-10', '物-11'],
  'P-07': ['物-13', '物-14'],
  'P-08': ['物-15', '物-21', '物-22'],
  'P-09': ['物-16', '物-17', '物-20'],
  'P-10': ['物-18', '物-19'],
  'P-11': ['物-23', '物-24', '物-25', '物-26', '物-27', '物-28'],
  'P-12': ['物-29', '物-30', '物-31'],
  'P-13': ['物-32', '物-33', '物-34', '物-35', '物-36', '物-37', '物-38', '物-39'],
}

const md = readFileSync(STATE_MD, 'utf8')

/** 解析状态库里所有 `| 物-01 | … | 状态 | 证据 | 错误类型 |` 行 */
function parseRows() {
  const rows = new Map() // '物-01' -> { name, stateRaw, evidence, errorType }
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*([物化技数语英])-(\d{2})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/)
    if (!m) continue
    const id = `${m[1]}-${m[2]}`
    const stateRaw = m[4].trim()
    const flag = /✅/.test(stateRaw) ? '✅' : /🔴/.test(stateRaw) ? '🔴' : /🟡/.test(stateRaw) ? '🟡' : /⬜/.test(stateRaw) ? '⬜' : ''
    if (!flag) continue
    const prev = rows.get(id)
    // 同一编号出现两次（第 1 轮 / 第 2 轮）：保留更差的那个，宁可多练一次
    const order = { '✅': 0, '⬜': 1, '🟡': 2, '🔴': 3 }
    if (prev && order[prev.flag] >= order[flag]) continue
    rows.set(id, { name: m[3].trim(), flag, evidence: m[5].trim(), errorType: m[6].trim() })
  }
  return rows
}

function judge(items) {
  const seen = items.filter((x) => x && x.flag !== '⬜')
  const retry = seen.some((x) => x.flag === '🔴')
  const allOk = seen.length > 0 && seen.every((x) => x.flag === '✅')
  const mastered = allOk && !retry
  const state = mastered ? '✅' : retry ? '🔴' : seen.some((x) => x.flag === '🟡') ? '🟡' : '⬜'
  return { state, mastered, retry }
}

const rows = parseRows()
const report = []

for (const subject of ['physics', 'chemistry']) {
  const file = join(here, `topics-${subject}.json`)
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  let changed = 0
  for (const [id, t] of Object.entries(doc.topics)) {
    // 该考点对应的索引编号
    let ids = []
    if (subject === 'chemistry') ids = t.alias ? [t.alias] : []
    else ids = PHYS_MAP[id] ?? []
    const items = ids.map((k) => rows.get(k)).filter(Boolean)
    const { state, mastered, retry } = judge(items)
    const detail = ids.map((k) => (rows.has(k) ? `${k}${rows.get(k).flag}` : `${k}·`)).join(' ')
    const before = JSON.stringify({ s: t.state, m: t.mastered, r: t.retry })
    t.state = state
    t.mastered = mastered
    t.retry = retry
    t.stateDetail = detail
    if (items.length && !DRY) changed++
    if (before !== JSON.stringify({ s: t.state, m: t.mastered, r: t.retry })) changed++
  }
  if (!DRY) writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8')
  const tally = Object.values(doc.topics).reduce((m, t) => (m[t.state] = (m[t.state] ?? 0) + 1, m), {})
  report.push({ subject, tally, mastered: Object.values(doc.topics).filter((t) => t.mastered).map((t) => t.name) })
}

for (const r of report) {
  console.log(`\n${r.subject}：${JSON.stringify(r.tally)}`)
  console.log(`  已掌握、默认不再出：${r.mastered.length ? r.mastered.join('；') : '（无）'}`)
}
const unparsed = [...rows.keys()].length
console.log(`\n状态库解析到 ${unparsed} 条已测记录${DRY ? '（--dry-run，未写文件）' : '，已写回 topics-*.json'}`)
