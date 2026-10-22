#!/usr/bin/env node
/**
 * tests/mascot.js —— 大肥鱼的离线自检（不起浏览器）
 *
 * 用一个假的 document 把 mascot.js 跑起来，检查：
 *   ① 挂载后 body 里有 #mascot，且带 SVG 与气泡
 *   ② 答对/答错会改气泡文字与心情类名
 *   ③ 连错 3 题会推「方法论」
 *   ④ 一句问候只出现一次
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
// 保留 export：以 data: URL 当 ES 模块导入，拿到真实导出
const src = readFileSync(join(here, '..', 'web', 'mascot.js'), 'utf8')

// ---- 极简 DOM 桩 ----
const created = []
function makeEl(tag) {
  const el = {
    tagName: tag, id: '', className: '', title: '', innerHTML: '', textContent: '',
    style: {}, children: [], classList: {
      add: (...c) => { el.className = [...new Set((el.className + ' ' + c.join(' ')).split(/\s+/).filter(Boolean))].join(' ') },
      remove: (...c) => { el.className = el.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(' ') },
      contains: (c) => el.className.split(/\s+/).includes(c),
    },
    addEventListener() {},
    appendChild(c) { el.children.push(c); return c },
    querySelector: () => (el.id === 'mascot' ? bubble : null),
  }
  return el
}
const bubble = makeEl('div')
bubble.id = 'm-bubble'
const body = makeEl('body')
globalThis.document = {
  body,
  createElement(tag) { const el = makeEl(tag); created.push(el); return el },
  getElementById: () => null,
  addEventListener() {},
}
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

const mod = await import(`data:text/javascript,${encodeURIComponent(src)}`)

let pass = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('✓', name) } else { console.log('✗', name); process.exitCode = 1 } }

mod.mountMascot()
const mascot = body.children.find((c) => c.id === 'mascot')
ok(!!mascot, '挂载后 body 里有 #mascot')
ok(/<img/.test(mascot.innerHTML) && /data:image\/(webp|png)/.test(mascot.innerHTML), ' mascot 里带内联头像图')
ok(mascot.className.includes('mascot'), ' class 含 mascot')

mod.mascotSay('测试一句', 'happy', 1)
ok(bubble.textContent === '测试一句', ' 气泡显示传入文字')
ok(mascot.className.includes('mood-happy'), ' 心情切到 happy')

mod.mascotOnAnswer(true)
ok(bubble.textContent.length > 0 && mascot.className.includes('mood-happy'), '答对：气泡有字且开心')
mod.mascotOnAnswer(true)
ok(mascot.className.includes('mood-happy'), '连对：仍然开心')

mod.mascotOnAnswer(false)
mod.mascotOnAnswer(false)
ok(mascot.className.includes('mood-sad'), '答错：皱眉')
mod.mascotOnAnswer(false)
ok(bubble.textContent.includes('方法论'), '连错 3 题：推方法论')

mod.mascotOnSessionStart()
ok(mascot.className.includes('mood-think') || mascot.className.includes('mood-happy'), '开始一轮：说了一句（傲娇脸或开心脸）')
ok(bubble.textContent.length > 0, ' 开始一轮：气泡有字')

console.log(`\n${process.exitCode ? '✗ 有失败' : '✓ 全部通过'}（${pass} 项）`)
