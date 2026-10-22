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

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

// 顺序很重要：被依赖的放前面
const CORE_ORDER = ['util.js', 'irt.js', 'grade.js', 'bank.js', 'select.js', 'state.js']

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
parts.push('// ===== web/app.js =====\n' + stripModuleSyntax(readFileSync(join(here, 'web', 'app.js'), 'utf8'), 'web/app.js'))

// 把示例题库也塞进去，这样单文件版不用联网也能跑
const sampleBank = readFileSync(join(here, 'data', 'example.bank.json'), 'utf8')
const bankConst = `const __EMBEDDED_BANK__ = ${JSON.stringify(sampleBank)};`

const bundle = `(function(){\n"use strict";\n${bankConst}\n${parts.join('\n\n')}\n})();`

const html = readFileSync(join(here, 'web', 'index.html'), 'utf8')
const marker = '<script type="module" src="./app.js"></script>'
if (!html.includes(marker)) throw new Error('index.html 里找不到脚本占位符')

const outHtml = html.replace(marker, () => `<script>\n${bundle}\n</script>`)

mkdirSync(join(here, 'dist'), { recursive: true })
writeFileSync(join(here, 'dist', 'openstudy.html'), outHtml, 'utf8')

const kb = (Buffer.byteLength(outHtml) / 1024).toFixed(1)
console.log(`已生成 dist/openstudy.html（${kb} KB）`)
