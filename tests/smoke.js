/**
 * smoke.js —— 不开浏览器，用最小 DOM 桩把 dist/openstudy.html 里的脚本跑一遍
 *
 * 目的：抓到"语法对但一运行就报错"的问题（比如某个 getElementById 拿到 null）。
 * 它不是真的渲染，只验证脚本能跑到底、并且真的渲染出了预期文字。
 *
 * 跑法：node tests/smoke.js
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
// 可以指定别的构建产物：node tests/smoke.js openstudy-data/openstudy-physics.html
const targetPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, '..', 'dist', 'openstudy.html')
const customBank = Boolean(process.argv[2])
const html = readFileSync(targetPath, 'utf8')
const script = html.match(/<script>\n([\s\S]*)\n<\/script>/)?.[1]
if (!script) throw new Error(`${targetPath} 里没有内联脚本`)

// ---- 最小 DOM 桩 ----
const renders = []

function makeEl(id) {
  const el = {
    id,
    _html: '',
    get innerHTML() { return this._html },
    set innerHTML(v) { this._html = String(v); renders.push({ id, html: this._html }) },
    value: '',
    textContent: '',
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    style: {},
    onclick: null, oninput: null, onchange: null, onkeydown: null,
    ondragover: null, ondragleave: null, ondrop: null,
    focus() {}, click() {}, addEventListener() {},
    files: [],
  }
  return el
}

const els = new Map()
const document = {
  getElementById(id) {
    if (!els.has(id)) els.set(id, makeEl(id))
    return els.get(id)
  },
  querySelectorAll: () => [],
  createElement: (t) => makeEl(t),
  body: { appendChild() {}, removeChild() {} },
}

const store = new Map()
const localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const alerts = []
const sandbox = {
  document,
  localStorage,
  alert: (m) => alerts.push(String(m)),
  confirm: () => true,
  console,
  setTimeout,
  Math,
  Date,
  JSON,
  Number,
  String,
  Array,
  Object,
  Map,
  Set,
  Error,
  isNaN,
  parseInt,
  parseFloat,
  fetch: () => Promise.reject(new Error('file:// 下不允许 fetch')),
  Promise,
}
sandbox.window = sandbox
sandbox.globalThis = sandbox

vm.createContext(sandbox)
try {
  vm.runInContext(script, sandbox, { filename: 'openstudy.html' })
} catch (e) {
  console.error('脚本运行报错：', e.message)
  console.error(e.stack?.split('\n').slice(0, 6).join('\n'))
  process.exit(1)
}

// ---- 等异步的自动载入跑完 ----
await new Promise((r) => setTimeout(r, 120))

const last = renders[renders.length - 1]
const allText = renders.map((r) => r.html).join('\n')

function check(label, cond) {
  console.log(`${cond ? '✓' : '✗'} ${label}`)
  if (!cond) process.exitCode = 1
}

check('渲染过一次以上', renders.length > 0)
check('载入页出现拖放区', allText.includes('把题库 JSON 拖到这里'))
if (!customBank) check('示例题库被内联载入（出现过「示例题库」）', allText.includes('示例题库'))
check('ready 页出现「开始练习」按钮', allText.includes('开始练习'))
check('ready 页出现了能力 θ 和水平', /能力 θ/.test(allText) && /水平/.test(allText))
check('没弹出任何 alert', alerts.length === 0)

// ---- 不限模式：点「开始练习」且题数选 0，应该直接出一道题，不报错 ----
const nEl = document.getElementById('n')   // 用 document 拿，才能和被测代码拿到同一个桩
const startEl = els.get('start')
if (nEl && startEl && typeof startEl.onclick === 'function') {
  nEl.value = '0'
  const before = renders.length
  try {
    startEl.onclick()
  } catch (e) {
    console.error('不限模式启动报错：', e.message)
    process.exitCode = 1
  }
  const after = renders.slice(before).map((r) => r.html).join('\n')
  check('不限模式能出第一题（出现「· 不限」）', after.includes('· 不限'))
  check('不限模式出题后没有 alert', alerts.length === 0)
} else {
  console.log('· 跳过不限模式检查（没拿到 n / start 元素）')
}

console.log(`\n渲染次数：${renders.length}，最后一次 ${last.html.length} 字符`)
console.log('冒烟测试通过。')
