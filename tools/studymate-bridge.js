#!/usr/bin/env node
/**
 * studymate-bridge.js —— 和 StudyMate（@yunmiao/studymate）互换题目与进度
 *
 * 两边数据模型不同，所以只换「能对上的部分」：
 *   StudyMate 侧：<科目>/lessons/<NNNN>-<节点>.quiz.json，键是课件里的锚点原句，值是题目数组；
 *                 题型四种，只有「客观题」有 opts + ans，能无损换成开卷的选择题。
 *   StudyMate 侧：<科目>/progress.json 三档（未开始/学习中/已学完）、misconceptions.yaml。
 *   开卷侧    ：*.bank.json（subject/topics/questions）；作答状态在 state-<subject>.json；
 *                 已测结论在《知识状态库》。
 *
 * 用法：
 *   node tools/studymate-bridge.js import --dir <StudyMate 科目目录> --subject physics \
 *        --topics tools/topics-physics.json --out openstudy-data/studymate-physics.bank.json
 *   node tools/studymate-bridge.js export --subject physics --out-dir <StudyMate 科目目录> [--dry]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { guessTopics } from '../core/framework.js'

const here = dirname(fileURLToPath(import.meta.url))
const STATE_MD = resolve(here, '../../../高三学习/学科-通用/知识状态/知识状态库.md')

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = (name, def = null) => {
  const i = argv.indexOf('--' + name)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def
}
const flag = (name) => argv.includes('--' + name)

const shortHash = (s) => createHash('sha1').update(String(s)).digest('hex').slice(0, 8)

/* ── import：StudyMate 客观题 → 开卷题库 ─────────────────────────────── */

function readQuizFiles(dir) {
  const lessons = join(dir, 'lessons')
  if (!existsSync(lessons)) throw new Error(`找不到 ${lessons}（StudyMate 的课件目录）`)
  return readdirSync(lessons)
    .filter((f) => f.endsWith('.quiz.json'))
    .map((f) => ({ file: f, node: f.replace(/\.quiz\.json$/, ''), pool: JSON.parse(readFileSync(join(lessons, f), 'utf8')) }))
}

function importFrom(dir, subject, topicsDoc, out) {
  const files = readQuizFiles(dir)
  const questions = []
  let skippedKind = 0
  let skippedShape = 0

  for (const { file, node, pool } of files) {
    if (!pool || typeof pool !== 'object') continue
    for (const [anchor, list] of Object.entries(pool)) {
      if (!Array.isArray(list)) continue
      list.forEach((q, i) => {
        const kind = q.kind || (q.opts && typeof q.ans === 'number' ? '客观题' : q.answer ? '开放题' : '')
        if (kind !== '客观题') { skippedKind++; return }
        if (!q.q || !Array.isArray(q.opts) || q.opts.length < 2 || typeof q.ans !== 'number' || q.ans < 0 || q.ans >= q.opts.length) {
          skippedShape++
          return
        }
        // guessTopics 返回 [{ topicId, name, score, hits }]；没命中就落到「未分类」
        const guess = guessTopics(topicsDoc, `${anchor} ${q.q}`, 1)[0]
        const topic = (guess && guess.score > 0 ? guess.topicId : null) || subjectDefaultTopic(topicsDoc)
        questions.push({
          id: `sm-${shortHash(node + anchor)}-${i}`,
          topic,
          type: 'choice',
          difficulty: 0.45,
          stem: String(q.q).trim(),
          choices: q.opts.map((x) => String(x)),
          answer: { value: [q.ans] },
          solution: q.why ? String(q.why) : '',
          source: `StudyMate · ${basename(file, '.quiz.json')} 第${i + 1}题`,
          sourceUrl: '',
          anchorText: anchor,
        })
      })
    }
  }

  const doc = {
    subject,
    title: topicsDoc.title || subject,
    version: 1,
    topics: topicsDoc.topics,
    questions,
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(doc, null, 1))
  console.log(`导入 ${files.length} 份课件 → ${questions.length} 道选择题（跳过非客观题 ${skippedKind}、字段不全 ${skippedShape}）`)
  console.log(`已写入 ${out}`)
  return doc
}

function subjectDefaultTopic(topicsDoc) {
  const ids = Object.keys(topicsDoc.topics)
  const un = ids.find((id) => /-99$/.test(id))
  return un || ids[ids.length - 1]
}

/* ── export：开卷的掌握度 → StudyMate 的 progress / misconceptions ────── */

const FLAG_ORDER = { '✅': 0, '⬜': 1, '🟡': 2, '🔴': 3 }

/** 《知识状态库》里的逐项行：编号 → 状态与错因（同一编号两轮记录时取更差的） */
function parseStateMd() {
  const rows = new Map()
  const md = readFileSync(STATE_MD, 'utf8')
  for (const line of md.split('\n')) {
    const m = line.match(/^\|\s*([物化技数语英])-(\d{2})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/)
    if (!m) continue
    const flagText = m[4]
    const flag = /✅/.test(flagText) ? '✅' : /🔴/.test(flagText) ? '🔴' : /🟡/.test(flagText) ? '🟡' : /⬜/.test(flagText) ? '⬜' : ''
    if (!flag) continue
    const id = `${m[1]}-${m[2]}`
    const prev = rows.get(id)
    if (prev && FLAG_ORDER[prev.flag] >= FLAG_ORDER[flag]) continue
    rows.set(id, { name: m[3].trim(), flag, evidence: m[5].trim(), errorType: m[6].trim() })
  }
  return rows
}

function exportTo(subject, outDir, dry) {
  const topicsDoc = JSON.parse(readFileSync(join(here, `topics-${subject}.json`), 'utf8'))
  const stateFile = resolve(here, '../../../高三学习/学科-通用/openstudy/state-' + subject + '.json')
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}
  if (!existsSync(stateFile)) console.log(`提示：没找到 ${stateFile}，只用《知识状态库》的结论判断进度`)
  const rows = parseStateMd()

  const nodes = {}
  for (const [id, t] of Object.entries(topicsDoc.topics)) {
    const alias = t.alias ? [t.alias] : []
    const items = alias.map((k) => rows.get(k)).filter(Boolean)
    const st = state.topics?.[id] || {}
    const answered = (st.seen || 0) > 0
    const solid = items.length > 0 && items.every((x) => x.flag === '✅')
    const status = solid && (st.intervalDays || 0) >= 7 ? '已学完' : (answered || items.length) ? '学习中' : '未开始'
    nodes[id] = { status }
  }

  const progress = { updated_at: new Date().toISOString(), nodes, project: { current: '' } }
  const miscon = ['# 误解记录（由开卷《知识状态库》导出，只列当时没做出来的）', '版本: 1']
  for (const [id, r] of rows) {
    if (r.flag !== '🔴') continue
    miscon.push(`${id}:`)
    miscon.push(`  描述: ${r.name}`)
    miscon.push(`  错因: ${r.errorType || '未标注'}`)
    if (r.evidence) miscon.push(`  证据: ${r.evidence}`)
  }

  const tally = Object.values(nodes).reduce((acc, n) => ((acc[n.status] = (acc[n.status] || 0) + 1), acc), {})
  console.log(`${subject}：${Object.keys(nodes).length} 个节点 → 未开始 ${tally['未开始'] || 0} / 学习中 ${tally['学习中'] || 0} / 已学完 ${tally['已学完'] || 0}`)
  console.log(`误解记录 ${miscon.filter((x) => /^\S+:/.test(x)).length} 条`)
  if (dry) { console.log('（--dry：不写盘）'); return }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'progress.json'), JSON.stringify(progress, null, 2))
  writeFileSync(join(outDir, 'misconceptions.yaml'), miscon.join('\n') + '\n')
  console.log(`已写入 ${join(outDir, 'progress.json')} 与 ${join(outDir, 'misconceptions.yaml')}`)
}

/* ── 入口 ─────────────────────────────────────────────────────────── */

if (cmd === 'import') {
  const dir = opt('dir')
  const subject = opt('subject', 'physics')
  if (!dir) throw new Error('import 需要 --dir <StudyMate 科目目录>')
  const topicsDoc = JSON.parse(readFileSync(resolve(opt('topics', join(here, `topics-${subject}.json`))), 'utf8'))
  importFrom(dir, subject, topicsDoc, resolve(opt('out', join(here, '../openstudy-data', `studymate-${subject}.bank.json`))))
} else if (cmd === 'export') {
  exportTo(opt('subject', 'physics'), opt('out-dir', join(here, '../openstudy-data/studymate-export')), flag('dry'))
} else {
  console.log('用法：node tools/studymate-bridge.js import --dir <StudyMate科目目录> --subject physics --out x.bank.json')
  console.log('      node tools/studymate-bridge.js export --subject physics --out-dir <目录> [--dry]')
}
