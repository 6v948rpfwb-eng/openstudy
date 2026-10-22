#!/usr/bin/env node
/**
 * import-md.js —— 把真题 Markdown 转成开卷题库
 *
 * 做一件事：读你 `资料/` 里的真题原文，产出 `openstudy-data/*.bank.json`。
 * 不做的事：不联网、不改原文、不自己编题。原文里没有的，这里也不会有。
 *
 * 用法：
 *   node tools/import-md.js \
 *     --topics tools/topics-physics.json \
 *     --out openstudy-data/physics.bank.json \
 *     "../高三学习/学科-物理/资料/2026-1月-浙江选考-物理-真题.md" \
 *     "../高三学习/学科-物理/资料/2026-6月-浙江选考-物理-真题.md"
 *
 * 额外开关：
 *   --exclude-figure   丢掉带 [图 …] 标注的题（默认保留，因为标注本身常常是文字描述）
 *   --dry-run          只解析、只打印报告，不写文件
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { validateBank } from '../core/bank.js'

// ─────────────────────────────── 小工具 ───────────────────────────────

const ROMAN = { 'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4 }
const FULLWIDTH_SPACE = '\u3000'

function round3(x) {
  return Math.round(x * 1000) / 1000
}

/** 解析命令行 */
function parseArgv(argv) {
  const opts = { topics: null, out: null, files: [], excludeFigure: false, dryRun: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--topics') opts.topics = argv[++i]
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--exclude-figure') opts.excludeFigure = true
    else if (a === '--dry-run') opts.dryRun = true
    else if (a.startsWith('--')) throw new Error(`不认识的参数：${a}`)
    else opts.files.push(a)
  }
  return opts
}

/** 按行切块：命中 headerRe 的行开启一个新块，其余行归当前块 */
function splitBlocks(lines, headerRe) {
  const out = []
  let cur = null
  for (const line of lines) {
    const m = line.match(headerRe)
    if (m) {
      if (cur) out.push(cur)
      cur = { id: m[1], head: m[2] ?? '', lines: [] }
    } else if (cur) {
      cur.lines.push(line)
    }
  }
  if (cur) out.push(cur)
  return out
}

// ─────────────────────────────── 解析一道题 ───────────────────────────────

/** 从题干正文里抠出 A/B/C/D 四个选项 */
function extractChoices(body) {
  // 选项可能写成一行（用全角空格分隔），也可能一选项一行。
  // 先把「全角空格 + 字母.」换成换行，统一成一行一项。
  const normalized = body.replace(new RegExp(`${FULLWIDTH_SPACE}(?=[A-D][\\.．])`, 'g'), '\n')
  const lines = normalized.split('\n').map((s) => s.trim()).filter(Boolean)

  const picked = new Map()
  for (const line of lines) {
    const m = line.match(/^([A-D])[\.．]\s*(.*)$/)
    if (!m) continue
    const [, key, text] = m
    if (!picked.has(key)) picked.set(key, text.trim())
  }

  // 必须至少凑出 A、B 两个，才认为是选项块
  if (!picked.has('A') || !picked.has('B')) return null
  const keys = ['A', 'B', 'C', 'D'].filter((k) => picked.has(k))
  const texts = keys.map((k) => picked.get(k))

  // 选项是纯图的情形：原文只写了 "A.　B.　C.　D."，文字是空的。
  // 这种题在文字界面里没法做，按 text 处理（给参考答案让人自己核对）。
  if (texts.filter((t) => t && t.trim()).length < 2) return null

  return texts
}

/** 选项块在正文里的起点（找不到返回 -1） */
function choiceStartIndex(body) {
  const normalized = body.replace(new RegExp(`${FULLWIDTH_SPACE}(?=[A-D][\\.．])`, 'g'), '\n')
  const idx = normalized.search(/(?:^|\n)\s*A[\.．]\s/)
  return idx < 0 ? -1 : idx
}

/** 解析「一个数值答案」，支持 4.2×10^-4 这种写法 */
function parseNumericAnswer(raw) {
  const s = raw.trim().replace(/\s/g, '').replace(/−/g, '-')
  // 纯数字
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s)
  // a×10^b / a*10^b / a×10b
  const m = s.match(/^(-?\d+(?:\.\d+)?)[×xX*]10\^?(-?\d+)$/)
  if (m) return Number(m[1]) * Math.pow(10, Number(m[2]))
  return null
}

/**
 * 题号 → 难度。
 * 浙江选考的卷面结构是固定的：1–10 单选，11–13 多选，14 实验，15–18 计算。
 * 先按题号给一个粗值，之后用真实正确率去校准（引擎里的 θ 更新会自动做这件事）。
 */
function difficultyOf(n) {
  if (n <= 10) return round3(0.15 + ((n - 1) * 0.3) / 9) // 0.15 → 0.45
  if (n <= 13) return round3(0.5 + ((n - 11) * 0.15) / 2) // 0.50 → 0.65
  if (n === 14) return 0.62
  if (n <= 18) return round3(0.7 + ((n - 15) * 0.25) / 3) // 0.70 → 0.95
  return 0.8
}

/** 按关键词归考点：规则数组按顺序试，第一条命中即用 */
function topicOf(text, rules) {
  for (const r of rules) {
    for (const kw of r.keywords) {
      if (text.includes(kw)) return r.topic
    }
  }
  return 'P-99'
}

// ─────────────────────────────── 解析一份卷子 ───────────────────────────────

function parsePaper(text, filePath, rules) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  // 卷面标题
  const rawTitle = (lines.find((l) => /^#\s+/.test(l)) ?? '').replace(/^#\s+/, '').trim()

  // 来源链接（原文自己写的那个）
  const urlMatch = text.match(/来源[：:][^\n]*?\((https?:\/\/[^)\s]+)\)/)
  const sourceUrl = urlMatch ? urlMatch[1] : ''

  // 卷名：把标题里的空格去掉，"真题"去掉
  const label = (rawTitle || path.basename(filePath, '.md'))
    .replace(/\s+/g, '')
    .replace(/真题.*$/, '')
    .trim()

  // 卷子代号：2026-01-zj
  let slug = path.basename(filePath, '.md').replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
  const ym = (rawTitle || '').match(/(\d{4})\s*年\s*(\d{1,2})\s*月/)
  if (ym) {
    const region = /浙江/.test(rawTitle) ? 'zj' : /杭州/.test(rawTitle) ? 'hz' : 'raw'
    slug = `${ym[1]}-${String(ym[2]).padStart(2, '0')}-${region}`
  }

  // 切成「题目区」和「答案区」
  const ansAt = lines.findIndex((l) => /^##\s*参考答案/.test(l))
  const questionLines = ansAt >= 0 ? lines.slice(0, ansAt) : lines
  const answerLines = ansAt >= 0 ? lines.slice(ansAt + 1) : []

  // 题目块：**1.** / **14-Ⅰ.（6 分）**
  const qBlocks = splitBlocks(questionLines, /^\*\*(\d+(?:-[ⅠⅡⅢ]+)?)[\.．]\s*(.*)$/)
  // 答案块：**1.【答案】C**
  const aBlocks = splitBlocks(answerLines, /^\*\*(\d+(?:-[ⅠⅡⅢ]+)?)[\.．]【答案】(.*)$/)

  const answerMap = new Map()
  for (const b of aBlocks) {
    let inline = b.head
    if (inline.endsWith('**')) inline = inline.slice(0, -2).trim()
    const explain = b.lines
      .join('\n')
      .replace(/^\s*\*\*\s*$/gm, '')
      .trim()
    answerMap.set(b.id, { inline, explain })
  }

  const questions = []
  const report = { papers: [], skipped: [], noAnswer: [], unclassified: [], withFigure: [], byType: {} }

  for (const block of qBlocks) {
    // 只有标题行、后面一行正文都没有的（如 **14. 实验题（Ⅰ、Ⅱ、Ⅲ 三题共 14 分）**）
    // 是分节标题不是题目，直接跳过
    if (!block.lines.join('').trim()) continue

    const rawBody = [block.head, ...block.lines].join('\n').trim()

    // 去掉题号后面的「（N 分）**」标记
    let body = rawBody
      .replace(/^（\s*\d+\s*分\s*）\s*/, '')
      .replace(/^\*\*/, '')
      .replace(/\*\*\s*$/, '')
      .trim()

    const [numPart, subRoman] = block.id.split('-')
    const num = Number(numPart)
    if (!Number.isFinite(num)) continue

    const ans = answerMap.get(block.id)
    if (!ans) {
      report.noAnswer.push(`${label} 第${block.id}题`)
      continue
    }

    const hasSubParts = /（\s*1\s*）/.test(body)
    const choices = extractChoices(body)
    const letters = ans.inline.replace(/[\s\u3000，,、；;]/g, '')
    const isLetters = /^[A-D]{1,4}$/.test(letters)
    const needsFigure = /\[图/.test(body)

    // 决定题型
    let type
    let answer
    if (!hasSubParts && choices && choices.length >= 2 && isLetters) {
      type = 'choice'
      answer = { value: [...letters].map((c) => c.charCodeAt(0) - 65) }
    } else if (!hasSubParts && !choices && parseNumericAnswer(letters || ans.inline) !== null) {
      type = 'numeric'
      const v = parseNumericAnswer(letters || ans.inline)
      answer = { value: v, relTol: 0.01 }
    } else {
      type = 'text'
      answer = {
        reference: ans.inline || ans.explain,
        // 原文把答案直接写在解析里时，标记一下，方便你回头核对
        ...(ans.inline ? {} : { referenceFromSolution: true }),
      }
    }

    // 选择题的题干要去掉选项部分
    let stem = body
    if (type === 'choice') {
      const cut = choiceStartIndex(body)
      if (cut > 0) stem = body.slice(0, cut).trim()
    }
    stem = stem.replace(/\n{3,}/g, '\n\n').trim()

    const id = `${slug}-q${num}${subRoman ? `-${ROMAN[subRoman] ?? subRoman}` : ''}`
    const topic = topicOf(body, rules)
    const solution = ans.explain || ''

    questions.push({
      id,
      topic,
      type,
      difficulty: difficultyOf(num),
      stem,
      ...(type === 'choice' ? { choices } : {}),
      answer,
      solution,
      source: `${label} 第${block.id}题`,
      ...(needsFigure ? { needsFigure: true } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    })

    report.byType[type] = (report.byType[type] ?? 0) + 1
    if (topic === 'P-99') report.unclassified.push(`${id} 第${block.id}题`)
    if (needsFigure) report.withFigure.push(id)
  }

  // 这卷存在、但解析器没给答案的题号（人工核对用）
  const got = new Set(questions.map((q) => q.id))
  for (const b of aBlocks) {
    const [numPart, subRoman] = b.id.split('-')
    const id = `${slug}-q${numPart}${subRoman ? `-${ROMAN[subRoman] ?? subRoman}` : ''}`
    if (!got.has(id)) report.skipped.push(`${label} 第${b.id}题`)
  }

  report.papers.push({
    file: path.basename(filePath),
    label,
    slug,
    questions: questions.length,
    byType: { ...report.byType },
  })

  return { questions, report }
}

// ─────────────────────────────── 主流程 ───────────────────────────────

function main() {
  const opts = parseArgv(process.argv.slice(2))

  if (!opts.topics) throw new Error('必须用 --topics 指定考点表文件（见 tools/topics-physics.json）')
  if (opts.files.length === 0) throw new Error('至少要给一个真题 Markdown 文件')
  if (!opts.out && !opts.dryRun) throw new Error('要么给 --out，要么用 --dry-run')

  const topicCfg = JSON.parse(readFileSync(opts.topics, 'utf8'))
  const rules = topicCfg.rules ?? []

  let all = []
  const reports = []

  for (const f of opts.files) {
    if (!existsSync(f)) throw new Error(`找不到文件：${f}`)
    const text = readFileSync(f, 'utf8')
    const { questions, report } = parsePaper(text, f, rules)
    all = all.concat(questions)
    reports.push(report)
  }

  // 可选：丢掉依赖图的题
  let dropped = []
  if (opts.excludeFigure) {
    const keep = []
    for (const q of all) {
      if (q.needsFigure) dropped.push(q.id)
      else keep.push(q)
    }
    all = keep
  }

  const byType = {}
  for (const q of all) byType[q.type] = (byType[q.type] ?? 0) + 1

  const bank = {
    subject: topicCfg.subject,
    title: topicCfg.title,
    version: 1,
    topics: topicCfg.topics,
    questions: all,
  }

  // ── 报告 ──
  const line = (s = '') => process.stdout.write(s + '\n')
  line()
  for (const r of reports) {
    for (const p of r.papers) {
      line(`📄 ${p.file}`)
      line(`   卷名：${p.label}   代号：${p.slug}`)
      line(`   解析出 ${p.questions} 道：${Object.entries(p.byType).map(([k, v]) => `${k} ${v}`).join(' / ')}`)
    }
  }
  line()
  line(`合计 ${all.length} 道题（${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(' / ')}）`)
  line(`其中带 [图 …] 标注的 ${all.filter((q) => q.needsFigure).length} 道${opts.excludeFigure ? `，已按 --exclude-figure 丢弃 ${dropped.length} 道` : '（默认保留，标注文字本身就是图的内容描述）'}`)

  const unclassified = reports.flatMap((r) => r.unclassified)
  const noAnswer = reports.flatMap((r) => r.noAnswer)
  const skipped = reports.flatMap((r) => r.skipped)

  if (noAnswer.length) {
    line()
    line(`⚠️  原文有答案、但没对上题干的 ${noAnswer.length} 条：`)
    for (const s of noAnswer) line(`     ${s}`)
  }
  if (skipped.length) {
    line()
    line(`⚠️  答案区存在、但题目区没解析到的 ${skipped.length} 条：`)
    for (const s of skipped) line(`     ${s}`)
  }
  if (unclassified.length) {
    line()
    line(`⚠️  考点没归到自己头上的 ${unclassified.length} 道（进了 P-99 未分类，改 tools/topics-physics.json 的关键词后重跑即可）：`)
    for (const s of unclassified) line(`     ${s}`)
  }

  // ── 校验 ──
  const check = validateBank(bank)
  line()
  if (!check.ok) {
    line(`❌ 题库没通过校验，共 ${check.errors.length} 条错误：`)
    for (const e of check.errors.slice(0, 40)) line(`     ${e}`)
    if (check.errors.length > 40) line(`     …还有 ${check.errors.length - 40} 条`)
    process.exitCode = 1
    return
  }
  line('✅ 题库通过校验')
  if (check.warnings.length) {
    line(`   （${check.warnings.length} 条提示，不影响使用）`)
    for (const w of check.warnings.slice(0, 15)) line(`     · ${w}`)
    if (check.warnings.length > 15) line(`     …还有 ${check.warnings.length - 15} 条`)
  }

  if (opts.dryRun) {
    line()
    line('（--dry-run，没有写文件）')
    return
  }

  // ── 写文件 ──
  mkdirSync(path.dirname(opts.out), { recursive: true })
  writeFileSync(opts.out, JSON.stringify(bank, null, 2), 'utf8')
  line()
  line(`已写入 ${opts.out}（${(JSON.stringify(bank).length / 1024).toFixed(1)} KB）`)
}

main()
