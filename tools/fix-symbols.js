/**
 * fix-symbols.js —— 把题库里残留的 LaTeX 标记转成人能读的纯文本。
 *
 *   node tools/fix-symbols.js            # 处理 openstudy-data 下所有 *.bank.json
 *   node tools/fix-symbols.js --dry      # 只报告，不写回
 *
 * 只碰「看起来还带 LaTeX」的字段（含 \命令 或 $），干净文本不动。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { deTeX } from './detex.js'

const here = dirname(fileURLToPath(import.meta.url))
const dataDir = join(here, '..', 'openstudy-data')
const dry = process.argv.includes('--dry')

const TEX = /\\{1,2}[a-zA-Z]+|\$|\}\}|\{\{|tabular/
const FIELDS = ['stem', 'solution', 'reference', 'explain']

function clean(text) {
  // Markdown 导入的公式被转义成 \\\\frac 这种双反斜杠，先折回单反斜杠再转换
  let s = String(text).replace(/\\\\/g, '\\')
  s = deTeX(s)
  s = s.replace(/[｝】]/g, (m) => (m === '｝' ? '}' : '】'))
  s = s.replace(/\}\s*\}/g, '}')
  s = s.replace(/\{\s*\{/g, '{')
  s = s.replace(/\(\s*\)/g, '')            // 空括号
  // 之前转换留下的表格残渣：tabular 说明行 + 用 & 分隔的单元格
  s = s.replace(/^tabular[|clr\s]*$/gmu, '')
  s = s.replace(/^([^\n]*&[^\n]*)$/gmu, (row) => row.split('&').map((x) => x.trim()).filter(Boolean).join('｜'))
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/\s+([，。、；：)）])/g, '$1')
  return s.trim()
}

let totalFixed = 0

// 递归处理对象里的所有字符串（公式可能藏在 answer.reference 这类深层字段里）
function walk(node, counter) {
  if (typeof node === 'string') {
    if (TEX.test(node)) { counter.n++; return clean(node) }
    return node
  }
  if (Array.isArray(node)) return node.map((x) => walk(x, counter))
  if (node && typeof node === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(node)) out[k] = walk(v, counter)
    return out
  }
  return node
}

for (const file of readdirSync(dataDir).filter((f) => f.endsWith('.bank.json'))) {
  const path = join(dataDir, file)
  const doc = JSON.parse(readFileSync(path, 'utf8'))
  const counter = { n: 0 }
  const next = walk(doc, counter)
  if (counter.n) {
    console.log(`${file}: 修了 ${counter.n} 处`)
    if (!dry) writeFileSync(path, JSON.stringify(next, null, 1) + '\n')
    totalFixed += counter.n
  }
}
console.log(`共 ${totalFixed} 处${dry ? '（未写回）' : ''}`)
