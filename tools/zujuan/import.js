// 用法: node tools/zujuan/import.js <grabbed.json> <answers.json> <bank.json> <subject>
// grabbed.json: tools/zujuan/grab.sh 的输出
// answers.json: [{no, answer:['B'], solution:'...', confidence:'high|mid|low', topic:'T-23'}]
import fs from 'node:fs'
import crypto from 'node:crypto'

const [grabPath, ansPath, bankPath, subject] = process.argv.slice(2)
if (!grabPath || !ansPath || !bankPath) {
  console.error('用法: import.js <grabbed.json> <answers.json> <bank.json> [subject]')
  process.exit(1)
}
const grab = JSON.parse(fs.readFileSync(grabPath, 'utf8'))
const answers = JSON.parse(fs.readFileSync(ansPath, 'utf8'))
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'))
const ansByNo = new Map(answers.map((a) => [a.no, a]))
const paperName = (grab.title || '').trim()
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)

const cleanHtml = (h) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim()

let added = 0
const skipped = []
for (const q of grab.questions) {
  const a = ansByNo.get(q.no)
  if (!a) { skipped.push(q.no); continue }
  const text = q.text || ''
  if (!/^\d+\./.test(text.trim()) && !text.includes(q.no + '.')) { skipped.push(q.no); continue }
  const stemRaw = cleanHtml(q.html)
  const id = 'zj-' + sha(paperName + '#' + q.no)
  if (bank.questions.some((x) => x.id === id)) { skipped.push(q.no); continue }
  bank.questions.push({
    id,
    topic: a.topic || (subject === 'technology' ? 'T-99' : 'P-99'),
    type: a.choicesType || 'choice',
    difficulty: a.difficulty ?? 0.6,
    stem: stemRaw,
    stemHtml: true,
    choices: a.choices || null,
    answer: { value: a.answer },
    solution: a.solution || '',
    figure: (q.imgs || []).filter((u) => !/formula/.test(u)),
    confidence: a.confidence || 'mid',
    source: `${paperName} 第 ${q.no} 题（组卷网）`,
    sourceUrl: grab.url,
  })
  added++
}
fs.writeFileSync(bankPath, JSON.stringify(bank, null, 2))
console.log(`题库 ${bankPath}: 新增 ${added} 题，跳过 ${skipped.length} 题${skipped.length ? '（缺答案：' + skipped.slice(0, 10).join(',') + '）' : ''}`)
