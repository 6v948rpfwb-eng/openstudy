#!/usr/bin/env node
/**
 * import-english-md.js —— 把「新高考卷」英语真题 Markdown 转成开卷题库
 *
 * 只处理选择题型（听力、阅读、七选五、完形）；语法填空与写作要人工评分，不进题库。
 * 用法：
 *   node tools/import-english-md.js --topics tools/topics-english.json \
 *     --out openstudy-data/english.bank.json \
 *     "../../高三学习/学科-英语/资料/2026-新高考Ⅰ卷-英语-真题.md"
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { validateBank } from '../core/bank.js'

const args = process.argv.slice(2)
const arg = (k, d = '') => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d }
const topicsPath = arg('topics'); const outPath = arg('out')
const files = args.filter((a) => a.endsWith('.md'))
if (!topicsPath || !outPath || !files.length) {
  console.error('用法：--topics <考点表> --out <题库> <卷1.md> [卷2.md ...]'); process.exit(1)
}
const topicsDoc = JSON.parse(readFileSync(topicsPath, 'utf8'))
const existing = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null
const bank = existing || { subject: topicsDoc.subject, title: topicsDoc.title, version: 1, topics: topicsDoc.topics, questions: [] }
bank.topics = topicsDoc.topics
const seen = new Set(bank.questions.map((q) => q.stem.replace(/\s+/g, '').slice(0, 120)))

const LETTER = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6 }
const norm = (s) => s.replace(/\s+/g, '').slice(0, 120)

/** 解析答案区：1—5 CBAAC  /  21. B　22. A  /  41. C　42. A */
function parseAnswers(text) {
  const ans = {}
  for (const m of text.matchAll(/(\d+)\s*[—\-~]\s*(\d+)\s*([A-G]{2,})\b/g)) {
    const start = Number(m[1]); const letters = m[3].split('')
    letters.forEach((L, i) => { ans[start + i] = L })
  }
  for (const m of text.matchAll(/(\d+)\.\s*([A-G])(?![A-Za-z])/g)) {
    const n = Number(m[1]); if (!(n in ans)) ans[n] = m[2]
  }
  return ans
}

/** 从若干行里拆选项：A. xxx B. xxx C. xxx D. xxx */
function splitChoices(lines) {
  const joined = lines.join(' ')
  const parts = joined.split(/(?=\b[A-G]\.\s)/).map((s) => s.trim()).filter(Boolean)
  const letters = parts.map((p) => p[0]).join('')
  if (parts.length < 2 || !/^[A-G]+$/.test(letters)) return null
  // 字母必须从 A 起连续
  const expect = 'ABCDEFG'.slice(0, parts.length)
  if (letters !== expect) return null
  return parts.map((p) => p.replace(/^[A-G]\.\s*/, '').trim())
}

const papers = []
for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const lines = raw.split('\n')
  const label = (raw.match(/^#\s+(.+)$/m) || [, file.split('/').pop()])[1].trim()
  // 答案区
  const aiStart = lines.findIndex((l) => /^##\s*参考答案/.test(l))
  const head = aiStart >= 0 ? lines.slice(0, aiStart) : lines
  const ansText = aiStart >= 0 ? lines.slice(aiStart).join('\n') : ''
  const answers = parseAnswers(ansText)

  // 分节：篇名与题号范围
  const items = []   // {no, stemLines, optLines, section}
  let section = ''
  let part = ''
  let buf = null
  for (const line of head) {
    const prt = line.match(/^##\s+(.+)$/)
    if (prt) { part = prt[1].trim(); continue }
    const sec = line.match(/^###\s+(.+)$/)
    if (sec) { section = sec[1].trim(); if (buf) { items.push(buf); buf = null } continue }
    const it = line.match(/^(\d+)\.\s+(.*)$/)
    if (it) {
      if (buf) items.push(buf)
      const rest = it[2].trim()
      const inline = /^[A-G]\.\s/.test(rest)
      buf = { no: Number(it[1]), stem: inline ? [] : [rest], opts: inline ? [rest] : [], section, part }
      continue
    }
    if (buf) {
      if (/^\s*[A-G]\.\s/.test(line)) buf.opts.push(line.trim())
      else if (line.trim() && buf.opts.length === 0) buf.stem.push(line.trim())
    }
  }
  if (buf) items.push(buf)

  // 每篇的材料：从节标题后到该篇第一题的正文
  const passageOf = (sectionName) => {
    const i = head.findIndex((l) => l.trim() === `### ${sectionName}`)
    if (i < 0) return ''
    const body = []
    for (let k = i + 1; k < head.length; k++) {
      if (/^###\s/.test(head[k])) break
      if (/^\d+\.\s/.test(head[k])) break
      if (head[k].trim()) body.push(head[k].trim())
    }
    return body.join('\n').slice(0, 1800)
  }

  // 七选五共用选项：A—G 列表出现在最后一篇材料之后
  const sevenOpts = (() => {
    const i = head.findIndex((l) => l.trim() === '### 第二节 七选五（共 5 小题；每小题 2.5 分，满分 12.5 分）')
    if (i < 0) return null
    const opts = []
    for (let k = i; k < head.length; k++) {
      const m = head[k].match(/^([A-G])\.\s+(.+)$/)
      if (m && m[1] === 'ABCDEFG'[opts.length]) opts.push(m[2].trim())
      if (opts.length === 7) break
    }
    return opts.length === 7 ? opts : null
  })()

  // 七选五：题目不是「36. xxx」形式，而是短文里的 __36__ 空，这里单独造题
  if (sevenOpts) {
    const blankPassage = passageOf('第二节 七选五（共 5 小题；每小题 2.5 分，满分 12.5 分）')
    const blanks = [...blankPassage.matchAll(/__(\d+)__/g)].map((m) => Number(m[1]))
    for (const no of blanks) {
      const letter = answers[no]
      if (!letter) { continue }
      items.push({ no, stem: [`（七选五 第${no}空）`], opts: [], section: '第二节 七选五', part: '第二部分 阅读理解', seven: true })
    }
  }

  let added = 0; const skipped = []
  for (const it of items) {
    const letter = answers[it.no]
    if (!letter) { skipped.push(`${it.no}(无答案)`); continue }
    let choices = splitChoices(it.opts)
    if (!choices && it.section.includes('七选五') && sevenOpts) choices = sevenOpts
    if (!choices) { skipped.push(`${it.no}(非选择)`); continue }
    const idx = LETTER[letter]
    if (idx === undefined || idx >= choices.length) { skipped.push(`${it.no}(下标越界)`); continue }
    const passage = it.seven ? passageOf('第二节 七选五（共 5 小题；每小题 2.5 分，满分 12.5 分）') : passageOf(it.section)
    const stem = (passage ? passage + '\n\n' : '') + it.stem.join(' ').trim()
    const key = `${label}#${it.no}|${norm(it.stem.join(' '))}`
    if (seen.has(key)) { skipped.push(`${it.no}(重复)`); continue }
    seen.add(key)
    const where = `${it.part} ${it.section}`
    const topic = where.includes('听力') ? 'E-11'
      : where.includes('七选五') ? 'E-13'
      : where.includes('完形') ? 'E-13'
      : where.includes('阅读') ? 'E-12' : 'E-99'
    bank.questions.push({
      id: `en-${createHash('sha1').update(stem).digest('hex').slice(0, 12)}`,
      topic, type: 'choice', difficulty: 0.45,
      stem, choices, answer: { value: [idx] }, solution: `答案 ${letter}`,
      source: `${label} 第${it.no}题`,
      sourceUrl: '',
    })
    added++
  }
  papers.push({ label, added, skipped })
}

const errs = validateBank(bank)
for (const p of papers) {
  console.log(`${p.label}：新增 ${p.added} 题${p.skipped.length ? `（跳过 ${p.skipped.length}：${p.skipped.slice(0, 6).join('、')}${p.skipped.length > 6 ? '…' : ''}）` : ''}`)
}
if (errs.length) { console.error('❌ 题库校验失败'); errs.slice(0, 6).forEach((e) => console.error('  ', e)); process.exit(1) }
writeFileSync(outPath, JSON.stringify(bank, null, 1))
console.log(`已写入 ${outPath}（共 ${bank.questions.length} 题）`)
