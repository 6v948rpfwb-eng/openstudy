/**
 * index.js —— DSH 插件外壳
 *
 * 引擎在 ../core，这里只做三件事：找到题库、调用引擎、把结果说成人话。
 * 这样"在会话里出卷/判分"和"网页上做题"用的是同一套逻辑，不会两边算得不一样。
 *
 * 数据放哪：
 *   题库 → <工作区>/openstudy-data/*.bank.json
 *   进度 → <工作区>/.openstudy/state-<subject>.json
 *   卷子 → <工作区>/.openstudy/papers/<paperId>.json
 */

import { promises as fs } from 'node:fs'
import { join, basename } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

import { loadBank, validateBank } from '../core/bank.js'
import { composePaper } from '../core/select.js'
import { grade } from '../core/grade.js'
import { emptyState, finishSession, dueTopics, topicMastery } from '../core/state.js'
import { describeTheta, predictPass } from '../core/irt.js'

export const name = 'openstudy'
export const inject = ['tools']

const DATA_DIR = 'openstudy-data'
const STATE_DIR = '.openstudy'

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

/** 列出工作区里所有题库 */
async function listBanks(cwd) {
  const dir = join(cwd, DATA_DIR)
  let names = []
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.bank.json'))
  } catch {
    return []
  }
  const out = []
  for (const n of names) {
    try {
      const { bank } = loadBank(await fs.readFile(join(dir, n), 'utf8'))
      out.push({ file: n, bank })
    } catch (e) {
      out.push({ file: n, error: e.message })
    }
  }
  return out
}

async function pickBank(cwd, subject) {
  const banks = await listBanks(cwd)
  const ok = banks.filter((b) => b.bank)
  if (ok.length === 0) {
    throw new Error(
      `没找到题库。请把 *.bank.json 放进 ${join(cwd, DATA_DIR)}/。`
      + (banks.length ? `\n现有文件解析失败：\n${banks.map((b) => `  ${b.file}: ${b.error}`).join('\n')}` : ''),
    )
  }
  if (subject) {
    const hit = ok.find((b) => b.bank.subject === subject || b.bank.title === subject)
    if (!hit) throw new Error(`没有学科「${subject}」，现有：${ok.map((b) => b.bank.subject).join('、')}`)
    return hit.bank
  }
  if (ok.length > 1) throw new Error(`有多个题库，请用 subject 指定：${ok.map((b) => `${b.bank.subject}(${b.bank.title})`).join('、')}`)
  return ok[0].bank
}

function statePath(cwd, subject) {
  return join(cwd, STATE_DIR, `state-${subject}.json`)
}

async function readState(cwd, subject) {
  try {
    const s = JSON.parse(await fs.readFile(statePath(cwd, subject), 'utf8'))
    return s?.version === 1 ? s : emptyState(subject)
  } catch {
    return emptyState(subject)
  }
}

async function writeState(cwd, state) {
  await ensureDir(join(cwd, STATE_DIR))
  await fs.writeFile(statePath(cwd, state.subject), JSON.stringify(state, null, 2), 'utf8')
}

const okText = (text) => ({
  schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
  render: (_a, v) => [{ type: 'text', text: v.text }],
})

export function apply(ctx) {
  // ---------- 1. 组卷 ----------
  ctx.tools.register(defineTool({
    name: 'openstudy_paper',
    description:
      '从题库组一张练习卷给学生做。选题按"难度摊匀"原则：以学生当前能力为中心、'
      + '把难度铺开，太简单和太难的题都会被降权。返回的卷面**不含答案**。'
      + '组完会把卷子存到 .openstudy/papers/ 里，之后用 openstudy_grade 逐题判分。',
    parameters: {
      subject: { type: 'string', required: false, description: '学科代号，如 physics、chemistry；只有一个题库时可省略' },
      n: { type: 'number', required: false, description: '题数，默认 12' },
    },
    output: okText(),
    async execute(args, exec) {
      const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
      const bank = await pickBank(cwd, args?.subject)
      const state = await readState(cwd, bank.subject)
      const n = Math.max(1, Math.min(50, Math.round(args?.n ?? 12)))

      const { picked, meta } = composePaper(bank, { theta: state.theta, n, progress: state })
      const paperId = `p${Date.now().toString(36)}`
      await ensureDir(join(cwd, STATE_DIR, 'papers'))
      await fs.writeFile(
        join(cwd, STATE_DIR, 'papers', `${paperId}.json`),
        JSON.stringify({ paperId, subject: bank.subject, at: Date.now(), questions: picked.map((q) => q.id) }, null, 2),
        'utf8',
      )

      const lines = []
      lines.push(`# ${bank.title} · 练习卷（${picked.length} 题）`)
      lines.push(`卷号 ${paperId}｜当前能力 θ=${state.theta}（${describeTheta(state.theta)}）`)
      lines.push(`难度分布 min ${meta.difficultySpread.min} / 均 ${meta.difficultySpread.mean} / max ${meta.difficultySpread.max}`)
      lines.push('')
      picked.forEach((q, i) => {
        const p = Math.round(predictPass(state.theta, q.difficulty) * 100)
        lines.push(`## ${i + 1}. [${q.id}]  ${bank.topics[q.topic]?.name ?? q.topic}　通过率预测 ${p}%`)
        lines.push(q.stem)
        if (q.type === 'choice') {
          q.choices.forEach((c, k) => lines.push(`  ${'ABCDEFG'[k]}. ${c}`))
        }
        lines.push('')
      })
      lines.push('---')
      lines.push('做完把答案发给我，我用 openstudy_grade 逐题判分并更新能力。')

      return { text: lines.join('\n') }
    },
    presentCall(args) {
      return { card: 'generic', title: `出卷：${args?.subject ?? '默认学科'}`, kind: 'read', rawInput: String(args?.subject ?? '') }
    },
  }))

  // ---------- 2. 判分 ----------
  ctx.tools.register(defineTool({
    name: 'openstudy_grade',
    description:
      '判定一道题的作答并更新能力估计与复习排程。数值题按相对容差比较（默认 1%），'
      + '选择题按下标比较，主观题无法自动判、会返回参考答案让人自评。',
    parameters: {
      subject: { type: 'string', required: false, description: '学科代号' },
      questionId: { type: 'string', required: true, description: '题目 id，如 q001' },
      answer: { type: 'string', required: true, description: '学生的作答（数值题填数字，选择题填字母如 B）' },
      selfGrade: { type: 'string', required: false, description: '主观题自评：full / half / none' },
    },
    output: okText(),
    async execute(args, exec) {
      const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
      const bank = await pickBank(cwd, args?.subject)
      const q = bank.questions.find((x) => x.id === args?.questionId)
      if (!q) throw new Error(`题库里没有 id 为「${args?.questionId}」的题`)

      let input = args?.answer
      if (q.type === 'choice' && typeof input === 'string') {
        const letter = input.trim().toUpperCase()
        if (/^[A-G]$/.test(letter)) input = 'ABCDEFG'.indexOf(letter)
        else input = Number(input) - 1
      }
      if (q.type === 'text') input = args?.selfGrade ?? 'none'

      const g = grade(q, input)
      const state = await readState(cwd, bank.subject)
      const counts = q.type !== 'text'
      const { report } = finishSession(state, bank, [{ question: q, correct: g.correct === true, countsForTheta: counts }])
      await writeState(cwd, state)

      const lines = []
      lines.push(g.correct ? `对：${q.id}` : `错：${q.id}`)
      if (g.reason) lines.push(g.reason)
      if (q.solution) lines.push(`解析：${q.solution}`)
      lines.push('')
      lines.push(`能力 θ ${report.thetaBefore} → ${report.thetaAfter}（${report.level}）`)
      for (const t of report.topicUpdates) {
        lines.push(`考点「${t.name}」：${t.correct}/${t.asked}，下次 ${t.nextDueDays} 天后`)
      }
      return { text: lines.join('\n') }
    },
  }))

  // ---------- 3. 看状态 ----------
  ctx.tools.register(defineTool({
    name: 'openstudy_status',
    description: '查看某学科的练习进度：当前能力、各考点掌握度、哪些考点到了该复习的时候。',
    parameters: {
      subject: { type: 'string', required: false, description: '学科代号' },
    },
    output: okText(),
    async execute(args, exec) {
      const cwd = exec?.agent?.session?.header?.cwd ?? process.cwd()
      const banks = await listBanks(cwd)
      if (banks.length === 0) return { text: `还没放题库。把 *.bank.json 放进 ${join(cwd, DATA_DIR)}/ 就能用。` }

      const targets = args?.subject
        ? banks.filter((b) => b.bank?.subject === args.subject)
        : banks.filter((b) => b.bank)
      if (targets.length === 0) throw new Error(`没有学科「${args?.subject}」`)

      const lines = []
      for (const { bank } of targets) {
        const state = await readState(cwd, bank.subject)
        lines.push(`# ${bank.title}（${bank.subject}）`)
        lines.push(`能力 θ=${state.theta}，${describeTheta(state.theta)}；练过 ${state.log.length} 场`)
        const due = dueTopics(state, bank)
        if (due.length) {
          lines.push(`该复习：${due.map((d) => `${d.name}(逾期${d.lateDays}天)`).join('、')}`)
        } else {
          lines.push('暂无到期考点')
        }
        const rows = Object.entries(bank.topics).map(([id, t]) => {
          const rec = state.topics[id]
          const m = rec ? Math.round(topicMastery(rec) * 100) : null
          return `  ${id} ${t.name}：${rec ? `${rec.correct}/${rec.attempts}，掌握度 ${m}%` : '还没做过'}`
        })
        lines.push(...rows)
        lines.push('')
      }
      return { text: lines.join('\n') }
    },
  }))
}
