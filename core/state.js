/**
 * state.js —— 学习状态与复习排程
 *
 * 存三样东西：
 *   1. θ：整体能力，一个数
 *   2. topics：每个考点的记录（做过几题、对几题、下次该复习的日期）
 *   3. log：每场练习的流水（用于复盘和算趋势）
 *
 * 排程用的是简化的 SM-2（间隔重复）：
 *   答对 → 间隔 = 上次间隔 × 该考点的"易度因子"
 *   答错 → 间隔归 1 天，易度因子下调
 *
 * 易度因子 EF 限制在 [1.3, 2.8]，这是 SM-2 的经典区间：
 *   EF 越大说明这个考点对你越轻松，间隔可以拉得越长。
 */

import { updateThetaBatch, describeTheta } from './irt.js'
import { clamp, round, DAY } from './util.js'

export const STATE_VERSION = 1

export function emptyState(subject) {
  return {
    version: STATE_VERSION,
    subject,
    theta: 0.35,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    topics: {},
    log: [],
  }
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
  const before = state.theta

  // 1) 更新整体能力 θ
  const { theta, trace } = updateThetaBatch(
    state.theta,
    answers.map((x) => ({ difficulty: x.question.difficulty, correct: x.correct })),
    { lr },
  )
  state.theta = theta

  // 2) 更新每个考点
  const byTopic = new Map()
  for (const a of answers) {
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
      accuracy: round(acc),
      nextDueDays: round(rec.intervalDays),
      needReview: wrongCount > 0,
    })
  }

  const totalCorrect = answers.filter((x) => x.correct).length

  // 3) 记账
  state.log.push({
    at: now,
    asked: answers.length,
    correct: totalCorrect,
    thetaBefore: round(before),
    thetaAfter: round(state.theta),
    topics: [...byTopic.keys()],
  })
  state.updatedAt = now

  const report = {
    asked: answers.length,
    correct: totalCorrect,
    accuracy: round(totalCorrect / Math.max(1, answers.length)),
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

