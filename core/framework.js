/**
 * framework.js —— 四组方法论 + 三张表的读取层
 *
 * 一条原则：**组别是数据，不是代码**。
 * 组在这里只做「查表」：给一个 topicId，返回它属于哪一组、该走什么动作序列、必查什么。
 * 想让引擎多支持一门学科，只加一个 topics-<学科>.json，不改本文件。
 *
 * 数据格式见 tools/TOPIC-SCHEMA.md。
 */

/** 组的固定顺序（A 条件→方程→边界 … D 骨架→成文） */
export const GROUP_ORDER = ['A', 'B', 'C', 'D']

export const GROUP_NAMES = {
  A: '条件→方程→边界',
  B: '证据→判断',
  C: '触发→精确复现',
  D: '骨架→成文',
}

/** 取一个 topic 记录；找不到返回 null（不抛错，调用方自己决定怎么处理） */
export function topicOf(topicsDoc, topicId) {
  return topicsDoc?.topics?.[topicId] ?? null
}

/** 该 topic 属于哪一组：优先用条目自己的 group，其次返回 null */
export function groupOf(topicsDoc, topicId) {
  const t = topicOf(topicsDoc, topicId)
  return t?.group ?? null
}

/** 组级默认动作序列（表 2 的骨架部分） */
export function groupSteps(topicsDoc, group) {
  return topicsDoc?.groups?.[group]?.steps ?? []
}

/** 组级默认必查项（表 3 的骨架部分） */
export function groupChecks(topicsDoc, group) {
  return topicsDoc?.groups?.[group]?.checks ?? []
}

/**
 * 该 topic 的完整动作序列：组级步骤 + 条目级追加步骤
 * 例：groupStepsFor(doc,'C-02') → ['先认出触发点…','按固定格式写出来…', …]
 */
export function groupStepsFor(topicsDoc, topicId) {
  const t = topicOf(topicsDoc, topicId)
  if (!t) return []
  return [...groupSteps(topicsDoc, t.group), ...(t.extraSteps ?? [])]
}

/**
 * 该 topic 的完整必查项：组级必查 + 条目级 extraChecks
 * extraChecks 是从真实错题里补出来的，比组级默认更贴人
 */
export function checksFor(topicsDoc, topicId) {
  const t = topicOf(topicsDoc, topicId)
  if (!t) return []
  return [...groupChecks(topicsDoc, t.group), ...(t.extraChecks ?? [])]
}

/**
 * 按特征词给题干猜考点（表 1 的第一步：特征词 → 题型编号）
 * 纯字面匹配，不做分词；命中的特征词越多分越高，命中长词加权。
 * 返回 [{topicId, name, score, hits}]，按分值降序；没有命中返回 []
 */
export function guessTopics(topicsDoc, text, limit = 3) {
  if (!text || !topicsDoc?.topics) return []
  const out = []
  for (const [topicId, t] of Object.entries(topicsDoc.topics)) {
    const hits = []
    let score = 0
    for (const cue of t.cues ?? []) {
      if (cue && text.includes(cue)) {
        hits.push(cue)
        score += cue.length
      }
    }
    if (score > 0) out.push({ topicId, name: t.name ?? topicId, score, hits })
  }
  out.sort((a, b) => b.score - a.score || a.topicId.localeCompare(b.topicId))
  return out.slice(0, limit)
}

/**
 * 三张表的合成视图：给定 topicId，一次拿齐「判据特征词 / 动作序列 / 必查项」
 * 表 1 的完整判据（每个题型的判定规则）还没有数据源，这里只给特征词
 */
export function loadForTopic(topicsDoc, topicId) {
  const t = topicOf(topicsDoc, topicId)
  if (!t) return null
  return {
    topicId,
    name: t.name ?? topicId,
    group: t.group ?? null,
    groupName: GROUP_NAMES[t.group] ?? null,
    cues: t.cues ?? [],
    steps: groupStepsFor(topicsDoc, topicId),
    checks: checksFor(topicsDoc, topicId),
    state: t.state ?? null,
    errorType: t.errorType ?? null,
  }
}
