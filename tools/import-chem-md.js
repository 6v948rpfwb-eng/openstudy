#!/usr/bin/env node
/**
 * import-chem-md.js —— 浙江选考化学真题 Markdown → 开卷题库 JSON
 *
 * 为什么不复用 import-md.js：物理卷的题号带粗体（`**1.**`）与 `**【答案】C**`，
 * 化学卷不一样——选择题是裸题号 `1.`，答案是表格（`| 题号 | 1 | 2 | …`＋`| 答案 | C | A | …`），
 * 非选择题答案在 `**17.**` 块里。硬改物理导入器风险大，这里单独写一个，解析规则各管各的。
 *
 * 不做的事：不联网、不改原文、不自己编题。原文没有的这里也没有。
 *
 * 用法：
 *   node tools/import-chem-md.js \
 *     --topics tools/topics-chemistry.json \
 *     --out openstudy-data/chemistry.bank.json \
 *     "../../高三学习/学科-化学/资料/2026-1月-浙江选考-化学-真题.md" \
 *     "../../高三学习/学科-化学/资料/2026-6月-浙江选考-化学-真题.md"
 *
 * 开关：--dry-run 只报告不写文件
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { validateBank } from '../core/bank.js'

const FULLWIDTH_SPACE = '\u3000'
const LETTERS = ['A', 'B', 'C', 'D']

function parseArgv(argv) {
  const opts = { topics: null, out: null, files: [], dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--topics') opts.topics = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--dry-run') opts.dryRun = true
    else if (a.startsWith('--')) throw new Error(`不认识的参数：${a}`)
    else opts.files.push(a)
  }
  return opts
}

/** 题号 → 难度：16 道选择 0.15→0.55，非选择 17–20 题 0.68→0.95 */
function difficultyOf(n) {
  if (n <= 16) return Math.round((0.15 + ((n - 1) * 0.4) / 15) * 1000) / 1000
  if (n <= 20) return Math.round((0.68 + ((n - 17) * 0.09) / 3) * 1000) / 1000
  return 0.85
}

/** 从正文里抠 A/B/C/D：先按「全角空格 + 字母.」切开，再按行找 */
function extractChoices(body) {
  const normalized = body.replace(new RegExp(`${FULLWIDTH_SPACE}(?=[A-D][\\.．])`, 'g'), '\n')
  const picked = new Map()
  for (const raw of normalized.split('\n')) {
    const line = raw.trim()
    const m = line.match(/^([A-D])[\.．]\s*(.*)$/)
    if (!m) continue
    const [, key, text] = m
    if (!picked.has(key)) picked.set(key, text.trim())
  }
  if (!picked.has('A') || !picked.has('B')) return null
  const keys = LETTERS.filter((k) => picked.has(k))
  const texts = keys.map((k) => picked.get(k))
  if (texts.filter((t) => t && t.trim()).length < 2) return null
  return texts
}

/** 选项块在正文里的起点（删题干用），找不到返回正文长度 */
function choiceStartIndex(body) {
  const normalized = body.replace(new RegExp(`${FULLWIDTH_SPACE}(?=[A-D][\\.．])`, 'g'), '\n')
  const idx = normalized.search(/(?:^|\n)\s*A[\.．]\s/)
  return idx < 0 ? body.length : idx
}

/** 答案区的表格：| 题号 | 1 | 2 | … |  下一行 | 答案 | C | A | … | */
function parseAnswerTables(answerText) {
  const map = new Map()
  const lines = answerText.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (!/^\|\s*题号\s*\|/.test(lines[i])) continue
    let ansLine = null
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      if (/^\|\s*答案\s*\|/.test(lines[j])) { ansLine = lines[j]; break }
    }
    if (!ansLine) continue
    const nums = lines[i].split('|').slice(1, -1).map((s) => s.trim())
    const vals = ansLine.split('|').slice(1, -1).map((s) => s.trim())
    for (let k = 0; k < Math.min(nums.length, vals.length); k++) {
      const n = Number(nums[k])
      const v = vals[k].toUpperCase()
      if (Number.isInteger(n) && /^[A-D]$/.test(v)) map.set(n, v)
    }
  }
  return map
}

/** 非选择题答案块：**17.** / **17.（16 分）** 之后到下一个块之前 */
function parseSubjectiveAnswers(answerText) {
  const lines = answerText.split('\n')
  const out = new Map()
  let cur = null
  for (const line of lines) {
    const m = line.match(/^\*\*\s*(\d{1,2})[\.．]/)
    if (m) {
      if (cur) out.set(cur.n, cur.lines.join('\n').trim())
      cur = { n: Number(m[1]), lines: [line.replace(/^\*\*/, '').trim()] }
      continue
    }
    if (/^#{2,4}\s/.test(line)) { if (cur) { out.set(cur.n, cur.lines.join('\n').trim()); cur = null } continue }
    if (cur) cur.lines.push(line)
  }
  if (cur) out.set(cur.n, cur.lines.join('\n').trim())
  // 去掉块首那行「**17.（16 分）**」留下的题号与分值，只保留答案正文
  for (const [k, v] of out) {
    const cleaned = v
      .replace(/^\s*\*{0,2}\s*\d{1,2}[．.][^\n]*?（\s*\d+\s*分\s*）\s*\*{0,2}\s*/, '')
      .replace(/^\s*\*{0,2}\s*\d{1,2}[．.]\s*\*{0,2}\s*/, '')
      .replace(/\*\*\s*$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    out.set(k, cleaned || v.trim())
  }
  return out
}

/** 按特征词归考点：命中的特征词按长度加权，取最高分；全不中 → C-99 */
function makeClassifier(topicsDoc) {
  const entries = Object.entries(topicsDoc.topics).filter(([id]) => id !== 'C-99')
  return (text) => {
    let best = { id: 'C-99', score: 0 }
    for (const [id, t] of entries) {
      let score = 0
      for (const cue of t.cues ?? []) if (cue && text.includes(cue)) score += cue.length
      if (score > best.score) best = { id, score }
    }
    return best
  }
}

/** 拆题目区：裸题号 `1. ` 与粗体 `**17.**` 都算一题开始 */
function splitQuestions(questionLines) {
  const out = []
  let cur = null
  for (const line of questionLines) {
    if (/^#{2,4}\s/.test(line)) { if (cur) { out.push(cur); cur = null } continue }
    const plain = line.match(/^(\d{1,2})[\.．]\s*(.*)$/)
    const bold = line.match(/^\*\*\s*(\d{1,2})[\.．]\s*(.*)$/)
    const m = bold || plain
    if (m) {
      if (cur) out.push(cur)
      cur = { n: Number(m[1]), lines: [m[2]] }
      continue
    }
    if (cur) cur.lines.push(line)
  }
  if (cur) out.push(cur)
  return out
}

function parsePaper(filePath, topicsDoc) {
  const text = readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n')
  const lines = text.split('\n')
  const title = (lines.find((l) => /^#\s+/.test(l)) ?? '').replace(/^#\s+/, '').trim()
  const urlMatch = text.match(/来源[：:][^\n]*?\((https?:\/\/[^)\s]+)\)/)
  const sourceUrl = urlMatch ? urlMatch[1] : ''

  const ansAt = lines.findIndex((l) => /^##\s*参考答案/.test(l))
  const questionLines = ansAt >= 0 ? lines.slice(0, ansAt) : lines
  const answerText = ansAt >= 0 ? lines.slice(ansAt + 1).join('\n') : ''

  const choiceAnswer = parseAnswerTables(answerText)
  const subjAnswer = parseSubjectiveAnswers(answerText)
  const classify = makeClassifier(topicsDoc)

  const ym = title.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/)
  const slug = ym ? `${ym[1]}-${String(ym[2]).padStart(2, '0')}-zj` : path.basename(filePath, '.md')
  const label = title.replace(/\s+/g, '') || path.basename(filePath, '.md')

  const questions = []
  const report = { paper: title, slug, total: 0, choice: 0, text: 0, noAnswer: [], unclassified: [] }

  for (const block of splitQuestions(questionLines)) {
    const rawBody = block.lines.join('\n').trim()
    if (!rawBody) continue
    const body = rawBody.replace(/^（\s*\d+\s*分\s*）\s*/, '').trim()
    const choices = extractChoices(body)
    const stem = body.slice(0, choiceStartIndex(body)).trim()
    if (!stem) continue

    const id = `${slug}-q${block.n}`
    const key = body + stem
    const { id: topic } = classify(key)
    if (topic === 'C-99') report.unclassified.push(block.n)

    // 浙江化学选考固定 1–16 是选择题；17–20 是主观题。
    // 主观题的小问里常出现 A./B./C.（如「宜采用的方法是 A.…B.…C.…」），
    // 不能因为抽到 3 个选项就当选择题，否则会去找不存在的字母答案。
    const isChoiceZone = block.n <= 16 && choices && choices.length === 4
    if (isChoiceZone) {
      const letter = choiceAnswer.get(block.n)
      if (!letter) { report.noAnswer.push(block.n); continue }
      const idx = LETTERS.indexOf(letter)
      if (idx < 0 || idx >= choices.length) { report.noAnswer.push(block.n); continue }
      questions.push({
        id, topic, type: 'choice', difficulty: difficultyOf(block.n),
        stem, choices,
        answer: { value: [idx] },
        solution: `正确答案 ${letter}：${choices[idx]}`,
        source: `${label} 第${block.n}题`,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(/\[图[：:]/.test(body) ? { needsFigure: true } : {}),
      })
      report.choice++
    } else {
      const ref = subjAnswer.get(block.n)
      if (!ref) { report.noAnswer.push(block.n); continue }
      questions.push({
        id, topic, type: 'text', difficulty: difficultyOf(block.n),
        stem, answer: { reference: ref }, solution: ref,
        source: `${label} 第${block.n}题`,
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(/\[图[：:]/.test(body) ? { needsFigure: true } : {}),
      })
      report.text++
    }
    report.total++
  }
  return { questions, report }
}

// ─────────────────────────────── main ───────────────────────────────

const opts = parseArgv(process.argv.slice(2))
if (!opts.topics || opts.files.length === 0) {
  console.error('用法：node tools/import-chem-md.js --topics tools/topics-chemistry.json [--out ...] 试卷.md …')
  process.exit(2)
}
const topicsDoc = JSON.parse(readFileSync(opts.topics, 'utf8'))

const all = []
const reports = []
for (const f of opts.files) {
  const { questions, report } = parsePaper(f, topicsDoc)
  all.push(...questions)
  reports.push(report)
}

const bank = {
  subject: 'chemistry',
  title: '高中化学',
  version: 1,
  topics: topicsDoc.topics,
  questions: all,
}

for (const r of reports) {
  console.log(`\n${r.paper}`)
  console.log(`  题数 ${r.total}（选择 ${r.choice} / 主观 ${r.text}）`)
  if (r.noAnswer.length) console.log(`  缺答案跳过：第 ${r.noAnswer.join('、')} 题`)
  if (r.unclassified.length) console.log(`  未分类（C-99）：第 ${r.unclassified.join('、')} 题`)
}

const { ok, errors, warnings } = validateBank(bank)
console.log(`\n合计 ${all.length} 道，校验 ${ok ? '通过' : '失败'}`)
if (warnings.length) console.log('提示：\n  ' + warnings.slice(0, 8).join('\n  '))
if (!ok) { console.log('错误：\n  ' + errors.slice(0, 10).join('\n  ')); process.exit(1) }

if (opts.dryRun) { console.log('（--dry-run，未写文件）'); process.exit(0) }
if (opts.out) {
  mkdirSync(path.dirname(opts.out), { recursive: true })
  writeFileSync(opts.out, JSON.stringify(bank, null, 2) + '\n', 'utf8')
  console.log(`已写入 ${opts.out}`)
}
