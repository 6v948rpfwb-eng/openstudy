/**
 * bank.js —— 题库的格式与校验
 *
 * 一条原则：**学科是数据，不是代码**。
 * 想让引擎多支持一门学科，只加一个 JSON 文件，不改一行代码。
 */

/** 题库文件应该是这个形状 */
export const BANK_SCHEMA_HINT = {
  subject: 'physics',                 // 学科代号，必填
  title: '高中物理',                   // 显示名
  version: 1,
  topics: {
    'P-01': { name: '匀变速直线运动', desc: '速度、位移、加速度' },
  },
  questions: [
    {
      id: 'q001',
      topic: 'P-01',
      type: 'numeric',                // numeric | choice | text
      difficulty: 0.45,               // [0,1]，越大越难
      stem: '题干（支持换行）',
      answer: { value: 6, relTol: 0.01 },
      solution: '参考答案 / 解题步骤',
      source: '2024年浙江卷第12题',    // **必填**，见 validateBank
    },
  ],
}

export class BankError extends Error {}

/**
 * 校验题库。返回 { ok, errors, warnings, bank }
 *
 * errors   → 必须修，否则不加载
 * warnings → 能跑，但会有问题（比如某个考点只有 1 道题，组卷时会重复）
 */
export function validateBank(raw) {
  const errors = []
  const warnings = []

  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['题库不是一个对象'], warnings, bank: null }
  }
  if (!raw.subject) errors.push('缺少 subject（学科代号）')
  if (!raw.topics || typeof raw.topics !== 'object') errors.push('缺少 topics（考点表）')
  if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
    errors.push('questions 必须是非空数组')
  }

  const seen = new Set()
  const topicCount = new Map()

  for (const [i, q] of (raw.questions ?? []).entries()) {
    const at = `questions[${i}]${q?.id ? `(${q.id})` : ''}`

    if (!q || typeof q !== 'object') { errors.push(`${at}: 不是对象`); continue }
    if (!q.id) errors.push(`${at}: 缺少 id`)
    else if (seen.has(q.id)) errors.push(`${at}: id 重复`)
    else seen.add(q.id)

    if (!q.topic) errors.push(`${at}: 缺少 topic`)
    else if (raw.topics && !raw.topics[q.topic]) errors.push(`${at}: topic "${q.topic}" 不在 topics 表里`)
    else topicCount.set(q.topic, (topicCount.get(q.topic) ?? 0) + 1)

    if (typeof q.difficulty !== 'number' || q.difficulty < 0 || q.difficulty > 1) {
      errors.push(`${at}: difficulty 必须是 [0,1] 之间的数，现在是 ${q.difficulty}`)
    }

    if (!q.stem) errors.push(`${at}: 缺少 stem（题干）`)

    // 来源必须写。这是硬规则：没有来源的题不许进题库。
    if (!q.source) {
      errors.push(`${at}: 缺少 source。每道题必须写明出处（如「2024年浙江卷第12题」），防止来路不明的题混进题库`)
    }

    switch (q.type) {
      case 'numeric':
        if (!q.answer || q.answer.value === undefined) errors.push(`${at}: numeric 题必须有 answer.value`)
        else if (Array.isArray(q.answer.value) && q.answer.value.some((v) => !Number.isFinite(Number(v)))) {
          errors.push(`${at}: answer.value 里有非数字`)
        } else if (!Array.isArray(q.answer.value) && !Number.isFinite(Number(q.answer.value))) {
          errors.push(`${at}: answer.value 不是数字`)
        }
        break
      case 'choice':
        if (!Array.isArray(q.choices) || q.choices.length < 2) errors.push(`${at}: choice 题必须有至少 2 个 choices`)
        if (!q.answer || q.answer.value === undefined) errors.push(`${at}: choice 题必须有 answer.value（正确下标，从 0 起）`)
        else {
          const idx = Array.isArray(q.answer.value) ? q.answer.value : [q.answer.value]
          for (const k of idx) {
            if (!Number.isInteger(Number(k)) || Number(k) < 0 || Number(k) >= (q.choices?.length ?? 0)) {
              errors.push(`${at}: 正确下标 ${k} 超出 choices 范围`)
            }
          }
        }
        break
      case 'text':
        if (!q.answer || !q.answer.reference) {
          warnings.push(`${at}: text 题建议在 answer.reference 里写参考答案，方便自评`)
        }
        break
      default:
        errors.push(`${at}: 未知 type "${q.type}"，只能是 numeric / choice / text`)
    }

    if (!q.solution) warnings.push(`${at}: 没有 solution（解析），学生答错时看不到解释`)
  }

  // 考点覆盖检查
  for (const [tid, t] of Object.entries(raw.topics ?? {})) {
    const n = topicCount.get(tid) ?? 0
    if (n === 0) warnings.push(`考点 ${tid}(${t?.name ?? '?'}) 一道题都没有`)
    else if (n < 3) warnings.push(`考点 ${tid}(${t?.name ?? '?'}) 只有 ${n} 道题，组卷时会被重复抽到`)
  }

  return { ok: errors.length === 0, errors, warnings, bank: errors.length === 0 ? normalizeBank(raw) : null }
}

/** 补齐默认字段，统一形状 */
export function normalizeBank(raw) {
  return {
    subject: raw.subject,
    title: raw.title ?? raw.subject,
    version: raw.version ?? 1,
    topics: raw.topics ?? {},
    questions: raw.questions.map((q) => ({
      type: 'numeric',
      difficulty: 0.5,
      answer: {},
      solution: '',
      ...q,
      // 归一化：answer.value 一律存成数组，方便统一处理多空题
      answer: {
        ...q.answer,
        value: Array.isArray(q.answer?.value) ? q.answer.value : [q.answer?.value],
      },
    })),
  }
}

/** 从 JSON 文本加载 */
export function loadBank(text) {
  let raw
  try { raw = JSON.parse(text) } catch (e) {
    throw new BankError(`题库 JSON 解析失败：${e.message}`)
  }
  const res = validateBank(raw)
  if (!res.ok) {
    throw new BankError(`题库校验未通过：\n  - ${res.errors.join('\n  - ')}`)
  }
  return { bank: res.bank, warnings: res.warnings }
}

/** 按考点索引题目 */
export function indexByTopic(bank) {
  const m = new Map()
  for (const q of bank.questions) {
    if (!m.has(q.topic)) m.set(q.topic, [])
    m.get(q.topic).push(q)
  }
  return m
}
