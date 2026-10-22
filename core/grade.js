/**
 * grade.js —— 判分
 *
 * 核心原则：**只判能被程序判的东西**。
 *
 * 判分分三级：
 *   A. numeric  数值答案 —— 完全自动，带容差与有效数字
 *   B. choice   单选/多选 —— 完全自动
 *   C. text     主观题（证明、实验设计、论述） —— **不自动判分**
 *
 * C 类不是偷懒，是诚实：程序判不了步骤对不对，
 * 硬判会把错误结果写进能力估计，比不判更糟。
 * 对 C 类我们只做两件事：给出参考答案、让学生自己勾"对/半对/错"。
 */

const NUM_RE = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g

/** 从一段文本里抽出所有数字（用于"填空里只填数字"的场景） */
export function extractNumbers(text) {
  const m = String(text ?? '').match(NUM_RE)
  return m ? m.map(Number) : []
}

/**
 * 解析学生输入为数字。
 * 认这些形式：6 / 6.0 / -3.2 / 1.5e-3 / 6m/s（带单位也能抽出 6）
 * 抽不出唯一数字就返回 null。
 */
export function parseNumber(input) {
  if (typeof input === 'number' && Number.isFinite(input)) return input
  const nums = extractNumbers(input)
  if (nums.length === 0) return null
  // 只有一个数字才算"数值题"
  if (nums.length === 1) return nums[0]
  return nums
}

/**
 * 判数值答案。
 *
 * answer 可以是：
 *   { value: 6 }
 *   { value: 6, tol: 0.01 }             绝对容差
 *   { value: 6, relTol: 0.02 }          相对容差（默认用它）
 *   { value: [6, 8] }                   多空，按顺序比
 *
 * 默认相对容差 1%，因为学生可能用 9.8 或 10 当 g，
 * 也可能把 1/3 写成 0.333。硬比字符串一定误判。
 */
export function gradeNumeric(input, answer, { defaultRelTol = 0.01 } = {}) {
  const expected = Array.isArray(answer.value) ? answer.value : [answer.value]
  let got = parseNumber(input)

  if (got === null) {
    return { correct: false, reason: '没能从你的输入里读出数字' }
  }
  const gotList = Array.isArray(got) ? got : [got]

  if (gotList.length !== expected.length) {
    return {
      correct: false,
      reason: expected.length > 1
        ? `这题要填 ${expected.length} 个空，你填了 ${gotList.length} 个`
        : `这题只要 1 个数，你填了 ${gotList.length} 个`,
    }
  }

  const details = expected.map((exp, i) => {
    const e = Number(exp)
    const g = gotList[i]
    const relTol = answer.relTol ?? defaultRelTol
    const tol = answer.tol ?? Math.abs(e) * relTol
    const diff = Math.abs(g - e)
    return { expected: e, got: g, diff, tol, ok: diff <= tol + 1e-12 }
  })

  const bad = details.find((d) => !d.ok)
  if (bad) {
    return {
      correct: false,
      reason: `期望 ${bad.expected}，你给的 ${bad.got} 差了 ${bad.diff.toPrecision(3)}（允许±${bad.tol.toPrecision(3)}）`,
      details,
    }
  }
  return { correct: true, details }
}

/** 判选择题。answer.value 是正确下标（数组）。input 是学生选的数组。 */
export function gradeChoice(input, answer) {
  const expected = (Array.isArray(answer.value) ? answer.value : [answer.value])
    .map(Number).sort((x, y) => x - y)
  const got = (Array.isArray(input) ? input : [input])
    .map(Number).sort((x, y) => x - y)

  const same = expected.length === got.length && expected.every((v, i) => v === got[i])
  return {
    correct: same,
    reason: same ? '' : `正确选项是 ${expected.map((i) => i + 1).join('、')}，你选了 ${got.map((i) => i + 1).join('、') || '空'}`,
  }
}

/**
 * 主观题：不判分，只报告"需要人看"。
 * selfGrade 由学生自己给：'full' | 'half' | 'none'
 */
export function gradeText(selfGrade) {
  if (selfGrade === 'full') return { correct: true, partial: 1, manual: true }
  if (selfGrade === 'half') return { correct: false, partial: 0.5, manual: true }
  if (selfGrade === 'none') return { correct: false, partial: 0, manual: true }
  return { correct: null, partial: null, manual: true, reason: '主观题需要你自己判定' }
}

/** 统一入口 */
export function grade(question, input, opts = {}) {
  switch (question.type) {
    case 'numeric':
      return gradeNumeric(input, question.answer, opts)
    case 'choice':
      return gradeChoice(input, question.answer)
    case 'text':
      return gradeText(input)
    default:
      throw new Error(`未知题型：${question.type}`)
  }
}
