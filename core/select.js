/**
 * select.js —— 组卷
 *
 * 组卷要回答一个问题：**从一堆题里挑 n 道，挑哪些？**
 *
 * 核心结论（来自评测理论，不是拍脑袋）：
 *   难度全部挤在一块时，测出来的分数没有信息量。
 *   - 全考简单题：谁都能考 90，分不出人
 *   - 全考难题：谁都考 20，也分不出人
 *   所以要让**难度摊开**，覆盖学生真实能力附近的一段区间。
 *
 * 具体做法：
 *   1. 算每道题在"当前能力 θ"下的预测通过率 p
 *   2. 把题按难度排序，切成 k 段（k = 题数），每段抽一道 → 天然摊匀
 *   3. 但太简单（p > 0.95）和太难（p < 0.08）的题信息量接近 0，降权
 *   4. 同考点不能超过上限，避免一张卷全在同一个知识点上
 *   5. 到期的复习考点加权
 */

import { predictPass, DEFAULT_DISCRIMINATION } from './irt.js'
import { round, splitEvenly } from './util.js'

/**
 * @param bank         题库
 * @param opts.theta   当前能力
 * @param opts.n       题数
 * @param opts.progress  学习进度（可选，来自 state.js），用来做到期加权
 * @returns { picked, meta }
 */
export function composePaper(bank, {
  theta = 0.4,
  n = 12,
  progress = null,
  a = DEFAULT_DISCRIMINATION,
  maxPerTopic = null,
  band = 0.45,          // 只在这个难度带附近抽：[θ-band, θ+band]
  rng = Math.random,
} = {}) {
  const pool = bank.questions.map((q) => {
    const p = predictPass(theta, q.difficulty, a)
    // 信息量：p(1-p) 最大在 p=0.5，两端趋近 0
    const info = p * (1 - p)

    // 到期待复习加权：该考点到期越久，抽中概率越高
    let dueBoost = 1
    if (progress) {
      const rec = progress.topics?.[q.topic]
      if (rec?.dueAt != null) {
        const overdueDays = (Date.now() - rec.dueAt) / 86400000
        if (overdueDays > 0) dueBoost = 1 + Math.min(2, overdueDays / 3)
      }
    }

    const weight = (info + 0.02) * dueBoost
    return { q, p, info, dueBoost, weight, jitter: rng() }
  })

  // 1) 先按预测通过率收紧到难度带内，带内题不够就逐步放宽
  let candidates = pool.filter((x) => {
    const d = Math.abs(x.q.difficulty - theta)
    return d <= band
  })
  let widened = false
  for (const b of [band, band * 2, 1.01]) {
    if (candidates.length >= n) break
    candidates = pool.filter((x) => Math.abs(x.q.difficulty - theta) <= b)
    widened = b !== band
  }
  if (candidates.length === 0) candidates = pool.slice()

  // 2) 按难度排序后分段，每段取一个 → 难度摊匀
  candidates.sort((x, y) => x.q.difficulty - y.q.difficulty)

  const limitPerTopic = maxPerTopic ?? Math.max(1, Math.ceil(n / 3))
  const picked = []
  const topicUse = new Map()

  // 分段：把候选切成 n 段，每段里按权重加权随机取一道
  const segments = splitEvenly(candidates, n)

  for (const seg of segments) {
    const choice = weightedPick(seg, topicUse, limitPerTopic, rng)
    if (choice) {
      picked.push(choice.q)
      topicUse.set(choice.q.topic, (topicUse.get(choice.q.topic) ?? 0) + 1)
    }
  }

  // 3) 分段不够（候选少）时，从剩下的题里按权重补齐
  if (picked.length < n) {
    const pickedIds = new Set(picked.map((q) => q.id))
    const rest = candidates
      .filter((x) => !pickedIds.has(x.q.id))
      .sort((x, y) => y.weight - x.weight)
    for (const x of rest) {
      if (picked.length >= n) break
      const used = topicUse.get(x.q.topic) ?? 0
      if (used >= limitPerTopic) continue
      picked.push(x.q)
      topicUse.set(x.q.topic, used + 1)
    }
  }

  // 4) 还是不够就放开考点上限硬补（题池太小的情况）
  if (picked.length < n) {
    const pickedIds = new Set(picked.map((q) => q.id))
    for (const x of candidates) {
      if (picked.length >= n) break
      if (pickedIds.has(x.q.id)) continue
      picked.push(x.q)
    }
  }

  // 交卷顺序再打乱一次，避免从易到难
  shuffle(picked, rng)

  const difficulties = picked.map((q) => q.difficulty)
  return {
    picked,
    meta: {
      requested: n,
      actual: picked.length,
      theta,
      widenedBand: widened,
      difficultySpread: summarize(difficulties),
      topicUse: Object.fromEntries(topicUse),
    },
  }
}


function weightedPick(seg, topicUse, limitPerTopic, rng) {
  const usable = seg.filter((x) => (topicUse.get(x.q.topic) ?? 0) < limitPerTopic)
  const list = usable.length ? usable : seg
  const total = list.reduce((s, x) => s + x.weight, 0)
  if (total <= 0) return list[0] ?? null
  let r = rng() * total
  for (const x of list) {
    r -= x.weight
    if (r <= 0) return x
  }
  return list[list.length - 1]
}

export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function summarize(nums) {
  if (!nums.length) return { min: null, max: null, mean: null }
  const sorted = [...nums].sort((x, y) => x - y)
  return {
    min: round(sorted[0]),
    max: round(sorted[sorted.length - 1]),
    mean: round(nums.reduce((s, v) => s + v, 0) / nums.length),
  }
}

