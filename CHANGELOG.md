# 更新记录

## 0.3 — 区分独立表现与重复表现

**行为变更（会影响已有状态文件）**

- `core/state.js`：新增 `seen` 字段，记录**每道题做过几次**。状态文件 `version` 从 `1` 升到 `2`。
  旧文件不需要手动改：`migrateState()` 会补上空的 `seen`，进度不丢。
- 每次作答带一个**证据权重**，直接乘在 θ 的更新步长上：

  | 情况 | 权重 |
  |---|---|
  | 第一次做这题，答对 | `1` |
  | 第二次做，答对 | `0.5` |
  | 第三次做，答对 | `1/3` |
  | 任何时候答错 | `1` |

  理由：同一道题第二次答对，可能是真会，也可能只是记住了答案。重复题答错则是"其实没学会"的硬证据，不打折。
- `core/select.js`：组卷对做过的题降权（`freshFactor = 0.3 + 0.7/(1+做过次数)`），
  同考点复习时优先抽**没做过**的新题。`meta` 新增 `pickedFresh` / `pickedRepeat`。
- `core/irt.js`：`updateThetaBatch` 支持逐题 `weight`；`trace` 里多一个 `weight` 字段。
- `finishSession` 现在真正遵守 `countsForTheta: false`（此前该字段被忽略，主观题会污染 θ）。
- `report` 新增 `scored` / `unscored` / `independence`，`topicUpdates` 新增
  `independentAsked` / `independentCorrect`。
- 网页：题卡标「新题」或「复习 · 做过 N 次」；成绩页新增「这份成绩的证据有多硬」，
  考点表新增「新题正确率」一列。
- DSH 插件：卷面标新题/复习；判分输出「新题 X/Y，重复题 Z/W」。
- `dsh/index.js` 的 `readState` 改为走 `migrateState`（此前按 `version === 1` 判断，升级后会清空进度）。

**测试**

`tests/run.js` 新增第 7 节，验证：重复答对权重递减、重复答错权重保持 1、
主观题不计入 θ、带历史记录组卷时新题占多数。

## 0.2 — 真题导入器

- 新增 `tools/import-md.js`：把 `学科-物理/资料/*.md` 的真题 Markdown 解析成题库 JSON。
- 新增 `tools/topics-physics.json`：16 个物理考点 + 关键词规则。
- `build.js` 新增 `--bank` / `--out`。
- 网页文本题交卷后补上「解析」。
- `tests/smoke.js` 支持指定构建产物路径。

## 0.1 — 初版

- 能力模型（1PL logistic）、判分三级（numeric / choice / text）、
  难度分层抽样组卷、SM-2 间隔排程。
- 单文件网页 + DSH 插件（`openstudy_paper` / `openstudy_grade` / `openstudy_status`）。
