# ProjectForgeKB

从人工划定的领域范围出发，为单个代码仓库构建可审核、可追溯、可增量更新的领域知识库。

领域知识不是"把代码抄一遍"。代码能说明类、方法与调用关系，但说不清服务职责、业务术语、状态含义、核心不变量，以及"当初为什么这样设计"。本 Skill 把这些只存在于人脑里的隐形知识，通过事实调查 + 人工访谈的方式固化进仓库，并在代码变更后支持增量更新。

- 用户可见名称：**ProjectForgeKB**
- 技能标识：`project-forge-kb`
- 入口：同目录的 [`SKILL.md`](SKILL.md)
- 运行前提：宿主具备文件搜索、分段读取、文件写入、**子代理派发**与 Node.js 执行能力

---

## 它能做什么

| 能力 | 入口 | 效果 |
| --- | --- | --- |
| 初始化领域范围 | `scope-init.js` | 创建 `docs/kb/domain-scope.yaml` 空骨架；已存在则跳过，绝不覆盖 |
| 校验并锁定范围 | `scope-check.js` | 校验通过后写 `.meta/scope-resolved.json`，按人工书写顺序固定 `domain_order` |
| 发现语雀知识库 | `yuque-books.js` | 列出知识库 `name` 与 `slug`，供人工填 `base_slug` |
| 检索语雀候选 | `yuque-candidates.js` | 按领域 `keywords` 检索，生成待裁决的候选清单 |
| 校验人工裁决 | `yuque-selection.js` | 输出 approved 清单；有 `pending` 即阻塞，`rejected` 文档不会被下载 |
| 归档领域资料 | `archive-domain.js` | 该领域全部项目文档 + 已批准语雀文档，一次完成取源、切块、摘要、校验、发布 |
| 增量复用 | `archive-domain.js` 内部 | 来源未变则跳过并复用快照；来源变化则新建快照，旧快照保留 |
| 推进流程 | `workflow.js` | 回答"当前在哪、下一步该谁做什么"，登记阶段，校验产物后才放行 |
| 确认领域 | `workflow.js --confirm-domain` | 检查 ADR 目录、文件名与 `doc_id`，通过后把 L1 置为 `confirmed` |
| 生成索引与 catalog | `index.js` | 重写 L0 的机器索引区，并生成 `.meta/knowledge-base.json` |
| 生成增量基线 | `state.js` | 写 `.meta/source-state.json`：commit、配置 hash、ADR 指纹、archive 来源标记、代码指纹 |
| 完整性校验 | `verify.js` | 33 类 finding 码（30 error + 3 warning），有 error 退出码为 1 |

---

## 目录结构

```text
skills/project-forge-kb/
├── SKILL.md                    入口：硬性边界 + 选择流程 + 平台契约 + 完成条件
├── README.md                   本文件
├── USAGE.md                    使用文档：如何启动、人工介入/确认/审核点
├── agents/openai.yaml          宿主适配（display_name: ProjectForgeKB）
├── references/                 按需加载的操作规范
│   ├── domain-scope.md         domain-scope.yaml 字段、写法、Demo、校验边界
│   ├── domain-workflow.md      逐领域操作指南
│   ├── archive-workflow.md     领域级归档说明
│   ├── l1-extraction.md        L1 提取规范与内容/编辑边界
│   └── domain-questioning.md   领域建模访谈：设计树、frontier、术语与 ADR 准入
├── assets/                     Agent 直接复用的模板
│   ├── L0.md                   项目地图（服务身份 + 机器索引区）
│   ├── L1.md                   领域 README 模板
│   ├── ADR.md                  设计决策模板
│   ├── domain-questions.md     未解决问题记录
│   └── review-changes.md       已确认 L1 的变更建议
└── scripts/                    12 个可独立执行的 Node 脚本（构建产物）
```

`references/` 与 `assets/` 都相对 `SKILL.md` 解析。`scripts/` 是 esbuild bundle 产物，**运行期零依赖**：目标仓库直接 `node` 执行即可，不需要 `node_modules`。

---

## 安装与执行

把整个 `project-forge-kb/` 目录放到宿主的 Skill 发现位置即可，无需安装依赖。`agents/openai.yaml` 提供宿主显示名等适配信息。

脚本都在**目标仓库根目录**执行（或用 `--repo-root` 指定）：

```bash
node <skill-dir>/scripts/<name>.js
```

每个脚本都支持 `--help` / `-h`，且在任何文件读写或网络请求之前返回：

```bash
node <skill-dir>/scripts/workflow.js --help
```

> 脚本是构建产物，不需要阅读其源码。用法以 `--help` 和本 README 为准。

---

## 生成的产物

```text
docs/kb/
├── L0.md                       服务身份（人工）+ 领域知识索引（机器区）
├── domain-scope.yaml           人工所有：领域归属与来源的唯一权威
├── L1/<domain_id>/
│   ├── README.md               领域上下文、边界、术语、规则、能力、设计与决策、归档资料
│   └── adr/<四位编号>-<描述>.md 设计决策
├── archive/<archive_id>/       original.md + summary.md + chunks/NN.md
├── .review/<domain_id>/        yuque-candidates.yaml、domain-questions.md、l1-changes.md
└── .meta/                      全部机器生成，Agent 不手改
    ├── scope-resolved.json     规范化范围与 domain_order
    ├── workflow-run.json       本轮运行状态
    ├── domains/<domain_id>.json 领域机器元数据
    ├── archive-runs/<domain_id>.json 归档回执
    ├── knowledge-base.json     知识对象与关系 catalog
    └── source-state.json       增量基线
```

---

## 使用流程

### 阶段一：建立范围

1. 运行 `scope-init.js` 创建 `domain-scope.yaml` 空骨架。
2. 运行 `yuque-books.js` 展示可用知识库名称与 slug。
3. 向用户展示 [范围配置说明](references/domain-scope.md) 与完整 Demo，**停止**等待人工填写领域、代码范围、关键词、项目文档与语雀来源。不得用空 `domains` 继续。
4. 人工填写后运行 `scope-check.js`。校验失败立即停止；成功后严格使用输出的 `domain_order`。
5. 运行 `workflow.js --start` 创建本轮运行，再运行 `workflow.js` 获取下一步。

### 阶段二：逐领域建设

按 `domain_order` **一次只处理一个领域**，当前领域未确认前不得进入下一个：

| 步骤 | 动作 |
| --- | --- |
| 代码事实调查 | 派只读子代理（写明 `domain_id`、代码基线、include/exclude、只读要求）；汇总后按 `assets/L1.md` 起草 `L1/<domain_id>/README.md`；`--complete-step code-facts` |
| 语雀候选 | `yuque-candidates.js --domain <id>`；仅有 `keywords` 时先让用户确认知识库，再传 `--book-slug <slug> --confirm-book`；`--complete-step yuque-candidates` |
| 人工裁决 | 向用户展示候选（只改 `decision`）；`yuque-selection.js` 校验；仍有 `pending` 必须停 |
| 归档 | `archive-domain.js --domain <id>`；`--complete-step archives` |
| 归档事实调查 | 派只读子代理：先读 `summary.md`，需要核验证据时才读 chunk；`--complete-step archive-facts` |
| 领域建模访谈 | 建设计树、按 frontier 分轮追问；术语与 ADR 满足准入即立即写入；`--complete-step domain-knowledge` |
| 领域确认 | 集中展示产物与未决问题；`workflow.js --confirm-domain <id>` |

### 阶段三：仓库收尾

1. 派仓库级只读子代理调查服务身份，用 `assets/L0.md` 起草 `L0.md`，**明确请用户 review**。
2. `workflow.js --complete-step l0-review`
3. 依次执行，任一失败即停止：

```bash
node <skill-dir>/scripts/index.js
node <skill-dir>/scripts/state.js
node <skill-dir>/scripts/verify.js
node <skill-dir>/scripts/workflow.js --complete-run
```

### 增量运行

已有 `source-state.json` 时自动进入增量模式：

- 启动前**要求工作区干净**，避免未提交内容被误归入当前 commit；
- 领域范围配置变化 → 全部 active 领域重跑；否则用 `git diff <baseline.source_commit> HEAD` 命中 include/exclude 挑选受影响领域；
- 配置了 `yuque_sources` 或 `keywords` 的领域始终保留在候选中，否则语雀侧更新会被漏掉；
- 代码未变且归档无新快照的领域会被直接放行（`domain_unchanged`）——表示没有东西要写，不是流程失败。

---

## 命令参考

| 命令 | 说明 |
| --- | --- |
| `scope-init.js` | 创建 `domain-scope.yaml` 空骨架 |
| `scope-check.js [--scope <path>] [--output <path>]` | 校验范围并写 `scope-resolved.json` |
| `yuque-books.js` | 列出语雀知识库 `name` / `slug` |
| `yuque-candidates.js --domain <id> [--book-slug <slug> --confirm-book]` | 生成/刷新候选清单 |
| `yuque-selection.js --domain <id>` | 校验裁决并输出 approved 清单 |
| `archive-domain.js --domain <id>` | 归档该领域全部来源 |
| `archive-prepare.js --from-file <path> \| --from-yuque --document-url <url>` | 单来源归档到暂存区（诊断用） |
| `archive-publish.js --staging <path>` | 校验并发布暂存目录（诊断用） |
| `workflow.js [--start \| --complete-step <step> --domain <id> \| --confirm-domain <id> \| --complete-run]` | 运行状态机 |
| `index.js` | 重建 L0 索引区并生成 catalog |
| `state.js` | 生成增量基线 |
| `verify.js` | 全库完整性校验 |

领域级步骤固定为：`code-facts → yuque-candidates → archives → archive-facts → domain-knowledge`，之后是人工确认。

---

## 设计要点

### 按"谁来判断"切分职责

| 参与方 | 负责什么 |
| --- | --- |
| 脚本 | 范围校验、语雀检索、来源版本比对、切块、摘要调用、归档发布、机器状态、流程推进 |
| 子代理 | 在**限定范围**内调查代码与归档事实，报告证据、冲突与待解释的设计；不修改正式知识 |
| 主 Agent | 汇总证据、组织领域追问、生成 L1/ADR/`.review` |
| 用户 | 填 `domain-scope.yaml`、裁决语雀候选、回答追问、确认领域、review L0 |

"减少人工介入"指的是减少人工手改机器产物，**不是**减少领域追问。

### 六条硬边界

1. **领域范围归人工**：`domain-scope.yaml` 是唯一权威，脚本只在文件不存在时建空骨架，此后不得填充、改写、拆分、合并或静默修复。
2. **机器不得覆盖已确认知识**：L1 有六态 `candidate / draft / confirmed / review_required / stale / retired`；Agent 只能直接改写 `candidate` 和 `draft`。需改动已确认内容时写入 `.review/<domain_id>/l1-changes.md`，保留原文交用户裁决。
3. **推断不得写成正式知识**：调查只产出术语候选与 ADR 问题候选，正式结论必须经领域访谈。
4. **冲突不裁决**：保留各方证据。
5. **archive 不可变**：来源版本未变则复用，变化则新建快照并保留旧快照。
6. **路径契约不可变**：L1 固定 `docs/kb/L1/<domain_id>/README.md`；ADR 固定 `adr/<四位编号>-<描述>.md`，`doc_id` 为 `ADR-<domain_id>-<编号>`。

### 流程由状态机推进

运行状态写在 `.meta/workflow-run.json`（脚本生成，Agent 不手改），记录模式、代码基线、`scope_hash`、每个领域的 `local_changes` / `completed_steps` / `confirmed` 与 `l0_reviewed`。

`workflow.js` 无参数运行即"问进度"，返回 `{status, domain, step, next_action, blocking_reason}`。Agent 不得跳过脚本给出的 `next_action`；`--complete-step` 会校验"当前应完成的步骤"，不匹配即报错。

### 访谈与准入

- 证据组织为**设计树**（领域语言 + 设计决策两个分支），父节点未解决不猜下游答案；
- `frontier` = 前置条件已明确、当前可由用户判断的全部问题；每轮提完整 frontier，逐项编号，给出证据与**推荐答案**；用户回答后重算整棵树；
- **术语五条准入**：领域特有、需统一理解、含义已明确、能用一两句话说明"它是什么"、必要时标出易混别名。类名/字段清单/框架 API 只能作为证据；
- **ADR 五条准入**：人工确认真实原因、存在真正的替代方案与取舍、难以逆转或变更成本高、缺背景易被误解、对维护仍有价值。ADR 不设 `status`。

### 归档：幂等、增量、不可变

```text
判来源版本
  项目文档：必须已提交且无未提交修改 → source_commit = git log -1 --format=%H -- <file>
  语雀文档：content + content_updated_at（回退 updated_at）+ document_url
    ↓
按 (source_type, source_ref) 找最新快照并比对版本标记
    ↓ 相同 → skipped，复用旧快照
    ↓ 不同
暂存：切块（标题 → 段落 → 定长，target 28000 / overlap 200）
  → MCP doc_extract_and_summarize（要求 chunk 数与本地切分严格一致、index 唯一）
  → 写 original.md / summary.md / chunks/NN.md / manifest.json（含每块 hash）
    ↓
发布：检查 title/keyTopics/正文非空且不含 TODO、逐块比对 hash
  → 回填 doc_id = chunk-<NN>-<archiveId>、parent_doc_id、prev/next
  → 整目录 rename 到 archive/<archive_id>
```

`archive_id` 形如 `<YYYY-MM-DD>-<repo|yuque>-<slug>`，同日同名追加 `-2`、`-3`；**已发布目录永不覆盖**。archive 全局共享：同一文档关联多个领域时只归档一次，各领域分别引用。

### 确定性约定

- **原子写入**：所有覆盖走 `<path>.<pid>.tmp` + `rename`；archive 是整目录 `rename`；
- **确定性排序**：目录遍历按名称排序，候选按"命中关键词数 → 更新时间 → key"排序，L0 索引按 `domain_id` 排序；
- **路径安全**：范围、项目文档、归档目标都检查越界与绝对路径；领域 ID 约束为 `^[a-z0-9][a-z0-9_-]*$`；
- **输出约定**：成功时 JSON → stdout；错误 → stderr 且退出码 1。

---

## 运行边界

| 边界 | 表现 |
| --- | --- |
| 必须有子代理 | 宿主无法派发子代理时报告环境不满足，停止领域提取 |
| 依赖 MCP 可达 | MCP 报错即停止并报告；不创建兜底候选，不用旧 archive 冒充当前内容 |
| 只接受 Markdown | 非 `.md` 项目文档直接报错，要求先转换 |
| 项目文档必须已提交 | 未跟踪或有未提交修改时拒绝归档 |
| 归档入口 | 正常流程只用 `archive-domain.js`，`archive-prepare/publish` 仅供诊断 |
| 增量前置 | 已有基线时要求工作区干净 |
| 范围配置 | 结构由脚本生成，领域内容只能人工填写；脚本不提供领域建议 |

---

## MCP 依赖

脚本通过 Streamable HTTP 调用外部 MCP 服务，地址封装在脚本内，客户端不持有语雀凭证。用到的 tool：

| tool | 用途 |
| --- | --- |
| `yuque_list_books` | 列出可用知识库 |
| `yuque_search_documents` | 按关键词检索文档（不返回正文） |
| `yuque_get_document` | 获取指定文档正文与更新时间 |
| `doc_extract_and_summarize` | 生成文档摘要、关键主题与各 chunk 摘要 |

MCP 服务需独立部署；本 Skill 只包含客户端与 tool 契约。
