# 考点表 schema v2（四组方法论 + 三张表）

> 文件：`tools/topics-<学科>.json`。首个实例 `tools/topics-chemistry.json`（化学 45 个考点，2026-10-22）。
> 原则：**学科是数据，不是代码。**加一门学科只加一个 JSON，不改 `core/`。

## 一、为什么按「组」而不是按学科

同一套方法论能不能跨学科用，只看三个可检验的量：**判据形状、动作序列长度、检验方式**。
三者相同 = 同一组 = 错因分布相同 = 训练动作相同。据此分四组（详见 `../../高三学习/学科-通用/笔记/方法论-跨学科统一加载框架.md`）：

| 组 | 名字 | 典型学科 | 主要错因 |
|---|---|---|---|
| A | 条件→方程→边界 | 数学、物理、化学计算、技术电路 | 条件漏读、边界忘查、单位没换 |
| B | 证据→判断 | 英语阅读、语文现代文、化学工艺流程、技术分析 | 凭印象选、扩大范围 |
| C | 触发→精确复现 | 英语词汇语法、语文默写、化学方程式与性质 | 会但写错、格式缺项 |
| D | 骨架→成文 | 语文作文、英语应用文、实验方案简答 | 要点漏、没有因果链 |

**归组单位是题型不是学科**：化学横跨 A/B/C/D 四组，物理横跨三组。所以条目挂在考点上，不挂在学科上。

## 二、文件结构

```json
{
  "schema": "openstudy.topics/2",
  "subject": "chemistry",
  "title": "高中化学",
  "source": "学科-通用/知识状态/考点索引.md（化-01…化-45）",
  "groups": {
    "A": { "label": "条件→方程→边界", "steps": ["…"], "checks": ["…"] }
  },
  "topics": {
    "C-02": {
      "alias": "化-02",
      "name": "化学用语表述正误判断…",
      "group": "C",
      "cues": ["结构简式", "核素符号", "电子排布式"],
      "state": "🔴",
      "errorType": "知识性",
      "extraChecks": ["电子空间运动状态种数=轨道数（15），不是电子数"]
    }
  }
}
```

### 字段

| 字段 | 必填 | 作用 |
|---|---|---|
| `groups.<甲>.label` | 是 | 组名，显示用 |
| `groups.<甲>.steps` | 是 | **表 2 骨架**：该组通用动作序列，按顺序执行 |
| `groups.<甲>.checks` | 是 | **表 3 骨架**：该组通用必查项 |
| `topics.<编号>.alias` | 否 | 学习库里的编号（`化-02`），两边对得上就靠它 |
| `topics.<编号>.name` | 是 | 考点名（`core/state.js:181` 会读） |
| `topics.<编号>.group` | 是 | `A`/`B`/`C`/`D` |
| `topics.<编号>.cues` | 是 | **表 1 第一步**：特征词，给导入器自动归考点用；空数组表示待填 |
| `topics.<编号>.extraSteps` | 否 | 该考点追加的动作，拼在组级 steps 后面 |
| `topics.<编号>.extraChecks` | 否 | **从真实错题里补出来的必查项**，比组级更贴人 |
| `topics.<编号>.state` | 否 | 抄自知识状态库：✅/🟡/🔴/⬜ |
| `topics.<编号>.errorType` | 否 | 知识性/方法性/审题性/计算性/未知 |
| `topics.<编号>.fillMe` | 否 | `true` = cues 还没填，等下一轮补 |

## 三、读取方式

`core/framework.js`（新增，14 项断言在 `tests/framework.js`）：

```js
import { loadForTopic, guessTopics, checksFor, groupStepsFor } from './core/framework.js'

loadForTopic(doc, 'C-13')   // { topicId, name, group:'A', groupName, cues, steps, checks, state, errorType }
guessTopics(doc, 题干文本)   // [{topicId:'C-02', score:9, hits:['结构简式',…]}]
```

- `steps` = 组级 steps + `extraSteps`
- `checks` = 组级 checks + `extraChecks`
- `guessTopics` 纯字面匹配（不做分词），命中特征词按词长加权

**兼容性**：`core/bank.js:63` 只校验 `topics[q.topic]` 存在，多余字段不影响题库加载；`core/state.js` 只读 `name`。所以本 schema 加字段是安全的。

## 四、怎么补一门新学科

1. 从 `../../高三学习/学科-通用/知识状态/考点索引.md` 抽该科全部编号与名字
2. 逐个判组（A/B/C/D），判不准就留 `null`，**不要瞎填**
3. 有真实错题的考点先写 `cues` 与 `extraChecks`（错题的坑就是最值钱的必查项），其余标 `fillMe: true`
4. 跑 `node tests/framework.js`，通过即固化

## 五、已知缺口（写在这里，别忘）

- **表 1 判据只有特征词，没有判定规则本身**（「看到哪些特征词 → 判成什么题型 → 哪些做法必错」）。规则目前只在讲义与笔记里，还没结构化
- 化学 45 个考点里 25 个 `cues` 为空，等逐题型补
- 组级 steps 是我按四组描述写的通用序列，**没有用真实错题验证过有效性**——要等出现「按这套动作做完仍然错」的样本再改
