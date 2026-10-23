/**
 * nav.js —— 下钻式导航的离线断言（不开浏览器）
 * 用一个能解析 innerHTML 里 data-* 属性的 DOM 桩，模拟点击：
 *   方法论：四个组 → 组里考点 → 考点细节 → 面包屑返回
 *   知识图：知识块 → 块里考点 → 考点细节 → 全图（带缩放条）
 *   练习页：知识块 → 块里考点 → 考点细节（有「只练这个考点」）
 * 跑法：node tests/nav.js [构建产物路径]
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const targetPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(here, '..', 'openstudy-data', 'openstudy.html')
const html = readFileSync(targetPath, 'utf8')
const blocks = [...html.matchAll(/<script>\n?([\s\S]*?)\n?<\/script>/g)].map((m) => m[1])
const script = blocks.sort((a, b) => b.length - a.length)[0]
if (!script) throw new Error(`${targetPath} 里没有内联脚本`)

const CLASS_ATTR = { '.tab': 'v', '.subjcard': 'bank' }
const HANDLERS = new Map()
const keyOf = (sel, ds) => sel + '|' + JSON.stringify(ds || {})
const renders = []
let gen = 0
const selCache = new Map()

function makeEl(tag = 'div') {
  const el = {
    tagName: tag, _html: '', value: '', textContent: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    files: [], onclick: null, oninput: null, onchange: null, ondrop: null,
    ondragover: null, ondragleave: null, onkeydown: null, onpointerdown: null,
    onpointermove: null, onpointerup: null, onpointercancel: null, onpointerleave: null,
    addEventListener() {}, focus() {}, click() {}, getBoundingClientRect: () => ({ width: 800, height: 400, left: 0, top: 0 }),
    querySelector: (sel) => (document.querySelectorAll(sel)[0] ?? null),
    querySelectorAll: (sel) => document.querySelectorAll(sel),
    getAttribute: () => null, setAttribute() {},
  }
  let _onclick = null
  Object.defineProperty(el, 'onclick', {
    get() { return _onclick },
    set(fn) { _onclick = fn; if (el._key) HANDLERS.set(el._key, fn) },
  })
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html },
    set(v) { this._html = String(v); renders.push({ id: this.id || 'root', html: this._html }); gen++; selCache.clear() },
  })
  return el
}

const root = makeEl()
const els = new Map([['root', root]])
const document = {
  getElementById(id) { if (!els.has(id)) els.set(id, makeEl()) ; return els.get(id) },
  querySelectorAll(sel) {
    if (/^#[A-Za-z0-9_-]+$/.test(sel)) return [document.getElementById(sel.slice(1))]
    const key = sel + '#' + gen
    if (selCache.has(key)) return selCache.get(key)
    const m = sel.match(/^\[data-([a-z]+)\]$/)
    const out = []
    if (m) {
      const attr = m[1]
      const re = new RegExp(`data-${attr}="([^"]*)"`, 'g')
      const allHtml = [...els.values()].map((e) => e._html).join('\n')
      for (const hit of allHtml.matchAll(re)) {
        const el = makeEl()
        el.dataset[attr] = hit[1]
        el._key = keyOf(sel, el.dataset)
        out.push(el)
      }
    } else if (CLASS_ATTR[sel.replace(/\s.*$/, '')]) {
      const attr = CLASS_ATTR[sel.replace(/\s.*$/, '')]
      const re = new RegExp(`data-${attr}="([^"]*)"`, 'g')
      const allHtml = [...els.values()].map((e) => e._html).join('\n')
      for (const hit of allHtml.matchAll(re)) {
        const el = makeEl(); el.dataset[attr] = hit[1]; el._key = keyOf(sel, el.dataset); out.push(el)
      }
    } else if (sel === 'svg.kmap') {
      const el = makeEl('svg')
      el.getAttribute = (k) => (k === 'width' ? '1760' : k === 'height' ? '900' : null)
      el._key = keyOf(sel, {})
      out.push(el)
    } else if (sel === '.knode') {
      const allH = [...els.values()].map((e) => e._html).join('\n')
      for (const hit of allH.matchAll(/class="knode[^"]*" data-t="([^"]*)"/g)) {
        const el = makeEl(); el.dataset.t = hit[1]; el._key = keyOf(sel, el.dataset); out.push(el)
      }
    }
    selCache.set(key, out)
    return out
  },
  createElement: (t) => makeEl(t),
  body: { appendChild() {}, removeChild() {} },
  addEventListener() {},
}

const store = new Map()
const localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
const sandbox = {
  document, localStorage, console, setTimeout, clearTimeout, clearInterval, setInterval: () => 0,
  alert: () => {}, confirm: () => true, Math, Date, JSON, Number, String, Array, Object, Map, Set,
  Error, isNaN, parseInt, parseFloat, Promise, RegExp,
  fetch: () => Promise.reject(new Error('no fetch')),
  location: { search: '', hash: '', href: 'file:///x.html' },
  addEventListener() {}, history: { replaceState() {} },
}
sandbox.window = sandbox
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(script, sandbox, { filename: 'openstudy.html' })
await new Promise((r) => setTimeout(r, 200))

let pass = 0
const bad = []
const ok = (cond, msg) => (cond ? pass++ : bad.push(msg))
const latest = () => root._html
const clickEl = (el, sel) => {
  if (!el) return false
  const fn = typeof el.onclick === 'function' ? el.onclick : HANDLERS.get(el._key || keyOf(sel, el.dataset))
  if (typeof fn === 'function') { fn(); return true }
  return false
}
const clickSel = (sel, idx = 0) => {
  const list = document.querySelectorAll(sel)
  const el = list[idx]
  if (!el) return false
  const fn = typeof el.onclick === 'function' ? el.onclick : HANDLERS.get(el._key || keyOf(sel, el.dataset))
  if (typeof fn === 'function') { fn(); return true }
  return false
}

// ---- 方法论的学科数据（拿化学） ----
const FW = { subject: 'chemistry' }
const tab = document.querySelectorAll('.tab')
ok(tab.length >= 3, '标签页有 练习/方法论/知识图 三个')

// 直接点「方法论」标签
const fwTab = tab.find((t) => t.dataset.v === 'framework')
ok(!!fwTab, '找到方法论标签')
clickEl(fwTab, '.tab')
let h = latest()
ok(h.includes('四组方法论') || h.includes('全部组'), '方法论第一层：四个组')
ok(h.includes('条件→方程') || h.includes('bcard'), '方法论第一层：有组卡片')

// 进第一组
ok(clickSel('[data-g]', 0), '能点进第一个组')
h = latest()
ok(h.includes('这一组的动作序列'), '方法论第二层：组里考点 + 组级动作序列')

// 进第一个考点
ok(clickSel('[data-t]', 0), '能点进第一个考点')
h = latest()
ok(h.includes('判据（表 1）') && h.includes('必查项'), '方法论第三层：三张表')
ok(h.includes('crumb'), '有面包屑')
ok(clickSel('[data-crumb]', 0), '面包屑能回到第一层')
ok(latest().includes('四组方法论') || latest().includes('全部组'), '回到方法论第一层')

// ---- 知识图 ----
const mapTab = document.querySelectorAll('.tab').find((t) => t.dataset.v === 'map')
clickEl(mapTab, '.tab')
h = latest()
ok(h.includes('看全图'), '知识图第一层：有「看全图」按钮')
ok(h.includes('bcard') || h.includes('个考点'), '知识图第一层：有知识块卡片')
ok(clickSel('[data-b]', 0), '能点进第一个知识块')
h = latest()
ok(h.includes('学这一块之前要先会') || h.includes('trow'), '知识图第二层：块里的考点')
ok(clickSel('[data-t]', 0), '能点进块里的考点')
h = latest()
ok(h.includes('判据（表 1）'), '知识图第三层：考点细节')

// 回第一层再进全图
clickSel('[data-crumb]', 0)
clickEl(mapTab, '.tab')
const fullBtn = els.get('fullmap')
ok(!!fullBtn && typeof fullBtn.onclick === 'function', '有「看全图」按钮并绑定了事件')
clickEl(fullBtn, '#fullmap')
h = latest()
ok(h.includes('mapwrap') && h.includes('mzIn'), '全图层：有缩放工具栏')
ok(h.includes('kmap'), '全图层：有 SVG')
ok(els.get('mzIn') && typeof els.get('mzIn').onclick === 'function', '放大按钮绑定了事件')

// ---- 练习页 ----
const pTab = document.querySelectorAll('.tab').find((t) => t.dataset.v === 'practice')
clickEl(pTab, '.tab')
h = latest()
if (process.env.NAV_DEBUG) console.log('PRACTICE_HEAD:', h.slice(0, 220))
ok(h.includes('开始练习'), '练习页第一层：有开始练习')
ok(h.includes('按知识块看考点'), '练习页第一层：有知识块入口')
ok(clickSel('[data-b]', 0), '练习页能点进知识块')
h = latest()
ok(h.includes('trow'), '练习页第二层：块里的考点行')
ok(clickSel('[data-t]', 0), '练习页能点进考点')
h = latest()
ok(h.includes('只练这个考点'), '练习页第三层：有「只练这个考点」按钮')
ok(h.includes('题库题数'), '练习页第三层：显示该考点题数')

if (process.env.NAV_DEBUG) {
  console.log('--- 练习页最新 HTML ---')
  console.log(latest().slice(0, 400))
}
console.log(`${pass} 项通过` + (bad.length ? `，${bad.length} 项失败：\n- ` + bad.join('\n- ') : ''))
if (bad.length) process.exit(1)
