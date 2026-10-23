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
const source = blocks.sort((a, b) => b.length - a.length)[0]
const script = blocks.sort((a, b) => b.length - a.length)[0]
if (!script) throw new Error(`${targetPath} 里没有内联脚本`)

const CLASS_ATTR = { '.tab': 'v', '.subjcard': 'bank' }
const HANDLERS = new Map()
// 桩里同一个控件可能被不同选择器取到（如 '.tab' 与 '.tab[data-v]'），句柄一律只按 data-* 认
const keyOf = (sel, ds) => JSON.stringify(ds || {})
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
    // 复合选择器（如 '.tab[data-v]'）只按方括号里的 data-* 取，桩不需要真 CSS 引擎
    const bracket = sel.match(/\[(data-[a-z]+)\]/)
    if (bracket && !/^\[data-[a-z]+\]$/.test(sel)) return document.querySelectorAll('[' + bracket[1] + ']')
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

// ---- 方法论（按题型）与知识图（纯知识点）----
const tab = document.querySelectorAll('.tab')
ok(tab.length >= 3, '标签页有 练习/方法论/知识图 三个')

// 方法论第一层：四个组
const fwTab = tab.find((t) => t.dataset.v === 'framework')
ok(!!fwTab, '找到方法论标签')
clickEl(fwTab, '.tab')
let h = latest()
ok(h.includes('按「题目长什么样」分类') || h.includes('全部题型') || h.includes('方法论'), '方法论第一层：按题型分类')
ok(h.includes('data-g') || h.includes('bcard') || h.includes('物理'), '方法论第一层：有组卡片')
ok(h.includes('思想方法') && h.includes('data-tb'), '方法论第一层：有思想方法区块')
const thCard = document.querySelectorAll('[data-tb]').find((b) => b.dataset.tb === 'general')
ok(!!thCard, '思想方法：有「通用思想」块')
clickEl(thCard, '[data-tb]')
h = latest()
ok(h.includes('data-tk') && h.includes('等效替代'), '思想方法块：列出条目（含等效替代）')
const tk = document.querySelectorAll('[data-tk]').find((b) => b.dataset.tk === 'T-01')
clickEl(tk, '[data-tk]')
h = latest()
ok(h.includes('thinkone') && h.includes('什么时候该想到它') && h.includes('各科的样子'), '思想方法详情：一句话/何时用/各科例子')
ok(h.includes('等效单摆') && h.includes('等效氢'), '思想方法详情：跨学科例子都在')
clickSel('[data-crumb]', 0)
clickSel('[data-crumb]', 0)

ok(clickSel('[data-g]', 0), '能点进第一个组')
h = latest()
ok(h.includes('类题') || h.includes('trow'), '方法论第二层：组里的题型列表')
ok(clickSel('[data-m]', 0), '能点进第一个题型')
h = latest()
ok(h.includes('什么时候用') && h.includes('动作序列') && h.includes('必查项'), '方法论第三层：触发/动作/必查')
ok(h.includes('用到哪些知识点'), '方法论第三层：关联知识点')
ok(clickSel('[data-jump]', 0), '能从方法跳到知识点')
h = latest()
ok(h.includes('要点') && h.includes('公式'), '跳转后落在知识点详情')
ok(clickSel('[data-crumb]', 0), '面包屑能返回')

// 切回物理（知识点与方法论目前只有物理有内容）
const physCard = document.querySelectorAll('.subjcard').find((c) => c.dataset.bank === 'physics')
clickEl(physCard, '.subjcard')

// 知识图第一层
const mapTab = document.querySelectorAll('.tab').find((t) => t.dataset.v === 'map')
clickEl(mapTab, '.tab')
h = latest()
if (process.env.NAV_DEBUG) console.log('KB_HEAD:', h.slice(0, 300), '| subject=', els.get('root') && 'x')
ok(h.includes('这里只有知识点本身'), '知识图第一层：说明与练习/方法论的区别')
const hMapRoot = h
ok(clickSel('[data-b]', 0), '能点进第一个知识块')
h = latest()
ok(h.includes('个知识点') && h.includes('看全景图'), '知识图第二层：知识点列表 + 看全景图')
ok(clickSel('[data-jump]', 0), '能点进一个知识点')
h = latest()
ok(h.includes('要点') && h.includes('要先会'), '知识图第三层：要点/前置')
ok(h.includes('qfront') && h.includes('先自己想 10 秒'), '知识点详情：先给问题（问答卡）')
ok(h.includes('class="qans"'), '知识点详情：答案默认折叠')
ok(!/<details class="qans" open/.test(h), '知识点详情：默认不展开答案')
ok(h.includes('qstats') && h.includes('题库') && h.includes('做过'), '知识点详情：题库题数/做过/错次')
// 第一层应出现「易混对比」
// 物理不再做易混对比（用户 2026-10-23 要求），换成化学验证
const chemCard = document.querySelectorAll('.subjcard').find((b) => b.dataset.bank === 'chemistry')
clickEl(chemCard, '.subjcard')
clickEl(mapTab, '.tab')
h = latest()
ok(h.includes('易混对比') && h.includes('paircard'), '化学知识图第一层：有易混对比区')
ok(h.includes('结构与成键'), '化学知识块：结构与成键块存在')
ok(h.indexOf('结构与成键') < h.indexOf('元素与周期律'), '化学知识块：结构排在元素周期律之前')

ok(h.includes('一样') && h.includes('差在') && h.includes('用哪个'), '对比卡三行齐全')
clickSel('[data-b]', 1)
ok(clickSel('[data-jump]', 0), '化学：能点进一个知识点')
h = latest()
ok(h.includes('whybox') && h.includes('为什么'), '化学知识点详情：有「为什么（结构→性质）」一行')
clickSel('[data-crumb]', 0); clickSel('[data-crumb]', 0)
const physCard2 = document.querySelectorAll('.subjcard').find((b) => b.dataset.bank === 'physics')
clickEl(physCard2, '.subjcard')
clickEl(mapTab, '.tab')
ok(!latest().includes('易混对比'), '物理知识图：没有易混对比区')
const drillEl = document.getElementById('drill')
ok(!!drillEl && typeof drillEl.onclick === 'function', '知识点详情：有「直接练这 N 题」并绑定事件')
// 点击行为由源码级断言兜底（桩里 startTopicSession 依赖真实 state，不做端到端模拟）
ok(source.includes('function startTopicSession('), '源码：存在只练某考点的会话语义')
ok(source.includes("drill.onclick = () => startTopicSession(n.topic, 3)"), '源码：按钮绑定到 startTopicSession')

// 回第二层再进全景图
clickSel('[data-crumb]', 0)
clickSel('[data-crumb]', 0)
clickEl(mapTab, '.tab')
clickSel('[data-b]', 0)
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

// ---- 返回上一级（新加的圆圈箭头）----
clickEl(document.querySelectorAll('.tab').find((t) => t.dataset.v === 'practice'), '.tab')
ok(!String(document.getElementById('tabs')._html).includes('backbtn'), '最外层不显示返回按钮')
const firstBlock = document.querySelectorAll('[data-b]')[0]
clickEl(firstBlock, '[data-b]')
ok(String(document.getElementById('tabs')._html).includes('backbtn'), '进到知识块后出现返回按钮')
const backEl = document.querySelectorAll('#backbtn')[0]
backEl.onclick()
ok(latest().includes('个考点'), '点返回回到最外层')

if (process.env.NAV_DEBUG) {
  console.log('--- 练习页最新 HTML ---')
  console.log(latest().slice(0, 400))
}

// ---- 问大肥鱼：提问文本要把上下文打包好 ----
const A = sandbox.__openstudy
ok(A && typeof A.buildAskPrompt === 'function', '提问函数已挂到 globalThis（测试钩子）')
const promptText = A.buildAskPrompt({
  subject: 'physics', subjectName: '高中物理', view: '练习',
  topicId: 'P-02', topicName: '力与平衡',
  stem: '如图，物块静止在斜面上，求摩擦力',
  choices: ['0', 'mg sinθ', 'mg cosθ', '无法确定'],
  myAnswer: 'C', correct: false, reference: 'B',
  question: '为什么不是 mgcosθ',
})
ok(promptText.includes('高中物理') && promptText.includes('力与平衡'), '提问文本带学科与考点')
ok(promptText.includes('mg sinθ') && promptText.includes('A. 0'), '提问文本带题干与选项')
ok(promptText.includes('我的答案：C') && promptText.includes('系统判定：错'), '提问文本带作答与判定')
ok(promptText.trim().endsWith('为什么不是 mgcosθ'), '提问文本以问题结尾')
ok(!/undefined|null/.test(A.buildAskPrompt({ subject: 'math' })), '缺字段时不出现 undefined')


// ---- 题干排版：表格题渲染成真表格 ----
const stemCase = A.stemToHtml('下列由实验得出的结论正确的是（）；实验｜结论；A.｜乙烯通入溴的CCl₄｜无色透明；B.｜乙醇与水都与钠反应｜活性相同')
ok(/<table class="stemtable">/.test(stemCase), '题干里的「行｜列」渲染成表格')
ok((stemCase.match(/<tr>/g) || []).length === 3, '表格行数正确（含表头）: ' + (stemCase.match(/<tr>/g) || []).length)
ok(/<td>乙烯通入溴的CCl₄<\/td>/.test(stemCase), '单元格内容保留')
const subCase = A.stemToHtml('（1）求加速度；（2）求时间')
ok((subCase.match(/class="sp sub"/g) || []).length === 2, '小问 (1)(2) 各自成段')
const plain = A.stemToHtml('一段没有表格的题干，含公式 v²=2ax')
ok(plain.includes('一段没有表格的题干') && !plain.includes('<table'), '普通题干不受影响')

// ── 作答记录按题号写（防止「同一题点几下自评，后面全错」回归） ────────
const appSrc = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
ok(/app\.answers\[app\.index\] = \{/.test(appSrc), 'recordAnswer 按题号写入而不是 push')
ok(!/app\.answers\.push\(\{/.test(appSrc), '没有残留的 app.answers.push')
ok(/app\.current\.graded\.self === b\.dataset\.self/.test(appSrc), '同一题重复自评会被拦下')

// ---- 题干空格与字母下标（截图里「m_A」「都 是」这类问题）----
const tidy = (q) => A.stemToHtml(q)
ok(tidy('质量为 m_A 和 m_B，且 m_A>m_B').includes('<sub>A</sub>'), 'm_A 渲染成下标')
ok(tidy('质量为 m_A，且 m_A>m_B').includes('<sub>B</sub>'), 'm_B 也渲染成下标')
ok(!tidy('设所有碰撞都 是弹性的').includes('都 是'), '汉字之间的空格被吞掉')
ok(tidy('在释放处的下方\n与释放处距离为 H 的地方').includes('下方与释放处'), '断行处的汉字直接接上')
ok(tidy('碰撞后 B 上升的最大高度').includes(' B '), '汉字与字母之间保留一个空格')

console.log(`${pass} 项通过` + (bad.length ? `，${bad.length} 项失败：\n- ` + bad.join('\n- ') : ''))
if (bad.length) process.exit(1)
