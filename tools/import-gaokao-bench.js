/**
 * import-gaokao-bench.js —— 把 GAOKAO-Bench（OpenLMLab，2010–2022 高考真题）
 * 的题目灌进 openstudy 题库。题目是 LaTeX，这里先转成纯文本再入库存档。
 *
 *   node tools/import-gaokao-bench.js --subject physics --file /tmp/phys_mcq.json \
 *        --bank openstudy-data/physics.bank.json --kind mcq
 *   node tools/import-gaokao-bench.js --subject chemistry --file /tmp/chem_mcq.json \
 *        --bank openstudy-data/chemistry.bank.json --kind mcq
 *   node tools/import-gaokao-bench.js --subject physics --file /tmp/phys_open.json \
 *        --bank openstudy-data/physics.bank.json --kind open
 *
 * 选项题自动判分（type=choice），大题只能自己对答案（type=text，答案放 reference）。
 * 依赖图形的题（题干里出现「如图 / 图甲 / 图所示」）默认丢掉——页面没法显示图。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { guessTopics } from '../core/framework.js'
import { deTeX as detex } from './detex.js'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const arg = (k, d) => {
  const i = args.indexOf('--' + k)
  return i >= 0 ? args[i + 1] : d
}

const subject = arg('subject', 'physics')
const file = arg('file')
const bankPath = arg('bank')
const kind = arg('kind', 'mcq')
const keepFigure = args.includes('--keep-figure')
const splitMulti = args.includes('--split-multi')
const keepTex = args.includes('--keep-tex')   // 保留 LaTeX 原文（stemTex / choicesTex），页面用 KaTeX 渲染
const forceTopic = arg('topic', '')  // 整份文件强制归某个考点
if (!file || !bankPath) {
  console.error('用法：--subject physics --file x.json --bank y.bank.json [--kind mcq|open] [--keep-figure]')
  process.exit(1)
}

const topicsFile = join(here, `topics-${subject}.json`)
if (!existsSync(topicsFile)) {
  console.error('找不到考点表：' + topicsFile)
  process.exit(1)
}
const topicsDoc = JSON.parse(readFileSync(topicsFile, 'utf8'))
const FALLBACK = { physics: 'P-99', chemistry: 'C-99', technology: 'T-99', math: 'M-99', english: 'E-99', chinese: 'Y-99' }
const fallbackTopic = FALLBACK[subject] || 'P-99'

// ---------- LaTeX → 纯文本 ----------
// LaTeX → 纯文本的转换器在 tools/detex.js（单独文件，方便修符号规则）
const deTeX = detex

// ---------- 拆题干与选项 ----------
const LETTER = ['A', 'B', 'C', 'D', 'E', 'F']
function splitChoices(text) {
  const t = text.replace(/\r/g, '')
  const marks = []
  for (const m of t.matchAll(/(^|[\s\n（(])([A-D])\s*[.．、]/g)) {
    marks.push({ letter: m[2], start: m.index + m[1].length })
  }
  // 只认从 A 开始、连续且字母递增的一组
  const seq = []
  for (const m of marks) {
    const want = LETTER[seq.length]
    if (m.letter === want) seq.push(m)
    else if (seq.length >= 2) break
    else if (m.letter === 'A' && seq.length === 0) seq.push(m)
  }
  if (seq.length < 2) return { stem: t.trim(), choices: null }
  const stem = t.slice(0, seq[0].start).trim()
  const choices = seq.map((m, i) => {
    const end = i + 1 < seq.length ? seq[i + 1].start : t.length
    return { label: m.letter, text: t.slice(m.start, end).replace(/^[A-D]\s*[.．、]\s*/, '').trim() }
  })
  return { stem, choices }
}

// ---------- 答案 ----------
function parseAnswer(raw) {
  const s = String(raw ?? '').trim()
  try {
    const arr = JSON.parse(s)
    if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean)
  } catch (e) { /* 不是 JSON 就按文本处理 */ }
  return s ? [s] : []
}

// ---------- 难度粗估：分值 + 字数 ----------
function estimateDifficulty(score, text) {
  const n = text.length
  const base = Number(score) >= 12 ? 0.68 : Number(score) >= 6 ? 0.55 : 0.45
  const bump = n > 400 ? 0.08 : n > 220 ? 0.04 : 0
  return Math.min(0.92, Math.round((base + bump) * 100) / 100)
}


// 物理考点表的判据词偏少，这里补一组硬关键词（命中越多越可信）
const HINTS = subject === 'physics' ? {
  'P-01': ['速度', '加速度', '匀变速', '位移', '匀加速', '匀减速', '自由落体', '图象'],
  'P-02': ['受平衡', '受力分析', '摩擦力', '合力', '静止状态', '匀速直线'],
  'P-03': ['牛顿', '超重', '失重', '惯性', '作用力与反作用'],
  'P-04': ['平抛', '圆周运动', '向心', '万有引力', '卫星', '轨道半径', '第一宇宙速度', '角速度', '线速度'],
  'P-05': ['动能定理', '机械能', '功率', '动量', '冲量', '碰撞', '重力势能', '弹性势能'],
  'P-06': ['简谐', '横波', '振幅', '波长', '周期', '干涉', '衍射', '波速', '振动'],
  'P-07': ['电场强度', '电势', '电容器', '电场力', '带电粒子', '电势能', '匀强电场'],
  'P-08': ['电流', '电阻', '欧姆定律', '电功率', '电动势', '闭合电路', '滑动变阻器'],
  'P-09': ['磁场', '安培力', '洛伦兹力', '磁感应强度', '感应电动势', '磁通量', '楞次', '右手定则'],
  'P-10': ['交流', '变压器', '有效值', '最大值', '振荡', '电感', '电容'],
  'P-11': ['分子', '内能', '热力学', '气体', '压强', '温度', '扩散', '布朗'],
  'P-12': ['折射', '全反射', '干涉', '偏振', '透镜', '光速', '光路'],
  'P-13': ['光电效应', '原子核', '衰变', '光子', '波粒二象性', '能级', '核反应', '半衰期'],
  'P-14': ['打点计时器', '刻度尺', '实验', '纸带', '游标卡尺', '螺旋测微器'],
} : subject === 'chemistry' ? {
  'C-14': ['勒夏特列', '平衡移动', '转化率'],
  'C-15': ['化学平衡常数', 'K值', '平衡浓度'],
  'C-32': ['晶胞', '配位数', '晶体结构'],
  'C-16': ['原电池', '电解', '电极', '离子交换膜', '电子转移'],
  'C-09': ['微粒半径', '金属性', '非金属性', '第一电离能', '电负性', '同周期', '同主族'],
  'C-10': ['微粒半径', '金属性', '非金属性', '第一电离能', '电负性', '同周期', '同主族'],
  'C-06': ['阿伏加德罗', '物质的量', '摩尔', 'NA'],
  'C-12': ['盖斯定律', '反应热', '焓变', '燃烧热', '中和热'],
  'C-17': ['化学反应速率', '速率常数', '活化能', '催化剂'],
  'C-18': ['△H', '熵变', '自发', '吉布斯'],
  'C-21': ['影响', '压强影响', '温度影响', '浓度影响'],
  'C-27': ['烷烃', '烯烃', '炔烃', '苯环', '芳香'],
  'C-28': ['酯化', '水解', '加聚', '缩聚', '高分子'],
  'C-33': ['离子方程式正误', '离子共存'],
  'C-35': ['元素推断', '短周期元素', '甲乙丙丁'],
  'C-38': ['氮的化合物', '硝酸', '铵盐', '氨气'],
  'C-42': ['方案评价', '实验方案', '设计实验'],
  'C-43': ['定量实验', '滴定', '误差', '中和滴定'],
} : subject === 'math' ? {
  'M-01': ['切线', '导数', '切点'],
  'M-02': ['单调', '极值', '极小值', '极大值', '含参数'],
  'M-03': ['零点', '实根', '根的个数'],
  'M-06': ['椭圆', '离心率', '焦点'],
  'M-07': ['双曲线', '渐近线'],
  'M-08': ['抛物线', '准线'],
  'M-12': ['空间向量', '法向量', '二面角'],
  'M-13': ['概率', '互斥', '相互独立', '条件概率'],
  'M-14': ['分布列', '数学期望', '二项分布', '超几何'],
  'M-15': ['回归', '独立性检验', '百分位数', '相关系数'],
  'M-17': ['化简', '求值', 'sin', 'cos', 'tan'],
  'M-19': ['正弦定理', '余弦定理', '解三角形'],
  'M-20': ['等差数列', '等比数列', '前n项和', '通项'],
  'M-24': ['集合', '交集', '并集', '补集', '子集'],
  'M-25': ['复数', '共轭', '虚部', '纯虚数'],
  'M-26': ['向量', '数量积', '夹角'],
  'M-27': ['不等式', '线性规划', '最大值', '最小值'],
  'M-28': ['二项式', '展开式', '排列', '组合'],
} : {}

// ---------- 考点归类 ----------
// 判据词（cues）命中越长越可信；考点名里的词命中给双倍权重
const NAME_TOKENS = new Map()
const CUE_TOKENS = new Map()
for (const [tid, t] of Object.entries(topicsDoc.topics)) {
  const names = String(t.name || '')
    .split(/[、，,：:（）()／/·+＋与和及的及]/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2)
  NAME_TOKENS.set(tid, names)
  CUE_TOKENS.set(tid, (t.cues || []).filter((c) => String(c).trim().length >= 2))
}
function classify(stem) {
  if (forceTopic && topicsDoc.topics[forceTopic]) return forceTopic
  const text = stem.toLowerCase()
  // 先看硬关键词：命中最多的那个考点直接用
  let hintBest = null
  for (const [tid, words] of Object.entries(HINTS)) {
    let hit = 0
    for (const w of words) if (text.includes(w.toLowerCase())) hit++
    if (hit >= 2 && (!hintBest || hit > hintBest.hit)) hintBest = { tid, hit }
  }
  if (hintBest) return hintBest.tid
  let best = null
  for (const tid of Object.keys(topicsDoc.topics)) {
    let score = 0
    for (const c of CUE_TOKENS.get(tid) || []) {
      if (text.includes(String(c).toLowerCase())) score += String(c).length + 2
    }
    for (const n of NAME_TOKENS.get(tid) || []) {
      if (text.includes(n.toLowerCase())) score += n.length * 2
    }
    if (!best || score > best.score) best = { tid, score }
  }
  return best && best.score >= 4 ? best.tid : fallbackTopic
}

// 数据集自带一些小错字，顺手改掉
const TYPO = [[/坚直/g, '竖直'], [/㲴核/g, '氘核'], [/平衝/g, '平衡'], [/飽和/g, '饱和']]
const cleanStem = (t) =>
  t.replace(/^\s*\d+\s*[.．]\s*/, '')
   .replace(/[（(]\s*\d+\s*分\s*[）)]/g, '')
   .replace(/\s{2,}/g, ' ')
   .trim()

// 一段材料带多个小问（英语阅读、语文现代文）：按题号切开，材料复制到每题前面
function splitMultiQuestions(text, n) {
  const re = /^[ \t]*(\d{1,3})[ \t]*[.．、][ \t]*/gm
  const hits = [...text.matchAll(re)]
  if (hits.length < 2 || hits.length !== n) return null
  const passage = text.slice(0, hits[0].index).trim()
  if (passage.length < 40) return null
  const blocks = hits.map((h, i) => text.slice(h.index, i + 1 < hits.length ? hits[i + 1].index : text.length))
  return { passage, blocks }
}

const stemKey = (s) => createHash('sha1').update(s.replace(/\s+/g, '')).digest('hex').slice(0, 16)
const isFigureQuestion = (s) => /如图|图甲|图乙|图丙|图示|图所示|如下图|左图|右图/.test(s)

// ---------- 主流程 ----------
const doc = JSON.parse(readFileSync(file, 'utf8'))
const items = Array.isArray(doc) ? doc : doc.example || []
const bank = JSON.parse(readFileSync(bankPath, 'utf8'))
bank.questions ||= []
const seen = new Set(bank.questions.map((q) => stemKey(q.stem || '')))

let added = 0, skippedFigure = 0, skippedDup = 0, noAnswer = 0, skippedNoIndex = 0, skippedMulti = 0
const byTopic = {}

for (const it of items) {
  const rawQ = deTeX(it.question || '')
  if (!rawQ) continue
  if (!keepFigure && isFigureQuestion(rawQ)) { skippedFigure++; continue }
  const answers = parseAnswer(it.answer)
  if (!answers.length) { noAnswer++; continue }
  if (answers.length > 1) {
    if (!splitMulti) { skippedMulti++; continue }
    const sm = splitMultiQuestions(rawQ, answers.length)
    if (!sm) { skippedMulti++; continue }
    for (let i = 0; i < sm.blocks.length; i++) {
      const piece = deTeX(sm.blocks[i])
      const parsed = splitChoices(piece)
      if (!parsed.choices || parsed.choices.length < 2) { continue }
      const full = sm.passage.replace(/\s+/g, ' ') + '\n\n' + cleanStem(parsed.stem)
      const key2 = stemKey(full)
      if (seen.has(key2)) { skippedDup++; continue }
      seen.add(key2)
      const idx2 = LETTER.indexOf(String(answers[i]).trim().slice(0, 1).toUpperCase())
      if (idx2 < 0 || idx2 >= parsed.choices.length) { skippedNoIndex++; continue }
      bank.questions.push({
        id: `gk-${subject}-${key2}`,
        topic: classify(full),
        type: 'choice',
        difficulty: estimateDifficulty(it.score, full),
        stem: full,
        choices: parsed.choices.map((c) => c.text),
        answer: { value: [idx2] },
        source: `GAOKAO-Bench 高考真题 ${it.year || ''} ${String(it.category || '').replace(/[（）]/g, '')}（第 ${i + 1} 小问）`,
        sourceUrl: 'https://github.com/OpenLMLab/GAOKAO-Bench',
      })
      byTopic[bank.questions[bank.questions.length - 1].topic] = (byTopic[bank.questions[bank.questions.length - 1].topic] || 0) + 1
      added++
    }
    continue
  }

  let { stem, choices } = kind === 'mcq' ? splitChoices(rawQ) : { stem: rawQ, choices: null }
  for (const [re, to] of TYPO) stem = stem.replace(re, to)
  stem = cleanStem(stem)
  if (!stem || stem.length < 8) continue
  const key = stemKey(stem)
  if (seen.has(key)) { skippedDup++; continue }
  seen.add(key)

  const year = String(it.year || '')
  const paper = String(it.category || '').replace(/[（）]/g, '')
  const q = {
    id: `gk-${subject}-${key}`,
    topic: classify(stem),
    type: choices ? 'choice' : 'text',
    difficulty: estimateDifficulty(it.score, stem),
    stem,
    source: `GAOKAO-Bench 高考真题 ${year} ${paper}（第 ${Number(it.index) + 1} 题）`,
    sourceUrl: 'https://github.com/OpenLMLab/GAOKAO-Bench',
  }
  if (keepTex) {
    // 原文（未去 LaTeX）留一份，渲染时优先用它。注意 rawQ 已经被 deTeX 过，这里必须回到 it.question
    const rawSrc = String(it.question || '')
    const rawSplit = kind === 'mcq' ? splitChoices(rawSrc) : { stem: rawSrc, choices: null }
    // TeX 原文也要过一遍清洗（去掉「1.（6 分）」这类前缀与已知错字），否则页面上会把题号排进公式区
    let texStem = String(rawSplit.stem || rawSrc).trim()
    for (const [re, to] of TYPO) texStem = texStem.replace(re, to)
    q.stemTex = cleanStem(texStem)
    if (rawSplit.choices) q.choicesTex = rawSplit.choices.map((c) => String(c.text).trim())
    const rawSol = String(it.analysis || '')
    if (/[$]/.test(rawSol)) q.solutionTex = rawSol.trim()
  }
  if (choices) {
    q.choices = choices.map((c) => c.text)
    const idx = answers
      .map((a) => LETTER.indexOf(String(a).trim().slice(0, 1).toUpperCase()))
      .filter((i) => i >= 0 && i < choices.length)
    if (!idx.length) { skippedNoIndex++; continue }
    q.answer = { value: idx }
  } else {
    q.answer = { reference: answers.join('；') }
  }
  const sol = deTeX(it.analysis || '')
  if (sol) q.solution = sol
  bank.questions.push(q)
  byTopic[q.topic] = (byTopic[q.topic] || 0) + 1
  added++
}

writeFileSync(bankPath, JSON.stringify(bank, null, 2) + '\n')

const named = Object.entries(byTopic)
  .sort((a, b) => b[1] - a[1])
  .map(([t, n]) => `${t}(${topicsDoc.topics[t]?.name || '?'}) ${n}`)
console.log(
  `${subject} ${kind}：新增 ${added} 题 → ${bankPath}\n` +
  `跳过：图形题 ${skippedFigure}、重复 ${skippedDup}、无答案 ${noAnswer}、答案下标对不上 ${skippedNoIndex}、多小问未拆 ${skippedMulti}\n` +
  `归属：${named.join('、') || '无'}`
)
