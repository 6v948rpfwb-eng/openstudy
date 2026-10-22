# 更新记录

## 0.6 — 题目能配图了

**新增**

- 题库支持可选的 `figure` 字段（字符串或字符串数组），页面在题干下面显示 `<img>`。
  校验器只检查类型，不检查文件是否存在（那是构建时的事）。
- `build.js --inline-figures`：构建时把图片转成 data URI 内嵌，单文件产物照样能离线用。
- `tools/import-md.js --figures <json>`：传一个 `{题目id: 图片路径}` 映射表，
  导入时自动把图挂到题上；映射表里有题库中不存在的 id 会打警告。

**说明**

图片不进仓库（`openstudy-data/` 已忽略）。真题插图是各地考试院的版权物，
和题库一样只留在本地。

## 0.5 — 公式能看了，记录能落盘了，题目能提问了

**新增**

- `core/math.js`：自带一个 LaTeX 子集的渲染器，不依赖 KaTeX。
  支持 `\frac` `\dfrac` `\sqrt[n]{}` `^` `_` `{}` `\left` `\right`
  `\mathrm` `\text`、希腊字母、常用符号、`\sin` 等函数名。
  题库里那 189 段带公式的文本，渲染后**没有残留任何反斜杠命令**。
  不认识的命令原样露出来，方便发现题库写了没支持的东西。
- `serve.js`：本地小服务器（零依赖，只用 Node 内置模块）。
  - `GET /api/health`、`GET /api/state?subject=`
  - `POST /api/sync`：写 `state-<学科>.json` + 追加 `答题记录-<学科>.jsonl`
  - `POST /api/ask`：追加 `提问队列.jsonl`
  - 存档目录由 `--store` 或环境变量 `OPENSTUDY_STORE` 指定
- 页面里每题底下多了「这题想问」：写一句话，带上题号、题干、你的作答、判分结果，
  一起进提问队列。
- `打开练习.sh` 改用 `serve.js`；本机存档路径写在 `.env.local`（已进 `.gitignore`）。

**行为**

- 交卷时把这道题的作答追加到硬盘上的 `答题记录-<学科>.jsonl`（一行一条，机器可读），
  并把整份状态写进 `state-<学科>.json`。
- 打开页面时先跟服务器对一次账：服务器上的 `log` 更长就用服务器的。
- 没有服务器（双击 HTML、或普通静态服务器）时全部静默跳过，退回 localStorage。

## 0.4 — 可以不限量地做，一题一结算

**新增**

- 题数下拉新增「**不限（做一题结算一题，随时停）**」。
  选了之后每交一题就立刻更新能力估计并存盘，题卡旁边有「结束」按钮，随时收工。
  收工时给一张小结：θ 起点 → 终点、这一轮正确率、碰到的每个考点各对几道。

**修的 bug**

- **主观题自评后没有「下一题」按钮**，会卡在一道题上出不来。现在四个按钮区行为一致。
- **网页版主观题自评会写进 θ**（注释写着不参与，代码却传了 `true`）。现在明确不计入。
  DSH 插件版一直是对的，只有网页版有这个毛病。
- 网页版 `loadState` 还按 `version === 1` 判断，状态版本升到 2 后一刷新进度就归零；
  改为交给 `migrateState` 兜底（`dsh/index.js` 早先修过同一处，web 漏了）。
- 网页版加载题库时先试 `../data/example.bank.json`，用 http 打开时会把 39 道真题换成 9 道示例题；
  改为单文件里有内联题库就直接用。

**测试**

- `tests/run.js` 新增第 8 节：连做 3 题、每次只传一条答案结算，验证每次只计入 1 道、
  θ 单调上升（0.350 → 0.382 → 0.397 → 0.406）、`seen` 记到 3 次、答错时 θ 下降。
- `tests/smoke.js` 新增：题数选「不限」后点开始，能直接出第一题且不弹 alert。

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
