#!/usr/bin/env node
/**
 * make-katex-inline.js —— 把 KaTeX 的 css 变成「字体全内嵌」的一份
 *
 * 为什么：成品页是单文件、要能 file:// 直接双击打开，所以字体不能走外链。
 * 做法：只保留 woff2（Safari/Chrome/Edge 都支持），把 url(fonts/x.woff2) 换成 data URI，
 *       woff/ttf 那几条 src 直接删掉（不删会把体积再翻一倍）。
 *
 * 用法：node tools/make-katex-inline.js
 * 产物：web/vendor/katex/katex-inline.css
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dir = join(here, '..', 'web', 'vendor', 'katex')
const cssPath = join(dir, 'katex.min.css')
if (!existsSync(cssPath)) {
  console.error('找不到 ' + cssPath + '，先把 KaTeX 的 dist 放进来（见 web/vendor/katex/README.txt）')
  process.exit(1)
}

let css = readFileSync(cssPath, 'utf8')

// 1) 删掉 woff / ttf 的 src 条目（它们和 woff2 是同一份字体的冗余格式）
const before = css.length
css = css.replace(/src:([^;}]*?);/g, (m, body) => {
  if (!/woff2/.test(body)) return ''
  // 同一 font-face 里可能并列多个 url，只留 woff2 那条
  const only = body
    .split(',')
    .filter((seg) => /woff2/.test(seg))
    .join(',')
  return `src:${only};`
})

// 2) url(fonts/x.woff2) → data URI
let inlined = 0
css = css.replace(/url\((?:\.\/)?fonts\/([A-Za-z0-9_\-]+\.woff2)\)/g, (m, name) => {
  const file = join(dir, 'fonts', name)
  if (!existsSync(file)) {
    console.error('缺少字体：' + name)
    process.exit(1)
  }
  inlined++
  const b64 = readFileSync(file).toString('base64')
  return `url(data:font/woff2;base64,${b64})`
})

const out = join(dir, 'katex-inline.css')
writeFileSync(out, css, 'utf8')
const kb = (Buffer.byteLength(css) / 1024).toFixed(0)
console.log(`已生成 ${out}（${kb} KB，内嵌 ${inlined} 个 woff2；压缩前 ${(before / 1024).toFixed(0)} KB）`)
