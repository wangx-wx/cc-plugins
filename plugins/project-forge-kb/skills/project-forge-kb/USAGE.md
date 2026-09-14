# ProjectForgeKB 使用指南

这份文档教你从零开始，用 ProjectForgeKB 给一个代码仓库建起领域知识库，以及建完之后怎么更新它。

不需要懂脚本原理。你只需要：会填一个 YAML 配置、会回答 Agent 的提问、会看它写出来的 Markdown。

---

## 目录

1. [这个 Skill 到底帮你做什么](#1-这个-skill-到底帮你做什么)
2. [开始之前](#2-开始之前)
3. [第一次使用：完整走一遍](#3-第一次使用完整走一遍)
4. [手把手填写 domain-scope.yaml](#4-手把手填写-domain-scopeyaml)
5. [逐领域建设：你会经历什么](#5-逐领域建设你会经历什么)
6. [收尾](#6-收尾)
7. [人工参与点总表](#7-人工参与点总表)
8. [更新知识库（增量运行）](#8-更新知识库增量运行)
9. [常见问题](#9-常见问题)

---

## 1. 这个 Skill 到底帮你做什么

**问题**：代码里有类、方法、调用关系，但"这个领域为什么存在""某个词到底指什么""当初为什么这么设计"这些知识只存在人脑里。新人看不懂，AI 更看不懂——它会靠猜，然后猜错。

**它做的事**：让 Agent 带着证据来问你，把你的回答固化成三层可追溯的知识，并保证**任何没被你确认过的东西都不会写成正式知识**。

**它交付的东西**：

```text
docs/kb/
├── L0.md                 项目地图：这个服务是什么
├── L1/<领域>/README.md   领域知识：术语、规则、边界
├── L1/<领域>/adr/*.md    设计决策：当初为什么这么做
└── archive/*/            关联文档的不可变快照
```

**它不做什么**：

- 不替你划分领域（那是业务判断）
- 不替你决定哪篇文档该收进来
- 不把 AI 的推测写成结论
- 不覆盖你已经确认过的内容

一句话：**它负责查证据、追问、写文件、校验；你负责判断业务真相。**

---

## 2. 开始之前

### 2.1 检查环境

| 需要什么 | 怎么确认 |
| --- | --- |
| 目标仓库 | 已 `git init` 且至少有一次提交（脚本要读 commit 记录） |
| Node.js ≥ 18 | `node -v` |
| 宿主支持子代理 | 就是 Agent 能"派一个子任务去调查代码"。不支持的话它第一步就会告诉你环境不满足 |
| MCP 服务可达 | 用于语雀检索和文档摘要。用不到语雀也能建库，只是不能收语雀文档 |

### 2.2 心里先想清楚两件事

**第一件：这个仓库能分成哪几个领域？**

领域指的是**业务上独立的职责单元**，比如"支付""退款""结算""设备管理"。判断标准是：如果你要跟一个新人讲清楚一块业务，你会把它单独讲成一章，那它就是一个领域。

不要按技术分层（controller / service / dao）划分——那不是领域。

**第二件：有没有现成的文档？**

- **项目内文档**：仓库里的设计文档，比如 `docs/payment/支付设计.md`
- **语雀文档**：团队写在语雀上的方案、接口说明

这些可以收进知识库作为佐证，但**需要你逐篇确认要不要收**。

### 2.3 你大概要花多少时间

以 3 个领域的中型项目估算：

| 环节 | 耗时 |
| --- | --- |
| 填写 `domain-scope.yaml` | 30–60 分钟（首次） |
| 每个领域：确认语雀候选 | 10–20 分钟 |
| 每个领域：回答 Agent 追问 | **30–90 分钟（最耗时）** |
| 每个领域：确认知识产物 | 10–20 分钟 |
| 收尾 review | 10 分钟 |

> 追问环节花时间是因为它要把"为什么不这样做""这个词准确指什么"问清楚。这是知识库价值的来源，不是流程拖沓。

---

## 3. 第一次使用：完整走一遍

### 第 1 步：启动 Skill


```
/project-forge-kb 为当前仓库初始化领域知识库
```

Agent 会先检查有没有 `docs/kb/domain-scope.yaml`，然后：

- **没有** → 创建一个空骨架，展示字段说明和示例，然后**停下来等你填**
- **有** → 校验配置，进入逐领域建设

### 第 2 步：填写 `domain-scope.yaml`

这是**唯一一个必须由人从头写的文件**。详细教程见[第 4 节](#4-手把手填写-domain-scopeyaml)。

### 第 3 步：校验配置

填完后让 Agent 继续，它会执行：

```bash
node <skill-dir>/scripts/scope-check.js
```

看到这样的输出就是通过了：

```json
{
  "action": "validated",
  "domain_order": ["payment", "refund"],
  "warnings": []
}
```

**注意 `domain_order`**：这个顺序就是处理顺序，等于你在 YAML 里写 `domains` 的顺序。想先做哪个领域，就把它写在前面。

如果输出 `"action": "invalid"`，看 `errors` 数组，对照[第 4.6 节](#46-报错对照表)修改。

### 第 4 步：逐领域建设

Agent 会**一次只处理一个领域**。每个领域你会经历：

```text
Agent 派子代理查代码
   ↓
Agent 生成 L1 草稿
   ↓
Agent 检索语雀候选 ──→ 【你做：把 decision 改成 approved / rejected】
   ↓
Agent 归档文档
   ↓
Agent 派子代理查归档
   ↓
Agent 追问你 ──→ 【你答：术语含义、设计原因】
   ↓
Agent 写 L1 + ADR
   ↓
【你确认：这个领域的知识对不对】
   ↓
进入下一个领域
```

凡是你需要动手的环节，Agent 都会停下来等你。详见[第 5 节](#5-逐领域建设你会经历什么)。

### 第 5 步：收尾

所有领域确认完后：

```text
Agent 起草 L0 的"服务身份"
   ↓
【你 review：这个描述准确吗】
   ↓
脚本生成索引、基线，并做完整性校验
   ↓
完成
```

---

## 4. 手把手填写 domain-scope.yaml

### 4.1 这个文件是什么

路径固定在 `docs/kb/domain-scope.yaml`。它回答三个问题：

1. **这个仓库有哪些领域？**（`domains`）
2. **每个领域管哪些代码？**（`include_*` / `exclude_*`）
3. **每个领域要收哪些文档？**（`project_docs` / `yuque_sources` / `keywords`）

**为什么必须人工填**：领域怎么分、代码归谁管，是业务判断。脚本和 Agent 不会替你决定，也不会在你填完后偷偷改它。

### 4.2 完整字段说明

顶层就两个字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `schema_version` | ✅ | 固定写 `1` |
| `domains` | ✅ | 领域列表，至少一个 |

每个领域有这些字段：

| 字段 | 必填 | 填什么 | 示例 |
| --- | --- | --- | --- |
| `id` | ✅ | 领域唯一标识，**只能小写字母/数字/`_`/`-`** | `payment` |
| `name` | 建议填 | 中文名，会显示在知识库里 | `支付` |
| `status` | 建议填 | `active` 本轮处理；`inactive` 保留配置但不处理。默认 `active` | `active` |
| `include_packages` | ⚠️二选一 | Java 包名，**递归包含子包** | `com.example.payment` |
| `include_files` | ⚠️二选一 | 具体文件路径，用于非 Java 项目或补漏 | `src/device/service.js` |
| `exclude_packages` | 可选 | 要排除的包（递归） | `com.example.payment.legacy` |
| `exclude_files` | 可选 | 要排除的文件 | `.../RefundLegacyService.java` |
| `keywords` | 可选 | 检索语雀用的关键词，也用于代码召回 | `支付`、`PaymentOrder` |
| `project_docs` | 可选 | 仓库内文档路径，**路径必须真实存在** | `docs/payment/payment-design.md` |
| `yuque_sources` | 可选 | 语雀来源，每项填 `base_slug` 或 `document_url` 之一 | 见 4.5 |

⚠️ **`include_packages` 和 `include_files` 至少要填一个**，两个都空会报错。

### 4.3 从零开始：怎么找到该填的值

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

这里 `com.example.payment` 就可以作为支付领域的 `include_packages`。注意 `com.example.payment.legacy` 是它的子包，**会被自动包含**；如果不想收，就写进 `exclude_packages`。

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

### 4.4 一个完整可用的例子

假设仓库有 `payment-api` 和 `refund-api` 两个模块，各有设计文档。把下面内容写进 `docs/kb/domain-scope.yaml`：

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

这个配置已经用 `scope-check.js` 实测通过。

**省事的写法**：可选的空字段可以写 `[]`、只留空键、或者整行省略，三种都行。下面这段和上面等价：

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

`status` 不写默认就是 `active`；`include_files`、`exclude_*`、`yuque_sources` 不写默认就是空。

### 4.5 语雀来源怎么填

`yuque_sources` 每一项**只能填 `base_slug` 或 `document_url` 中的一个**。

**情况 A：只知道文档大概在哪个知识库里**

```yaml
    keywords:
      - 支付
      - 退款
    yuque_sources:
      - base_slug: hpf27k
```

它会拿 `keywords` 去这个知识库里搜索，生成候选让你挑。

- `base_slug` 从哪来？让 Agent 跑 `yuque-books.js`，它会列出所有知识库的 `name` 和 `slug`。**不要猜。**
- **填了 `base_slug` 就必须填 `keywords`**，否则报错。

**情况 B：已经知道确切是哪一篇**

```yaml
    yuque_sources:
      - document_url: https://www.yuque.com/example/payment/refund
```

这篇会直接进候选清单，等你确认。

**情况 C：完全没有语雀文档**

```yaml
    keywords: []
    # yuque_sources 整行省略
```

`keywords` 和 `yuque_sources` 都空，就跳过语雀环节。

> ⚠️ 只要 `keywords` **非空**，语雀环节就不会被跳过——如果又没配 `yuque_sources`，Agent 会先问你用哪个知识库。

### 4.6 报错对照表

填完跑 `scope-check.js`，出现 `"action": "invalid"` 时对照下表。以下都是实测的原文报错：

| 报错 | 原因 | 怎么改 |
| --- | --- | --- |
| `domains 必须由人工填写且至少包含一个领域` | `domains: []` 是空骨架 | 至少写一个领域 |
| `domains[0].id 必须使用小写字母、数字、_ 或 -` | id 写成 `Payment` 或含中文 | 改成 `payment` |
| `领域 id 重复: payment` | 两个领域 id 一样 | 改成唯一 id |
| `domains[0] 至少填写 include_packages 或 include_files` | 两个范围都没填 | 至少填一个 |
| `domains[0].include_files 未找到: xxx` | 文件路径写错或文件不存在 | 用 `git ls-files \| grep xxx` 核对真实路径 |
| `domains[0].project_docs 未找到: docs/missing.md` | 文档路径不存在 | 核对路径；不确定就先用 `git ls-files '*.md'` 查 |
| `domains[0].include_files 必须是仓库内的相对路径: ../outside.md` | 写了仓库外的路径 | 只能填仓库内相对路径 |
| `domains[0].status 必须是 active 或 inactive` | status 拼错，比如 `enabled` | 改成 `active` 或 `inactive` |
| `domains[0].yuque_sources[0] 必须且只能填写 base_slug 或 document_url` | 两个都填了，或两个都没填 | 只留一个 |
| `domains[0] 配置 base_slug 时必须填写 keywords` | 用了 `base_slug` 但 `keywords` 为空 | 补上关键词 |
| `schema_version 必须为 1` | 版本号写错 | 改成 `1` |

**warning 不用慌**（不影响继续）：

| 警告 | 含义 | 要不要处理 |
| --- | --- | --- |
| `domains[0] 包范围未匹配已跟踪文件: com.example.xxx` | 这个包名在仓库里找不到对应文件 | 检查包名是否拼错；确实没有就删掉 |

### 4.7 填完的检查清单

- [ ] `schema_version: 1`
- [ ] 每个领域的 `id` 唯一、全小写
- [ ] 每个领域至少填了 `include_packages` 或 `include_files`
- [ ] `project_docs` 里每个路径都真实存在
- [ ] 用了 `base_slug` 的领域都填了 `keywords`
- [ ] 每个 `yuque_sources` 项只填了一个字段
- [ ] 领域顺序就是你想处理它们的顺序
- [ ] 跑 `scope-check.js` 输出 `"action": "validated"`

---

## 5. 逐领域建设：你会经历什么

### 5.1 Agent 派子代理查代码（你只需要等）

Agent 会在你划定的范围内派一个只读子代理去看代码，然后生成 L1 草稿。

**你不用做任何事。** 但如果它调查的范围不对（比如漏了某个包），告诉它。

### 5.2 确认语雀候选（你要做）

Agent 会给你一个文件：`docs/kb/.review/<领域id>/yuque-candidates.yaml`

打开它，你会看到：

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

**你要做的**：把 `decision` 从 `pending` 改成 `approved`（收进来）或 `rejected`（不要）：

```yaml
  - title: 支付退款流程说明
    decision: approved      # ← 收
  - title: 2024 年团建照片
    decision: rejected      # ← 不收
```

**规则**：

- **只改 `decision` 这一行**，其他字段（标题、URL、关键词）不要动
- 只要还有一项是 `pending`，流程就会停住等你
- 标 `rejected` 的文档**不会被下载**
- 改错了、想重来：重新跑一遍候选生成，**你已经做的决定会被保留**

候选是关键词机械召回的结果，出现不相关的文档很正常，标 `rejected` 就行。

### 5.3 归档（你只需要等）

Agent 会跑领域级归档，把该领域的项目文档和已批准的语雀文档处理成不可变快照。

这一步会调 MCP 生成摘要。如果 MCP 挂了，流程会停下来报错——**不会**拿旧归档冒充当前内容。

### 5.4 Agent 追问你（最花时间的一步）

Agent 查完代码和归档后，会把证据组织成一棵"设计树"，然后**一轮一轮地问你**。

每次提问长这样：

```md
❓ Q1 - "对账"在本领域指什么？

当前证据：代码里 ReconciliationService 同时出现在支付和结算两处……

➡️ 推荐答案：指支付成功后与渠道账单的逐笔核对，不包括资金归集。
```

**你的回答方式**：直接说人话就行，比如"推荐答案对，但不包括退款对账"。

**几个要点**：

- Agent 一次会问一批（当前能问的都会问），答完它重算问题树，再问下一批
- **问题数量不设上限**，问到问清楚为止。这是设计如此，不是它卡住了
- 它不会问你能自己查到的事（那属于子代理的调查工作）
- **确实没人知道答案的问题**，它会记进 `domain-questions.md` 然后继续——不会卡住整个领域

### 5.5 审核 L1 内容（你要做）

Agent 写完 `docs/kb/L1/<领域id>/README.md` 后，打开看一遍：

| 看哪节 | 检查什么 | 常见毛病 |
| --- | --- | --- |
| 领域上下文 | 说清了"这个领域为什么存在"吗 | 写成代码结构说明 |
| 领域边界 | "不负责"一节有没有内容 | 空着 |
| 术语 | 是不是**业务定义** | 抄了类名、字段清单 |
| 已确认规则与不变量 | 是不是**你确认过的** | 混进了 Agent 的推测 |
| 设计与决策 | ADR 链接点得开吗 | 链接失效 |

**不满意就直接改文件。** 你是这个文件的最终作者。

如果你想改完让 Agent 接着完善，把 frontmatter 的 `status` 改成 `draft` 或 `candidate`：

```yaml
---
domain_id: payment
layer: L1
title: 支付
status: draft        # ← 改成这个，Agent 才能继续改
---
```

> ⚠️ 如果 `status` 是 `confirmed`、`review_required`、`stale` 或 `retired`，**Agent 不会直接改这个文件**。它会把差异写进 `.review/<领域id>/l1-changes.md` 交给你裁决。这是防止 AI 覆盖你的判断。

### 5.6 审核 ADR（按需）

ADR 是 `docs/kb/L1/<领域id>/adr/NNNN-*.md`，记录"当初为什么这么设计"。

打开核对：

- **"为什么这样设计"** 是不是**真人说过的原因**，而不是推测
- **"其他考虑"** 有没有记录真实的替代方案
- 如果这个决定取代了旧决定，"取代关系"有没有链接到旧 ADR

如果发现某个 ADR 记的其实是普通实现细节、或者只是 AI 猜的原因，**要求删掉**——ADR 只该记录"难以逆转、缺背景就会误解、且仍有维护价值"的设计。

### 5.7 确认领域（你要做）

一个领域做完，Agent 会集中展示：L1、ADR、归档关联、未解决的问题。

**你要做的**：明确说"这个领域可以了"。

Agent 会跑：

```bash
node <skill-dir>/scripts/workflow.js --confirm-domain payment
```

脚本会先做结构检查（ADR 位置、文件名编号、`doc_id` 是否匹配），通过后把 L1 的 `status` 置为 `confirmed`。

**然后才会进入下一个领域。** 当前领域不确认，流程不会往下走。

---

## 6. 收尾

所有领域确认完后：

### 6.1 review L0（你要做）

Agent 会起草 `docs/kb/L0.md` 的"服务身份"一节。打开看：

```md
## 服务身份

<这个项目在系统中提供的核心业务价值>
```

**重点检查这段描述准不准。** 它是整个知识库的门面。

> ⚠️ L0 里 `<!-- kb-index:start -->` 和 `<!-- kb-index:end -->` 之间的内容是脚本生成的索引区，**不要手改**，每次都会重建。

### 6.2 等脚本收尾（你只需要等）

```bash
node <skill-dir>/scripts/index.js
node <skill-dir>/scripts/state.js
node <skill-dir>/scripts/verify.js
```

### 6.3 检查最终结果（你要做）

**① 看 `verify.js` 的输出**

```json
{
  "action": "verified",
  "errors": [],
  "warnings": [],
  "summary": { "error_count": 0, "warning_count": 0 }
}
```

`errors` 必须是空的。有 error 就要修完重跑。

**② 看 Agent 的最终报告**，应该包含：

- 每个领域的状态
- 新建 / 跳过了哪些归档
- 生成了哪些 L1 和 ADR
- `.review` 里还有哪些没解决的问题
- 下一步

**③ 确认没有这些"未完成信号"**：

- 还有 `pending` 的语雀候选
- 有脚本执行失败
- 有没替换的模板占位符（文件里还有 `<领域名称>` 这种尖括号）

---

## 7. 人工参与点总表

| 什么时候 | 你要做什么 | 属于 | 不做会怎样 |
| --- | --- | --- | --- |
| 首次启动后 | 填写 `domain-scope.yaml` | 介入 + 确认 | **流程停住** |
| 只有 keywords 时 | 从列表里选语雀知识库 | 介入 + 确认 | **流程停住** |
| 每个领域 | 把候选 `decision` 改成 approved / rejected | 介入 + 确认 | 有 pending 就**停住** |
| 每个领域 | 回答 Agent 的追问 | 介入 | 问题没答完**不结束** |
| 每个领域 | 确认"达到共同理解" | 确认 | **不推进** |
| 每个领域 | 审核 L1 内容、ADR | 审核 | 不阻塞，但知识质量没保证 |
| 每个领域 | 确认该领域 | 确认 + 审核 | **不进下一个领域** |
| 收尾 | review L0 服务身份 | 审核 + 确认 | **不能算完成** |
| 收尾 | 检查 verify 结果和报告 | 审核 | 有 error 必须修 |
| 增量运行 | 裁决 `l1-changes.md` | 审核 | 已确认知识不会自动更新 |

### 三类参与的区别

| 类型 | 含义 | 例子 |
| --- | --- | --- |
| **介入** | 流程停下来等你 | 填配置、回答问题 |
| **确认** | 对事实或选择表示认可，才能继续 | 选知识库、确认领域 |
| **审核** | 检查产物内容对不对，可以要求返工 | 看 L1、看 ADR、review L0 |

### 绝对不能做的事

| 别做 | 为什么 |
| --- | --- |
| 手改 `.meta/*.json` | 脚本生成，改了下轮就被覆盖 |
| 手改 `archive/` 里的文件 | 归档是不可变快照 |
| 手改 `scripts/` 下的脚本 | 是构建产物，重新构建会被清空 |
| 让 Agent 帮你改 `domain-scope.yaml` | 领域划分是业务判断，必须人负责 |
| 让 Agent 帮你决定候选去留 | 文档该不该收是业务判断 |
| 为了"看起来完整"而批准不相关的候选 | 污染知识库 |

---

## 8. 更新知识库（增量运行）

知识库建好后，代码或文档变了，再跑一次即可：

```
/project-forge-kb 更新 docs/kb
```

### 它会怎么做

| 情况 | 行为 |
| --- | --- |
| 领域划分配置变了 | 所有 `active` 领域重跑 |
| 代码变了 | 只重跑受影响的领域（按 `git diff` 判断） |
| 语雀文档更新了 | 配了 `keywords` 或 `yuque_sources` 的领域会重新检索 |
| 来源没变 | 跳过，复用现有归档 |
| 来源变了 | 新建归档快照，**旧快照保留** |
| 该领域代码没变、也没新归档 | **直接跳过**，表示没东西要写 |

### 两个前提

1. **开始前工作区要干净**——先 `git commit` 或 `git stash`，避免未提交的内容被混进版本基线
2. 已确认的 L1 **不会被自动改写**：如果新证据和已确认内容冲突，Agent 会把差异写进 `.review/<领域id>/l1-changes.md`，**等你在"人工决策"一节里逐条裁决**

---

## 9. 常见问题

**Q：中途退出了，要重头来吗？**
不用。进度记在 `.meta/workflow-run.json`，再触发一次 Skill，Agent 会先问进度然后从断点继续。

**Q：Agent 说要先填 `domain-scope.yaml`，但我不确定怎么分领域？**
先按"业务上独立的职责单元"草草分几个，填完跑起来看效果。领域划分随时能改，改完重跑 `scope-check.js` 就行。

**Q：领域可以随时增删吗？**
可以。直接改 `domain-scope.yaml` 然后重跑 `scope-check.js`。新增的领域会按新的 `domain_order` 处理。

**Q：为什么 Agent 反复追问同一个领域，问不完？**
追问的轮数不设上限——每轮答完它重算问题树，解决了一个问题可能带出新的下游问题。这是刻意的设计：**目标是问清楚，不是少问**。

**Q：它说某个领域"直接跳过"了，是出错了吗？**
不是。增量运行时，如果该领域代码没变、归档也没有新快照，脚本会判定"没有东西要写"并放行。

**Q：语雀候选里出现了完全无关的文档？**
正常。候选是按关键词机械召回的，本来就允许误召回。标 `rejected` 就行，不相关的不影响任何东西。

**Q：我能直接编辑 L1 吗？**
可以，任何状态都能改——你是最终作者。但改完想让 Agent 接着完善的话，记得把 `status` 设成 `candidate` 或 `draft`，否则它只会提变更建议而不会动手。

**Q：MCP 挂了怎么办？**
流程会停下来报错。**不会**创建兜底候选，也不会拿旧归档冒充当前内容。修好 MCP 再重跑即可。不用语雀的话，把 `keywords` 和 `yuque_sources` 都清空就不会走到这一步。

**Q：`domain-questions.md` 里的问题会阻塞流程吗？**
不会。那些是"经过调查、你也没法解释"的问题，记录在案但不进 L1，也不影响其他知识生成。以后想起来了可以再补。
