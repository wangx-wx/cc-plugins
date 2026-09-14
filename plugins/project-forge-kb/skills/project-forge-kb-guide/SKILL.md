---
name: project-forge-kb-guide
description: ProjectForgeKB（project-forge-kb）使用指南：讲清楚它最终产出什么、哪些环节必须人工介入、怎么填 docs/kb/domain-scope.yaml、语雀候选和 L1/归档文档的状态怎么改、以及为什么 L0 的 description 和内容必须人工审核。只要用户在问 project-forge-kb 的用法、想知道建库结果长什么样、domain-scope.yaml 字段怎么填、怎么找 Java 包名和文档路径、yuque_sources 怎么写、报错怎么修、候选 decision 或 L1 status 怎么改、L0 要审核什么，都应使用本 Skill 提供完整指南。用户明确要求实际执行建库或增量更新时，改用 project-forge-kb 执行。
---

# ProjectForgeKB 使用指南

五个重点，按顺序讲：**最终产出什么 → 哪些环节必须你亲自介入 → 怎么填 `domain-scope.yaml` → 文档确认与状态变更 → L0 必须人工审核**。

`<skill-dir>` 指 project-forge-kb 的 SKILL.md 所在目录。

---

# 一、最终产出什么

建完之后，仓库里会多出 `docs/kb/`。**这就是全部交付物**，除此之外不改动你的代码：

```text
docs/kb/
├── L0.md                          项目地图：服务身份（人工审核）+ 领域索引（机器生成）
├── domain-scope.yaml              你填的领域范围，唯一权威
├── L1/<领域id>/
│   ├── README.md                  领域知识：上下文、边界、术语、规则、决策
│   └── adr/<四位编号>-<描述>.md    设计决策：当初为什么这么做
├── archive/<archive_id>/          关联文档的不可变快照
│   ├── original.md                原文
│   ├── summary.md                 机器摘要
│   ├── chunks/NN.md               切块
│   └── manifest.json              来源版本与每块 hash
├── .review/<领域id>/              等你处理的东西
│   ├── yuque-candidates.yaml      语雀候选（你改 decision）
│   ├── domain-questions.md        没人能回答的问题
│   └── l1-changes.md              已确认 L1 的变更建议（你裁决）
└── .meta/                         全部机器生成，不要手改
    ├── scope-resolved.json        规范化范围与 domain_order
    ├── workflow-run.json          本轮进度（断点续跑靠它）
    ├── domains/<领域id>.json      领域机器元数据
    ├── knowledge-base.json        知识对象与关系 catalog
    └── source-state.json          增量基线
```

**三层知识的分工**：

| 层 | 文件 | 回答什么问题 |
| --- | --- | --- |
| L0 | `L0.md` | 这个服务是什么 |
| L1 | `L1/<领域>/README.md` | 这个领域是什么、边界在哪、术语什么意思、有哪些必须成立的规则 |
| ADR | `L1/<领域>/adr/*.md` | 当初为什么这么设计 |

**它不做什么**：不替你划分领域、不替你决定哪篇文档该收、不把 AI 的推测写成结论、不覆盖你已经确认过的内容。

一句话：**它负责查证据、追问、写文件、校验；你负责判断业务真相。**

---

# 二、人工介入点有哪些

这是全流程你要动手的**全部**地方。三类参与含义不同，别混：

- **介入** = 流程停下来等你
- **确认** = 对事实或选择表示认可，才能继续
- **审核** = 检查产物内容对不对，可以要求返工

| # | 什么时候 | 你要做什么 | 属于 | 不做会怎样 |
| --- | --- | --- | --- | --- |
| 1 | 首次启动后 | 填写 `domain-scope.yaml` | 介入 + 确认 | **流程停住** |
| 2 | 只有 keywords 时 | 从列表里选语雀知识库 | 介入 + 确认 | **流程停住** |
| 3 | 每个领域 | 把候选 `decision` 改成 approved / rejected | 介入 + 确认 | 有 pending 就**停住** |
| 4 | 每个领域 | 回答 Agent 的追问 | 介入 | 问题没答完**不结束** |
| 5 | 每个领域 | 审核 L1 内容、ADR | 审核 | 不阻塞，但知识质量没保证 |
| 6 | 每个领域 | 确认该领域 | 确认 + 审核 | **不进下一个领域** |
| 7 | 收尾 | **review L0 的 description 和内容** | 审核 + 确认 | **不能算完成** |
| 8 | 收尾 | 检查 verify 结果和报告 | 审核 | 有 error 必须修 |
| 9 | 增量运行 | 裁决 `l1-changes.md` | 审核 | 已确认知识不会自动更新 |

**不需要你做的**：派子代理查代码、查归档、切块、生成摘要、跑索引和校验——全部由 Agent 和脚本完成。

**绝对不能做的事**：

| 别做 | 为什么 |
| --- | --- |
| 手改 `.meta/*.json` | 脚本生成，下轮就被覆盖 |
| 手改 `archive/` 里的文件 | 归档是不可变快照 |
| 手改 `scripts/` 下的脚本 | 是构建产物，重新构建会被清空 |
| 让 Agent 帮你改 `domain-scope.yaml` | 领域划分是业务判断，必须人负责 |
| 让 Agent 帮你决定候选去留 | 文档该不该收是业务判断 |
| 为了"看起来完整"而批准不相关的候选 | 污染知识库 |

---

# 三、填写 domain-scope.yaml（重点）

**这是唯一一个必须由人从头写的文件**，路径固定在 `docs/kb/domain-scope.yaml`。它回答三个问题：有哪些领域、每个领域管哪些代码、每个领域要收哪些文档。

**为什么必须人工填**：领域怎么分、代码归谁管，是业务判断。脚本和 Agent 不会替你决定，也不会在你填完后偷偷改它。

## 3.1 字段总表

顶层只有两个字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schema_version` | ✅ | 固定写 `1` |
| `domains` | ✅ | 领域列表，至少一个 |

每个领域的字段：

| 字段 | 必填 | 填什么 | 示例 |
| --- | --- | --- | --- |
| `id` | ✅ | 领域唯一标识，**只能小写字母/数字/`_`/`-`** | `payment` |
| `name` | 建议填 | 中文名，显示在知识库里。**省略时默认等于 `id`** | `支付` |
| `status` | 可选 | `active` 本轮处理；`inactive` 保留配置但不处理。**不写默认 `active`** | `active` |
| `include_packages` | ⚠️二选一 | Java 包名，**递归包含子包** | `com.example.payment` |
| `include_files` | ⚠️二选一 | 具体文件路径，用于非 Java 项目或补漏 | `src/device/service.js` |
| `exclude_packages` | 可选 | 要排除的包（递归） | `com.example.payment.legacy` |
| `exclude_files` | 可选 | 要排除的文件 | `src/legacy/Old.java` |
| `keywords` | 可选 | 检索语雀用的关键词，也用于代码召回 | `支付`、`PaymentOrder` |
| `project_docs` | 可选 | 仓库内文档路径，**路径必须真实存在** | `docs/payment/payment-design.md` |
| `yuque_sources` | 可选 | 语雀来源，每项填 `base_slug` 或 `document_url` 之一 | 见 3.4 |

⚠️ **`include_packages` 和 `include_files` 至少要填一个**，两个都空会报错。

**数组写法**：非空数组用逐行 `- 值`。可选数组没有内容时，`[]`、只留空键、整行省略三种写法等价，都会规范化为 `[]`。

## 3.2 怎么找到该填的值

不知道包名是什么？在仓库根目录跑这几条命令。

**① 看仓库有哪些顶层模块**

```bash
git ls-files | cut -d/ -f1 | sort -u
```

```text
payment-api
refund-api
common
docs
```

**② 找出所有 Java 包名**

```bash
git ls-files '*.java' \
  | sed 's|/src/main/java/|@|' \
  | awk -F@ 'NF>1 { n=split($2,a,"/"); p=""; for(i=1;i<n;i++) p=(p==""?"":p".")a[i]; print p }' \
  | sort -u
```

```text
com.example.payment
com.example.payment.legacy
com.example.refund
```

`com.example.payment` 就可以作为支付领域的 `include_packages`。注意 `com.example.payment.legacy` 是它的子包，**会被自动包含**；如果不想收，写进 `exclude_packages`。

**③ 找非 Java 项目的文件**

```bash
git ls-files | grep -E '^(src|app|lib)/' | head -30
```

**④ 找可归档的项目文档**

```bash
git ls-files '*.md' | grep -v '^docs/kb/'
```

```text
docs/payment/payment-design.md
docs/refund/refund-design.md
```

## 3.3 完整可用示例

假设仓库有 `payment-api` 和 `refund-api` 两个模块，各有设计文档：

```yaml
schema_version: 1

domains:
  - id: payment
    name: 支付
    status: active
    include_packages:
      - com.example.payment
    include_files: []
    exclude_packages: []
    exclude_files: []
    keywords:
      - 支付
      - PaymentOrder
    project_docs:
      - docs/payment/payment-design.md
    yuque_sources: []

  - id: refund
    name: 退款
    status: active
    include_packages:
      - com.example.refund
    include_files: []
    exclude_packages: []
    exclude_files: []
    keywords:
      - 退款
    project_docs:
      - docs/refund/refund-design.md
    yuque_sources: []
```

**省事的等价写法**（可选空字段省略；`status` 不写默认 `active`；这份已实测通过校验）：

```yaml
schema_version: 1

domains:
  - id: payment
    name: 支付
    include_packages:
      - com.example.payment
    keywords:
      - 支付
    project_docs:
      - docs/payment/payment-design.md

  - id: refund
    name: 退款
    include_packages:
      - com.example.refund
    keywords:
      - 退款
    project_docs:
      - docs/refund/refund-design.md
```

**领域顺序就是处理顺序**：想先做哪个领域，就把它写在前面。

## 3.4 yuque_sources 怎么写

每一项**只能填 `base_slug` 或 `document_url` 中的一个**。三种情况：

**情况 A：只知道文档大概在哪个知识库里**——用 `base_slug`，它会拿 `keywords` 去这个知识库搜索，生成候选让你挑。

```yaml
    keywords:
      - 支付
      - 退款
    yuque_sources:
      - base_slug: hpf27k
```

- `base_slug` 从哪来？跑 `node <skill-dir>/scripts/yuque-books.js`，它列出所有知识库的 `name` 和 `slug`。**不要猜。**
- **填了 `base_slug` 就必须填 `keywords`**，否则报错。

**情况 B：已经知道确切是哪一篇**——用 `document_url`，直接进候选清单等你确认。

```yaml
    yuque_sources:
      - document_url: https://www.yuque.com/example/payment/refund
```

**情况 C：完全没有语雀文档**——`keywords: []` 且整行省略 `yuque_sources`，跳过语雀环节。

> ⚠️ 只要 `keywords` **非空**，语雀环节就不会被跳过。如果又没配 `yuque_sources`，Agent 会先问你用哪个知识库（这就是人工介入点 #2）。

## 3.5 校验与报错对照表

填完从目标仓库根目录运行：

```bash
node <skill-dir>/scripts/scope-check.js
```

通过时长这样，`domain_order` 就是处理顺序：

```json
{
  "action": "validated",
  "domain_order": ["payment", "refund"],
  "warnings": []
}
```

输出 `"action": "invalid"` 时看 `errors` 数组。**以下都是实测的原文报错**：

| 报错 | 原因 | 怎么改 |
| --- | --- | --- |
| `domains 必须由人工填写且至少包含一个领域` | `domains: []` 是空骨架 | 至少写一个领域 |
| `domains[0].id 必须使用小写字母、数字、_ 或 -` | id 写成 `Payment` 或含中文 | 改成 `payment` |
| `领域 id 重复: payment` | 两个领域 id 一样 | 改成唯一 id |
| `domains[0] 至少填写 include_packages 或 include_files` | 两个范围都没填 | 至少填一个 |
| `domains[0].include_files 未找到: src/nope.java` | 文件路径写错或不存在 | 用 `git ls-files \| grep xxx` 核对 |
| `domains[0].project_docs 未找到: docs/missing.md` | 文档路径不存在 | 用 `git ls-files '*.md'` 核对 |
| `domains[0].include_files 必须是仓库内的相对路径: ../outside.md` | 写了仓库外路径 | 只能填仓库内相对路径 |
| `domains[0].status 必须是 active 或 inactive` | status 拼错，比如 `enabled` | 改成 `active` 或 `inactive` |
| `domains[0].yuque_sources[0] 必须且只能填写 base_slug 或 document_url` | 两个都填了，或都没填 | 只留一个 |
| `domains[0] 配置 base_slug 时必须填写 keywords` | 用了 `base_slug` 但 `keywords` 为空 | 补上关键词 |
| `schema_version 必须为 1` | 版本号写错 | 改成 `1` |

**warning 不用慌**（不影响继续）：

| 警告 | 含义 | 要不要处理 |
| --- | --- | --- |
| `domains[0] 包范围未匹配已跟踪文件: com.example.xxx` | 包名在仓库里找不到对应文件 | 检查是否拼错；确实没有就删掉 |

## 3.6 填完的检查清单

- [ ] `schema_version: 1`
- [ ] 每个领域的 `id` 唯一、全小写
- [ ] 每个领域至少填了 `include_packages` 或 `include_files`
- [ ] `project_docs` 里每个路径都真实存在
- [ ] 用了 `base_slug` 的领域都填了 `keywords`
- [ ] 每个 `yuque_sources` 项只填了一个字段
- [ ] 领域顺序就是你想处理它们的顺序
- [ ] 跑 `scope-check.js` 输出 `"action": "validated"`

---

# 四、文档确认与状态变更（重点）

有两个状态字段需要你动手改，作用完全不同：**`decision` 管文档收不收，`status` 管知识算不算数。**

## 4.1 语雀候选：改 `decision`

Agent 检索完会给你 `docs/kb/.review/<领域id>/yuque-candidates.yaml`：

```yaml
candidates:
  - title: 支付退款流程说明
    document_url: https://www.yuque.com/example/payment/refund
    matched_keywords:
      - 支付
      - 退款
    decision: pending
  - title: 2024 年团建照片
    document_url: https://www.yuque.com/example/hr/photo
    decision: pending
```

**你要做的**：把 `decision` 从 `pending` 改成 `approved`（收）或 `rejected`（不收）：

```yaml
  - title: 支付退款流程说明
    decision: approved      # ← 收
  - title: 2024 年团建照片
    decision: rejected      # ← 不收
```

规则：

- **只改 `decision` 这一行**，标题、URL、关键词都不要动
- 只要还有一项是 `pending`，流程就停住等你
- 标 `rejected` 的文档**不会被下载**
- 改错了想重来：重新跑候选生成，**你已经做的决定会被保留**
- 候选是关键词机械召回的结果，**出现不相关的文档很正常**，标 `rejected` 就行，不影响任何东西

改完 Agent 会跑 `yuque-selection.js` 校验，仍有 `pending` 就继续等。

## 4.2 项目文档：没有 decision，但要保证已提交

`project_docs` 里的仓库内文档不需要你标 decision——写了就会归档。但有个硬前提：

**项目文档必须已 commit 且没有未提交修改**，否则拒绝归档（脚本要靠 commit 记录追溯版本）。有改动先 `git add` + `git commit`。

## 4.3 L1 领域文档：`status` 六态

L1 的 frontmatter 有 `status`，这是**你判断知识算不算数**的开关：

| status | 含义 | Agent 能否直接改写 |
| --- | --- | --- |
| `draft` | 草稿，未确认 | ✅ 能 |
| `candidate` | 候选，未确认 | ✅ 能 |
| `confirmed` | **你已确认**的领域知识 | ❌ 不能 |
| `review_required` | 有明确的待复核判断 | ❌ 不能 |
| `stale` | **你判定**依据已失效 | ❌ 不能 |
| `retired` | **你判定**已退役 | ❌ 不能 |

流转方式：

```text
Agent 生成  →  draft  →  【你说"这个领域可以了"】  →  confirmed
                 ↑                                      │
                 └──── 你手改成 draft/candidate ────────┘
                        （想让 Agent 继续完善时）
```

- **确认领域时**：你说"这个领域可以了"，Agent 跑 `workflow.js --confirm-domain <领域id>`，脚本先做结构检查（ADR 位置、文件名编号、`doc_id` 是否匹配），通过后把 `status` 置为 `confirmed`。
- **你自己改文件**：任何状态都能直接改，你是最终作者。但改完想让 Agent 接着完善，**必须把 `status` 改成 `draft` 或 `candidate`**，否则它只会提变更建议、不动手。
- **后四态为什么不让 Agent 改**：`confirmed` / `review_required` / `stale` / `retired` 承载的是**人的判断**——就地覆盖会丢掉这个判断，而且无法从代码或后续调查重建。Agent 发现需要变化时，会把差异写进 `.review/<领域id>/l1-changes.md`，保留原文交你裁决。

> 「这个领域可以了」是**你的话**，Agent 不会替你确认。当前领域不确认，流程不进入下一个领域。

## 4.4 归档资料的状态（现行 / 历史）

L1 README 的「归档资料」表会列出关联归档，状态是 `现行` 或 `历史`：

| 情况 | 行为 |
| --- | --- |
| 来源没变 | 跳过，复用现有归档 |
| 来源变了 | **新建**快照，旧快照保留为**历史** |

归档由脚本维护，**你不要手改 `archive/` 里的文件**——它是不可变快照，改了会破坏一致性校验。

---

# 五、L0 必须人工审核（重点）

所有领域确认完后，Agent 会起草 `docs/kb/L0.md`。**这一节是整个知识库的门面，必须你亲自过目。**

## L0 长这样

```markdown
---
id: <项目标识>
layer: L0
title: <项目名称>
description: <一句话服务身份>
---

# <项目名称>

## 服务身份

<说明本项目在系统中提供的核心业务价值。>

<!-- kb-index:start -->
<!-- 以下领域知识索引由 index.js 生成。 -->
<!-- kb-index:end -->
```

## 你要审核的三处

**① `description`（frontmatter 里的一句话服务身份）**

这是整个知识库最常被引用的一句话。`verify.js` 校验时把 `id`、`layer`、`title`、`description` 全部列为**必填**。检查它是否准确概括了这个服务在系统中提供的核心业务价值——如果这句话是错的，后面所有领域知识都会被误读。

**② `## 服务身份` 正文**

同样是人工判断。Agent 是派仓库级子代理调查后起草的，**它写的是证据推断，不一定是你认同的定位**。用你自己的话改准。

**③ `<!-- kb-index:start -->` 和 `<!-- kb-index:end -->` 之间**

**不要手改**。这是脚本生成的索引区，每次 `index.js` 都会重建，手改会被覆盖。你要审核的是**它索引出来的领域列表对不对**（有没有漏、有没有多）。

## 审核完的收尾

```bash
node <skill-dir>/scripts/index.js     # 重建 L0 索引区 + 生成 catalog
node <skill-dir>/scripts/state.js     # 写增量基线
node <skill-dir>/scripts/verify.js    # 全库完整性校验
```

`verify.js` 的 `errors` **必须是空的**：

```json
{
  "action": "verified",
  "errors": [],
  "warnings": [],
  "summary": { "error_count": 0, "warning_count": 0 }
}
```

`verify.js` 会检查 L0 的必填字段、`kb-index` 标记是否成对且顺序正确、以及**是否还有没替换的模板占位符**（比如 `<项目名称>`、`<一句话服务身份>` 这种尖括号）。有 error 就修完重跑。

**什么算完成**：没有 `pending` 的语雀候选、没有脚本执行失败、没有未替换的占位符。任何一个存在都不算完成。

---

# 六、逐领域流程（你只需要知道自己在哪一步）

```text
Agent 派子代理查代码（你等）
   ↓
Agent 生成 L1 草稿（status: draft）
   ↓
Agent 检索语雀候选 ──→ 【介入点 3：改 decision】
   ↓
Agent 归档文档（你等）
   ↓
Agent 派子代理查归档（你等）
   ↓
Agent 追问你 ──→ 【介入点 4：答术语含义、设计原因】
   ↓
Agent 写 L1 + ADR
   ↓
【介入点 5：审核 L1 和 ADR】
   ↓
【介入点 6：确认领域 → status 变 confirmed】
   ↓
进入下一个领域 …… 全部完成后走第五节 L0 审核
```

**回答追问的方式**：Agent 会把证据组织成"设计树"，一轮一轮地问：

```md
❓ Q1 - "对账"在本领域指什么？

当前证据：代码里 ReconciliationService 同时出现在支付和结算两处……

➡️ 推荐答案：指支付成功后与渠道账单的逐笔核对，不包括资金归集。
```

**直接说人话就行**，比如"推荐答案对，但不包括退款对账"。

- 一次问一批，答完它重算问题树，再问下一批
- **问题数量不设上限**，问到问清楚为止。这是设计如此，不是卡住了
- 它不会问你能自己查到的事
- **确实没人知道答案的问题**会记进 `domain-questions.md` 然后继续，不阻塞整个领域

**审核 L1 时看什么**：

| 看哪节 | 检查什么 | 常见毛病 |
| --- | --- | --- |
| 领域上下文 | 说清了"这个领域为什么存在"吗 | 写成代码结构说明 |
| 领域边界 | "不负责"一节有没有内容 | 空着 |
| 术语 | 是不是**业务定义** | 抄了类名、字段清单 |
| 已确认规则与不变量 | 是不是**你确认过的** | 混进了 Agent 的推测 |
| 设计与决策 | ADR 链接点得开吗 | 链接失效 |

**审核 ADR 时看什么**：`L1/<领域id>/adr/NNNN-*.md`。"为什么这样设计"必须是**真人说过的原因**（不是推测）；"其他考虑"要有真实替代方案；取代旧决定时要链接旧 ADR。如果某个 ADR 记的其实是普通实现细节或只是 AI 猜的原因，**要求删掉**。

---

# 七、开始之前 & 增量更新

## 开始之前

| 需要什么 | 怎么确认 |
| --- | --- |
| 目标仓库 | 已 `git init` 且至少有一次提交 |
| Node.js ≥ 18 | `node -v` |
| 宿主支持子代理 | Agent 能"派一个子任务去调查代码" |
| MCP 服务可达 | 用于语雀检索和文档摘要。不用语雀也能建库 |

**先想清楚两件事**：

1. **这个仓库能分成哪几个领域？** 领域是**业务上独立的职责单元**，比如"支付""退款""结算"。判断标准：要跟新人讲清楚一块业务，你会把它单独讲成一章，那它就是一个领域。**不要按技术分层（controller / service / dao）划分**——那不是领域。
2. **有没有现成的文档？** 仓库内设计文档、语雀上的方案，都能收进来当佐证，但要你逐篇确认。

**耗时估算**（3 个领域的中型项目）：填 `domain-scope.yaml` 30–60 分钟；每领域确认语雀候选 10–20 分钟；**每领域回答追问 30–90 分钟（最耗时）**；每领域确认产物 10–20 分钟；收尾 review 10 分钟。

追问环节花时间是因为它要把"为什么不这样做""这个词准确指什么"问清楚。这是知识库价值的来源，不是流程拖沓。

## 增量更新

知识库建好后，代码或文档变了，再触发一次 Skill 即可：

| 情况 | 行为 |
| --- | --- |
| 领域划分配置变了 | 所有 `active` 领域重跑 |
| 代码变了 | 只重跑受影响的领域（按 `git diff` 判断） |
| 语雀文档更新了 | 配了 `keywords` 或 `yuque_sources` 的领域会重新检索 |
| 来源没变 | 跳过，复用现有归档 |
| 来源变了 | 新建归档快照，**旧快照保留** |
| 该领域代码没变、也没新归档 | **直接跳过**，表示没东西要写 |

**两个前提**：

1. **开始前工作区要干净**——先 `git commit` 或 `git stash`
2. 已确认的 L1 **不会被自动改写**：新证据和已确认内容冲突时，Agent 把差异写进 `.review/<领域id>/l1-changes.md`，等你在"人工决策"一节逐条裁决（介入点 #9）

---

# 八、快速答疑

| 问题 | 答案 |
| --- | --- |
| 中途退出要重头来吗 | 不用。进度在 `.meta/workflow-run.json`，再触发一次从断点继续 |
| 不确定怎么分领域 | 先按"业务上独立的职责单元"草草分几个，跑起来看效果，随时能改 |
| 领域能随时增删吗 | 能。改 `domain-scope.yaml` 后重跑 `scope-check.js` |
| 为什么反复追问同一个领域 | 轮数不设上限是刻意设计，**目标是问清楚，不是少问** |
| 说某领域"直接跳过"是出错吗 | 不是。增量的正常行为：该领域没东西要写 |
| 候选里有无关文档 | 正常，机械召回允许误召回。标 `rejected` |
| 能直接编辑 L1 吗 | 能，任何状态都能改。但想让 Agent 接着完善，`status` 要设成 `draft`/`candidate`（见 4.3） |
| MCP 挂了怎么办 | 流程停下报错，不会造假。修好再重跑；不用语雀就清空 `keywords` 和 `yuque_sources` |
| `domain-questions.md` 会阻塞吗 | 不会。记录在案，不进 L1，不影响其他知识生成 |

更完整的问答见 [`USAGE.md`](../project-forge-kb/USAGE.md) 第 9 节。

---

# 需要更多细节时

指南覆盖了使用层面。原始定义在下述文件里，用户问到细节时读它们，不要凭记忆答：

| 想看什么 | 读 |
| --- | --- |
| 范围字段与校验边界的权威定义 | [`references/domain-scope.md`](../project-forge-kb/references/domain-scope.md) |
| 逐领域操作指南 | [`references/domain-workflow.md`](../project-forge-kb/references/domain-workflow.md) |
| 归档机制与来源版本判断 | [`references/archive-workflow.md`](../project-forge-kb/references/archive-workflow.md) |
| L1 提取规范与编辑边界 | [`references/l1-extraction.md`](../project-forge-kb/references/l1-extraction.md) |
| 领域建模访谈与 ADR 准入 | [`references/domain-questioning.md`](../project-forge-kb/references/domain-questioning.md) |
| 命令清单、设计要点、运行边界 | [`README.md`](../project-forge-kb/README.md) |
| L0/L1/ADR 模板 | [`assets/`](../project-forge-kb/assets) |

用户表示想动手做了，就读 [`SKILL.md`](../project-forge-kb/SKILL.md) 执行建库流程。**不要替用户改 `domain-scope.yaml`，也不要替他决定候选去留或确认领域**——那都是业务判断，必须由人负责。
