// 清理题库里的 TeX 原文（stemTex / choicesTex / solutionTex）。
// 只动排版性内容：题号前缀、「（6 分）」这类分值、已知 OCR 错字。公式本体一概不碰。
import { readFileSync, writeFileSync } from 'node:fs'

const TYPO = [[/坚直/g, '竖直'], [/㲴核/g, '氘核'], [/平衝/g, '平衡'], [/飽和/g, '饱和']]

const cleanTex = (t) => {
  let s = String(t)
  s = s.replace(/^\s*\d+\s*[.．、]\s*/, '')          // 开头的「1. 」
  s = s.replace(/[（(]\s*\d+\s*分\s*[）)]/g, '')      // 「（6 分)」
  s = s.replace(/[（(]\s*本小题\s*\d+\s*分\s*[）)]/g, '')
  for (const [re, to] of TYPO) s = s.replace(re, to)
  return s.trim()
}

const files = process.argv.slice(2)
if (!files.length) { console.error('用法：clean-tex.js <bank.json> [...]'); process.exit(1) }
for (const f of files) {
  const bank = JSON.parse(readFileSync(f, 'utf8'))
  let n = 0
  for (const q of bank.questions || []) {
    for (const k of ['stemTex', 'solutionTex']) {
      if (typeof q[k] === 'string') { const v = cleanTex(q[k]); if (v !== q[k]) { q[k] = v; n++ } }
    }
    if (Array.isArray(q.choicesTex)) {
      q.choicesTex = q.choicesTex.map((c) => { const v = cleanTex(c); if (v !== c) n++; return v })
    }
  }
  writeFileSync(f, JSON.stringify(bank, null, 1) + '\n')
  console.log(`${f}: 清理 ${n} 处`)
}
