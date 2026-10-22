/**
 * state.js —— 学习状态与复习排程
 *
 * 存四样东西：
 *   1. θ：整体能力，一个数
 *   2. topics：每个考点的记录（做过几题、对几题、下次该复习的日期）
 *   3. seen：**每道题做过几次**（用来区分"真会"和"记住了这题答案"）
 *   4. log：每场练习的流水（用于复盘和算趋势）
 *
 * 排程用的是简化的 SM-2（间隔重复）：
 *   答对 → 间隔 = 上次间隔 × 该考点的"易度因子"
 *   答错 → 间隔归 1 天，易度因子下调
 *
 * 易度因子 EF 限制在 [1.3, 2.8]，这是 SM-2 的经典区间：
 *   EF 越大说明这个考点对你越轻松，间隔可以拉得越长。
 *
 * ── 关于"独立表现"──
 *
 * 间隔复习会把同一道题再出一次。这时答对有两种可能：
 *   (a) 真的会了
 *   (b) 记住了这道题的答案
 * 外部看不出来。所以：
 *   - 重复题答对 → 证据打对折（见 answerWeight）
 *   - 重复题答错 → 不打折，这是"其实没学会"的硬证据
 * 想要完整的证据，只能换一道**没做过的新题**再答一次。
 */

import { updateThetaBatch, describeTheta } from './irt.js'
import { clamp, round, DAY } from './util.js'

export const STATE_VERSION = 2

export function emptyState(subject) {
  return {
    version: STATE_VERSION,
    subject,
    theta: 0.35,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    topics: {},
    seen: {},
    log: [],
  }
}

/** 老状态文件没有 seen 字段，补上即可（其余字段结构兼容） */
export function migrateState(state) {
  if (!state || typeof state !== 'object') return state
  if (!state.topics) state.topics = {}
  if (!state.seen) state.seen = {}
  if (!state.log) state.log = []
  if (state.version !== STATE_VERSION) state.version = STATE_VERSION
  return state
}

/**
 * 这道题做过几次了（在本次作答之前）。
 * 没有记录 = 0 = 第一次见。
 */
export function seenCount(state, questionId) {
  return state?.seen?.[questionId]?.times ?? 0
}

/** 这道题的作答记忆 */
function seenRecord(state, questionId) {
  if (!state.seen) state.seen = {}
  if (!state.seen[questionId]) {
    state.seen[questionId] = { times: 0, correct: 0, lastAt: null, lastCorrect: null }
  }
  return state.seen[questionId]
}

/**
 * 一次作答算多少证据。
 *
 * @param before  这次作答**之前**做过几次（0 = 新题）
 * @param correct 这次对没对
 * @returns 0..1 的权重
 *
 * 第一次做      → 1     完整证据
 * 第二次做且对  → 0.5   可能是记住了
 * 第三次做且对  → 0.333 …
 * 任何时候答错  → 1     重复题还错，说明确实没学会，不打折
 */
export function answerWeight(before, correct) {
  if (before <= 0) return 1
  if (!correct) return 1
  return 1 / (1 + before)
}

function topicRecord(state, topicId) {
  if (!state.topics[topicId]) {
    state.topics[topicId] = {
      attempts: 0,
      correct: 0,
      streak: 0,          // 连续答对次数
      ease: 2.5,          // 易度因子
      intervalDays: 0,
      dueAt: null,
      lastSeenAt: null,
    }
  }
  return state.topics[topicId]
}

/**
 * 结算一场练习。
 *
 * @param state     已有状态（会被修改并返回）
 * @param bank      题库
 * @param answers   [{ question, correct, input }]  correct 可以是 true/false
 * @returns { state, report }
 */
export function finishSession(state, bank, answers, { lr = 0.12 } = {}) {
  migrateState(state)
  const before = state.theta

  // 0) 只有 countsForTheta !== false 的题才参与能力估计
  //    （主观题自评不算；重复题按权重折算）
  const scored = answers.filter((x) => x.countsForTheta !== false)

  const weighted = scored.map((x) => {
    const before0 = seenCount(state, x.question.id)
    return {
      question: x.question,
      correct: x.correct === true,
      seenBefore: before0,
      weight: answerWeight(before0, x.correct === true),
    }
  })

  // 1) 更新整体能力 θ（按证据权重）
  const { theta, trace } = updateThetaBatch(
    state.theta,
    weighted.map((x) => ({
      difficulty: x.question.difficulty,
      correct: x.correct,
      weight: x.weight,
    })),
    { lr },
  )
  state.theta = theta

  // 2) 更新每个考点（只看计入能力的题；主观题不污染考点正确率）
  const byTopic = new Map()
  for (const a of weighted) {
    const t = a.question.topic
    if (!byTopic.has(t)) byTopic.set(t, [])
    byTopic.get(t).push(a)
  }

  const now = Date.now()
  const topicUpdates = []

  for (const [topicId, list] of byTopic) {
    const rec = topicRecord(state, topicId)
    const correctCount = list.filter((x) => x.correct).length
    const wrongCount = list.length - correctCount

    rec.attempts += list.length
    rec.correct += correctCount
    rec.lastSeenAt = now

    // 易度因子：全对上调，有错下调
    const acc = correctCount / list.length
    rec.ease = clamp(rec.ease + 0.1 * (acc - 0.5) * 2, 1.3, 2.8)

    if (wrongCount === 0) {
      rec.streak += list.length
      rec.intervalDays = rec.intervalDays === 0 ? 1 : Math.min(180, rec.intervalDays * rec.ease)
    } else {
      rec.streak = 0
      rec.intervalDays = 1
      rec.ease = clamp(rec.ease - 0.2 * wrongCount, 1.3, 2.8)
    }

    rec.dueAt = now + rec.intervalDays * DAY

    topicUpdates.push({
      topicId,
      name: bank.topics[topicId]?.name ?? topicId,
      asked: list.length,
      correct: correctCount,
      independentAsked: list.filter((x) => x.seenBefore === 0).length,
      independentCorrect: list.filter((x) => x.seenBefore === 0 && x.correct).length,
      accuracy: round(acc),
      nextDueDays: round(rec.intervalDays),
      needReview: wrongCount > 0,
    })
  }

  // 3) 记下"每道题做过几次"（在更新统计之后再写，保证下次读到的是累计值）
  for (const a of weighted) {
    const rec = seenRecord(state, a.question.id)
    rec.times += 1
    rec.correct += a.correct ? 1 : 0
    rec.lastAt = now
    rec.lastCorrect = a.correct
  }

  const totalCorrect = answers.filter((x) => x.correct).length

  // 4) 记账
  const independentAsked = weighted.filter((x) => x.seenBefore === 0).length
  const independentCorrect = weighted.filter((x) => x.seenBefore === 0 && x.correct).length
  const repeatAsked = weighted.length - independentAsked
  const repeatCorrect = weighted.filter((x) => x.seenBefore > 0 && x.correct).length

  state.log.push({
    at: now,
    asked: answers.length,
    correct: totalCorrect,
    scored: weighted.length,
    independentAsked,
    independentCorrect,
    repeatAsked,
    thetaBefore: round(before),
    thetaAfter: round(state.theta),
    topics: [...byTopic.keys()],
  })
  state.updatedAt = now

  const report = {
    asked: answers.length,
    correct: totalCorrect,
    accuracy: round(totalCorrect / Math.max(1, answers.length)),

    // 计入能力的题数（主观题不计）
    scored: weighted.length,
    unscored: answers.length - weighted.length,

    // 独立表现 vs 重复表现 —— 这两者不能混
    independence: {
      asked: weighted.length,
      independentAsked,
      independentCorrect,
      repeatAsked,
      repeatCorrect,
      discounted: weighted.filter((x) => x.weight < 1).length,
    },

    thetaBefore: round(before),
    thetaAfter: round(state.theta),
    thetaDelta: round(state.theta - before),
    level: describeTheta(state.theta),
    topicUpdates,
    needReview: topicUpdates.filter((t) => t.needReview),
    trace,
  }

  return { state, report }
}

/** 现在应该复习的考点（到期或逾期） */
export function dueTopics(state, bank, now = Date.now()) {
  const out = []
  for (const [topicId, rec] of Object.entries(state.topics ?? {})) {
    if (rec.dueAt != null && rec.dueAt <= now && bank.topics[topicId]) {
      out.push({
        topicId,
        name: bank.topics[topicId].name,
        lateDays: round((now - rec.dueAt) / 86400000),
        accuracy: round(rec.correct / Math.max(1, rec.attempts)),
      })
    }
  }
  return out.sort((a, b) => b.lateDays - a.lateDays)
}

/** 该考点的掌握度估计：用该考点历史正确率做平滑，避免"做1题全对=100%" */
export function topicMastery(rec) {
  if (!rec) return null
  // 拉普拉斯平滑：(correct + 1) / (attempts + 2)
  return round((rec.correct + 1) / (rec.attempts + 2))
}

