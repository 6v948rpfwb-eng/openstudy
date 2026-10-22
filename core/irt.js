/**
 * irt.js —— 能力与难度的统一刻度
 *
 * 全部放在 [0,1] 上：
 *   b  = 题目难度（0 最简单，1 最难）
 *   θ  = 学生当前能力（0 什么都不会，1 全对）
 *
 * 预测通过率用 one-parameter logistic（1PL）：
 *
 *   p = 1 / (1 + exp(-a * (θ - b)))
 *
 * a 是"区分度"，越大曲线越陡。默认 a = 4。
 *
 * 为什么用 logistic 而不是别的：它有两个性质正好合用
 *   1) p(θ=b) = 0.5，即"能力和难度相等时五成把握"——这给了难度一个可解释的刻度
 *   2) θ 比 b 高 0.25（a=4 时）→ p = 1/(1+e^-1) = 0.731
 *      θ 比 b 低 0.25        → p = 1/(1+e^1)  = 0.269
 *   所以 0.25 的刻度差 ≈ 七成 / 三成把握，是个很好用的手感。
 */

export const DEFAULT_DISCRIMINATION = 4

/** sigmoid */
function sigmoid(x) {
  // 分两支算，避免 exp 溢出
  if (x >= 0) {
    const e = Math.exp(-x)
    return 1 / (1 + e)
  }
  const e = Math.exp(x)
  return e / (1 + e)
}

/** 预测通过率 */
export function predictPass(theta, difficulty, a = DEFAULT_DISCRIMINATION) {
  return sigmoid(a * (theta - difficulty))
}

/**
 * 答完一题后更新 θ（一次梯度上升，对数似然的导数）
 *
 *   答对  → θ 上升，上升量为 lr * (1 - p)
 *   答错  → θ 下降，下降量为 lr * p
 *
 * 直觉：p 已经很接近 1 的题答对了，说明本来就该对，几乎不动 θ；
 *       p 很低的题答对了，说明能力被低估了，θ 大幅上调。
 */
export function updateTheta(theta, difficulty, correct, { lr = 0.12, a = DEFAULT_DISCRIMINATION } = {}) {
  const p = predictPass(theta, difficulty, a)
  const next = correct ? theta + lr * (1 - p) : theta - lr * p
  return Math.min(1, Math.max(0, next))
}

/**
 * 一次答很多题后批量更新 θ。
 *
 * 每条作答可以带一个 weight（证据权重），默认 1。weight 直接乘在步长上：
 *   weight = 1    这题是新的 → 完整证据
 *   weight = 0.5  这题以前做过，这次又对了 → 只能算一半证据
 *
 * 为什么要这个：同一道题第二次答对，可能是真会，也可能只是记住了答案。
 * 两种情况的区别外部看不出来，所以只能降低这一次的证实力度，
 * 靠"换一道没做过的新题"去补回真正的信息。
 *
 * 返回 { theta, trace }，trace 是每步的 (b, correct, weight, p, thetaAfter)。
 */
export function updateThetaBatch(theta, answers, opts = {}) {
  const a = opts.a ?? DEFAULT_DISCRIMINATION
  const lr = opts.lr ?? 0.12
  let t = theta
  const trace = []
  for (const { difficulty, correct, weight = 1 } of answers) {
    const p = predictPass(t, difficulty, a)
    const step = lr * weight
    const next = correct ? t + step * (1 - p) : t - step * p
    t = Math.min(1, Math.max(0, next))
    trace.push({ difficulty, correct, weight, p, theta: t })
  }
  return { theta: t, trace }
}

/** 把 θ 翻译成人话，用于界面上显示 */
export function describeTheta(theta) {
  if (theta < 0.15) return '入门'
  if (theta < 0.30) return '基础'
  if (theta < 0.45) return '中下'
  if (theta < 0.60) return '中等'
  if (theta < 0.72) return '中上'
  if (theta < 0.85) return '较强'
  return '很强'
}
