/**
 * build.js —— 把 core/ 和 web/app.js 打成一个单文件 HTML
 *
 * 目的：让 dist/openstudy.html 双击就能用，不需要服务器、不需要 npm install。
 *
 * 做法很土但够用：把每个 .js 的 import/export 语句去掉，全部塞进同一个作用域。
 * 所以 core 里的模块必须保持"单行 import、无 default export、无同名定义"。
 * 如果以后加了依赖，这个土办法会炸——那时候就该换成真的打包器了。
 *
 * 跑法：
 *   node build.js
 *   或（DSH 自带的 node）：
 *   "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" build.js
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, isAbsolute } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// 顺序很重要：被依赖的放前面
const CORE_ORDER = ['util.js', 'irt.js', 'grade.js', 'bank.js', 'select.js', 'state.js', 'math.js', 'framework.js', 'game.js']

function stripModuleSyntax(src, filename) {
  const lines = src.split('\n')
  const out = []
  let skippingImport = false

  for (const raw of lines) {
    const line = raw

    if (skippingImport) {
      if (/from\s+['"][^'"]+['"]/.test(line)) skippingImport = false
      continue
    }

    const trimmed = line.trim()

    // import ... from '...'（可能跨行）
    if (/^import\s/.test(trimmed)) {
      if (/from\s+['"][^'"]+['"]/.test(trimmed)) continue
      skippingImport = true
      continue
    }

    // export * from './x.js'
    if (/^export\s+\*\s+from/.test(trimmed)) continue

    // export const / function / class / let  → 去掉 export
    out.push(line.replace(/^(\s*)export\s+(const|let|var|function|class|async\s+function)\s/, '$1$2 '))
  }

  if (skippingImport) throw new Error(`${filename}: 有一个 import 没闭合`)

  const joined = out.join('\n')
  if (/\bexport\b/.test(joined.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) {
    throw new Error(`${filename}: 还残留 export，build 处理不了`)
  }
  return joined
}

const parts = []
for (const f of CORE_ORDER) {
  parts.push(`// ===== core/${f} =====\n` + stripModuleSyntax(readFileSync(join(here, 'core', f), 'utf8'), `core/${f}`))
}
// mascot.js 放在 app.js 前面：它是 app.js 依赖的，内联后靠函数声明提升不够稳（有 const）
parts.push('// ===== web/icons.js =====\n' + stripModuleSyntax(readFileSync(join(here, 'web', 'icons.js'), 'utf8'), 'web/icons.js'))
parts.push('// ===== web/mascot.js =====\n' + stripModuleSyntax(readFileSync(join(here, 'web', 'mascot.js'), 'utf8'), 'web/mascot.js'))
parts.push('// ===== web/app.js =====\n' + stripModuleSyntax(readFileSync(join(here, 'web', 'app.js'), 'utf8'), 'web/app.js'))

// 把题库塞进去，这样单文件版不用联网也能跑、还能在页面右上角切换学科。
//   node build.js --bank openstudy-data/physics.bank.json --bank openstudy-data/chemistry.bank.json
// 只给一个 --bank 时行为和以前一样（只有一科，右上角不显示切换按钮）。
const bankPaths = []
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--bank' && process.argv[i + 1]) bankPaths.push(resolve(process.argv[i + 1]))
}
if (!bankPaths.length) bankPaths.push(join(here, 'data', 'example.bank.json'))

// --out 指定输出文件。真题库请输出到 openstudy-data/ 下（那个目录不进仓库）
const outArgAt = process.argv.indexOf('--out')
const outPath = outArgAt > 0 ? resolve(process.argv[outArgAt + 1]) : join(here, 'dist', 'openstudy.html')

const banks = {}
const bankOrder = []
let inlinedFigures = 0
const missingFigures = []

// --inline-figures：把题目配图读进来转成 data URI，这样单文件产物仍然自包含、能离线用
const inlineFigures = process.argv.includes('--inline-figures')

for (const bankPath of bankPaths) {
  const obj = JSON.parse(readFileSync(bankPath, 'utf8'))
  if (inlineFigures) {
    const bankDir = dirname(bankPath)
    const toDataUri = (src) => {
      if (/^(data:|https?:)/.test(src)) return src
      const file = isAbsolute(src) ? src : join(bankDir, src)
      if (!existsSync(file)) { missingFigures.push(src); return src }
      const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
      const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg'
      inlinedFigures += 1
      return `data:${mime};base64,${readFileSync(file).toString('base64')}`
    }
    for (const q of obj.questions || []) {
      if (q.solutionImg) q.solutionImg = toDataUri(q.solutionImg)
      if (!q.figure) continue
      q.figure = Array.isArray(q.figure) ? q.figure.map(toDataUri) : toDataUri(q.figure)
    }
  }
  const key = obj.subject || bankPath
  if (banks[key]) throw new Error(`两个 --bank 的 subject 相同：${key}`)
  banks[key] = obj
  bankOrder.push(key)
}
if (inlineFigures) {
  console.log(`配图内联：${inlinedFigures} 张${missingFigures.length ? `，找不到 ${missingFigures.length} 张（${missingFigures.slice(0, 3).join(', ')}…）` : ''}`)
}

const sampleBank = JSON.stringify(banks[bankOrder[0]], null, 2)
const bankConst = `const __EMBEDDED_BANK__ = ${JSON.stringify(sampleBank)};\nconst __EMBEDDED_BANKS__ = ${JSON.stringify(
  Object.fromEntries(bankOrder.map((k) => [k, JSON.stringify(banks[k])])),
)};`

// 方法论数据：把 tools/topics-*.json 里 schema 为 openstudy.topics/2 的全部塞进去。
// 这样单文件产物里「方法论」标签页不用联网也能看。
const fwDocs = {}
const toolsDir = join(here, 'tools')
if (existsSync(toolsDir)) {
  for (const f of readdirSync(toolsDir)) {
    if (!/^topics-.*\.json$/.test(f)) continue
    try {
      const d = JSON.parse(readFileSync(join(toolsDir, f), 'utf8'))
      if (typeof d.schema === 'string' && d.schema.startsWith('openstudy.topics/2')) fwDocs[d.subject || f] = d
    } catch (e) {
      console.warn(`跳过 ${f}：${e.message}`)
    }
  }
}
const fwConst = `const __FRAMEWORK_DOCS__ = ${JSON.stringify(fwDocs)};`

// 知识点图数据（openstudy.knowledge/1）与方法论数据（openstudy.methods/1）
const dataDir = join(here, 'tools', 'data')
const kDocs = {}
const mDocs = {}
let thinkDoc = null
if (existsSync(dataDir)) {
  for (const f of readdirSync(dataDir)) {
    if (!/\.json$/.test(f)) continue
    try {
      const d = JSON.parse(readFileSync(join(dataDir, f), 'utf8'))
      if (typeof d.schema !== 'string') continue
      if (d.schema.startsWith('openstudy.knowledge/')) kDocs[d.subject || f] = d
      if (d.schema.startsWith('openstudy.methods/')) mDocs[d.subject || f] = d
      if (d.schema.startsWith('openstudy.thinking/')) thinkDoc = d
    } catch (e) {
      console.warn(`跳过 data/${f}：${e.message}`)
    }
  }
}
const kConst = `const __KNOWLEDGE_DOCS__ = ${JSON.stringify(kDocs)};\nconst __METHOD_DOCS__ = ${JSON.stringify(mDocs)};\nconst __THINKING_DOC__ = ${JSON.stringify(thinkDoc)};`

const bundle = `(function(){\n"use strict";\n${bankConst}\n${fwConst}\n${kConst}\n${parts.join('\n\n')}\n})();`

const html = readFileSync(join(here, 'web', 'index.html'), 'utf8')
const marker = '<script type="module" src="./app.js"></script>'
if (!html.includes(marker)) throw new Error('index.html 里找不到脚本占位符')

// KaTeX（数学公式渲染）：样式内嵌字体，脚本内联，页面仍是单文件
const katexDir = join(here, 'web', 'vendor', 'katex')
let katexTag = ''
if (existsSync(join(katexDir, 'katex-inline.css')) && existsSync(join(katexDir, 'katex.min.js'))) {
  const kCss = readFileSync(join(katexDir, 'katex-inline.css'), 'utf8')
  const kJs = readFileSync(join(katexDir, 'katex.min.js'), 'utf8')
  katexTag = `<style id="katex-css">${kCss}</style>\n<script id="katex-js">${kJs}</script>\n`
} else {
  console.warn('提示：没有 web/vendor/katex，公式按纯文本显示（跑 tools/make-katex-inline.js 生成）')
}

const outHtml = html.replace(marker, () => `${katexTag}<script>\n${bundle}\n</script>`)

mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, outHtml, 'utf8')

const kb = (Buffer.byteLength(outHtml) / 1024).toFixed(1)
console.log(`已生成 ${outPath}（${kb} KB，内嵌 ${bankOrder.length} 个学科 ${bankOrder.map((k) => `${k} ${banks[k].questions?.length ?? 0} 题`).join(' / ')}；方法论 ${Object.keys(fwDocs).length} 个学科）`)
