#!/usr/bin/env node
/**
 * sync-bank-topics.js —— 把考点表的最新字段同步进题库 JSON
 *
 * 为什么需要：题库里的 topics 是导入那一刻的副本，后来 build-state.js 往
 * tools/topics-*.json 写了 mastered / retry / state，题库副本不会自动更新，
 * 于是页面会显示「已掌握 0 个考点」。改完考点表就跑一次这个。
 *
 * 用法：node tools/sync-bank-topics.js
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = join(here, '..', 'openstudy-data')
const KEEP = ['name', 'desc', 'group', 'alias', 'cues', 'state', 'mastered', 'retry', 'stateDetail', 'extraSteps', 'extraChecks']

let touched = 0
for (const subject of ['physics', 'chemistry', 'technology', 'math']) {
  const topicsFile = join(here, `topics-${subject}.json`)
  const bankFile = join(DATA, `${subject}.bank.json`)
  if (!existsSync(topicsFile) || !existsSync(bankFile)) continue
  const doc = JSON.parse(readFileSync(topicsFile, 'utf8'))
  const bank = JSON.parse(readFileSync(bankFile, 'utf8'))
  let merged = 0
  for (const [id, t] of Object.entries(bank.topics)) {
    const src = doc.topics[id]
    if (!src) continue
    for (const k of KEEP) if (src[k] !== undefined) t[k] = src[k]
    merged++
  }
  // 考点表里有、题库里没有的（C-99 这类占位）也补进去，页面的「各考点」表才完整
  for (const [id, src] of Object.entries(doc.topics)) {
    if (bank.topics[id]) continue
    const t = {}
    for (const k of KEEP) if (src[k] !== undefined) t[k] = src[k]
    bank.topics[id] = t
  }
  writeFileSync(bankFile, JSON.stringify(bank, null, 2) + '\n', 'utf8')
  const mastered = Object.values(bank.topics).filter((t) => t.mastered && !t.retry).length
  console.log(`${subject}: 同步 ${merged} 个考点，题库现有 ${Object.keys(bank.topics).length} 个考点，其中已掌握 ${mastered}`)
  touched++
}
if (!touched) console.log('没有可同步的题库（openstudy-data/ 下有 physics.bank.json / chemistry.bank.json 才会同步）')
