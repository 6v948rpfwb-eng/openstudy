#!/usr/bin/env node
// 菁优卷 → 开卷题库
// node import.mjs --paper /tmp/jy-1.json [--paper ...] --subject physics --topics ../topics-physics.json --bank ../../openstudy-data/physics.bank.json
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve, basename } from 'node:path'
import { guessTopics } from '../../core/framework.js'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15'
const args = process.argv.slice(2)
const many = (k) => args.reduce((a, v, i) => (v === `--${k}` ? [...a, args[i + 1]] : a), [])
const one = (k, d = null) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d }

const papers = many('paper')
const subject = one('subject', 'physics')
const topicsDoc = JSON.parse(readFileSync(one('topics', `../topics-${subject}.json`), 'utf8'))
const bankPath = one('bank')
const bank = JSON.parse(readFileSync(bankPath, 'utf8'))
const figDir = resolve(dirname(bankPath), '..', 'figures', subject)
mkdirSync(figDir, { recursive: true })

const letterOf = (s) => {
  const m = String(s || '').match(/([A-H])/)
  return m ? 'ABCDEFGH'.indexOf(m[1]) : -1
}

let added = 0, skipped = 0
for (const p of papers) {
  const doc = JSON.parse(readFileSync(p, 'utf8'))
  const tag = (doc.reportId || basename(p)).slice(0, 8)
  doc.questions.forEach((q, i) => {
    if (!q.answer || !q.stem || q.stem.replace(/\s/g, '').length < 8) { skipped++; return }
    const id = `jy-${tag}-${i + 1}`
    if (bank.questions.some((x) => x.id === id)) { skipped++; return }
    // 题干：去掉「1． （3分）」
    let stem = q.stem.replace(/^\d+[．.、]\s*/, '').replace(/^（\d+\s*分）\s*/, '').trim()
    stem = stem.replace(/[（(]\s*[）)]\s*$/, '（　　）')
    const choices = q.choices.map((c) => c.replace(/^[A-H][．.、]\s*/, '').trim()).filter(Boolean)
    const ai = letterOf(q.answer)
    const solution = [q.answer ? `答案：${q.answer.trim()}` : '', q.analysis ? `分析：${q.analysis}` : '', q.solution ? `解答：${q.solution}` : '']
      .filter(Boolean).join('\n')
    const hit = guessTopics(topicsDoc, stem + ' ' + choices.join(' '), 1)
    const topic = hit[0]?.topicId || `${subject === 'physics' ? 'P' : subject === 'chemistry' ? 'C' : 'T'}-99`
    const usableChoice = ai >= 0 && choices.length >= 2 && ai < choices.length
    const q1 = {
      id, topic, type: usableChoice ? 'choice' : 'text', difficulty: 0.55,
      stem, choices: usableChoice ? choices : [], answer: usableChoice ? { value: ai } : { reference: q.answer.trim() },
      solution, source: q.label ? `${q.label.replace(/[（）]/g, '')}·第${i + 1}题` : `${tag}·第${i + 1}题`,
      sourceUrl: `https://www.jyeoo.com/ques/detail/${q.qid}`,
    }
    if (q.figs && q.figs.length) q1.figureHint = q.figs[0]
    bank.questions.push(q1)
    added++
  })
}

writeFileSync(bankPath, JSON.stringify(bank, null, 1))
console.log(`新增 ${added} 题，跳过 ${skipped}；题库共 ${bank.questions.length} 题`)
