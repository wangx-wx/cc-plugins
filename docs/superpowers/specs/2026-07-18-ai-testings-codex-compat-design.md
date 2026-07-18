# ai-testings 插件 Codex 兼容设计（POC）

> 日期：2026-07-18
> 分支：`feat/ai-testings-codex-compat`
> 状态：设计已获批，待写实现计划
> 相关调研：[`docs/claude-code-codex-plugin-compatibility.md`](../../claude-code-codex-plugin-compatibility.md)

## 1. 背景与目标

wx-cc-plugins 目前是纯 Claude Code 插件仓库（8 个插件）。目标是让插件能同时跑在 Claude Code 与 Codex 上，参考 obra/superpowers 的多宿主做法。

本 spec 只覆盖 **POC**：用 **ai-testings** 一个插件，把「同一套能力核心，在 Claude Code 与 Codex 两个宿主真机跑通」验证出来，再据此推广到其余 7 个插件。

选 ai-testings 做 POC 的原因：它同时覆盖 **Skill + agents + hooks** 三个最棘手的跨端维度（`AskUserQuestion` 工具映射、test-writer agent 调度、hooks 事件与 IO 协议），POC 价值最高。

**成功标准（真机端到端，已具备 Codex CLI 环境）：**
- Claude Code：装插件 → `test-review` 触发并输出审查清单 → Bash/Stop 时 hook 触发。
- Codex：装插件 → 会话里 test-review 被原生发现并触发 → hook 触发 → test-writer 可被调度或降级内联。

## 2. 范围

| In scope | Out of scope |
|---|---|
| 仓库级 Codex marketplace（`.agents/plugins/marketplace.json`） | 其余 7 个插件的接入（POC 通过后另开） |
| ai-testings 完整双宿主改造 | map-plugin bug、office-plugin 许可证等历史问题 |
| 真机验证 Claude Code + Codex | 正式发布到公开 marketplace |
| — | **bootstrap 注入**（见 §4，官方标准不需要，已砍） |
| — | 打包脚本（本地 marketplace 直连 `./plugins` 即可，推广阶段再说） |

## 3. 关键决策与官方依据

本次通过本机 `curl` 直连 OpenAI **官方**插件仓库 `openai/plugins`（README + 8022 文件树 + 真实 manifest/hooks/元数据）取得一手证据，用于替代二手推断。

### 3.1 Codex 官方插件标准结构

README 原文：
> "Each plugin lives under `plugins/<name>/` with a **required** `.codex-plugin/plugin.json` manifest and optional companion surfaces such as `skills/`, `.app.json`, `.mcp.json`, plugin-level `agents/`, `commands/`, `hooks.json`, `assets/`."
> 默认 marketplace = `.agents/plugins/marketplace.json`。

### 3.2 skill 靠原生 discovery，不靠 bootstrap

每个 skill 配一份 `agents/openai.yaml`（极简）：
```yaml
interface:
  display_name: "Using Superpowers"
  short_description: "Establish how and when to use Superpowers skills"
```
Codex 读 manifest 的 `"skills": "./skills/"` + 各 skill 的 openai.yaml 即可发现并呈现，**无需会话启动注入**。

### 3.3 决策：不搭 bootstrap（有官方铁证）

`openai/plugins` 里的 **superpowers 官方 Codex 版（v5.1.3）** manifest 全文只有：
```json
{ "name": "superpowers", "version": "5.1.3", "...": "...", "skills": "./skills/", "interface": { } }
```
> 没有 `.claude-plugin/`、没有 `hooks.json`、没有 bootstrap 脚本，**连 `"hooks"` 字段都没有**。

结论：superpowers 的 SessionStart bootstrap 注入是它在 **Claude Code** 上强推方法论的机制，**官方 Codex 版根本不带**。Claude Code 与 Codex 都有原生 skill discovery，bootstrap 对两者都无落点。故本设计不做 bootstrap，对齐官方标准。

### 3.4 hooks 与 Claude Code 同构，但可选

全仓 182 个插件只有 2 个用 hooks（figma、replayio）。格式与 Claude 一致（`PostToolUse`/`Stop` + `matcher` + `command`），放在**根级 `hooks.json`**，manifest 不声明、自动发现。figma 示例：
```json
{ "hooks": { "PostToolUse": [ { "matcher": "Write|Edit", "hooks": [ { "type": "command", "command": "./scripts/post_write_figma_parity_check.sh" } ] } ] } }
```

## 4. 架构

共享能力核心（唯一真源）+ 两个薄适配层，**无 bootstrap**：

```
共享核心：skills/*/SKILL.md · agents/*.md · scripts/ · references/
   ├── Claude 适配：.claude-plugin/plugin.json · allowed-tools · hooks/hooks.json
   └── Codex 适配： .codex-plugin/plugin.json · skills/*/agents/openai.yaml · (hooks.json)
```

## 5. 目标目录结构

**仓库级**（只加一个文件）：
```
├── .claude-plugin/marketplace.json     # 已有
└── .agents/plugins/marketplace.json    # 新增：Codex marketplace，指向 ./plugins
```

**ai-testings 级**：
```
plugins/ai-testings/
├── .claude-plugin/plugin.json          # 保留
├── .codex-plugin/plugin.json           # 新增：skills + interface，不声明 hooks
├── skills/test-review/
│   ├── SKILL.md                        # 中性化 AskUserQuestion
│   └── agents/openai.yaml              # 新增：Codex skill 发现元数据
├── agents/test-writer.md               # 共享（按需加 openai.yaml）
├── hooks/hooks.json                    # Claude；Codex hooks 处理见 §6.4
└── scripts/                            # 共享 .mjs/.sh
```

## 6. 逐组件设计

### 6.1 Codex manifest（`.codex-plugin/plugin.json`）

按 figma/superpowers 官方样式：
- `name` / `version` / `description` / `author` / `keywords`
- `"skills": "./skills/"`
- `interface { displayName, shortDescription, longDescription, developerName, category: "Developer Tools", capabilities: ["Interactive","Read","Write"], defaultPrompt }`
- **不写 `hooks` 字段**（自动发现根级 `hooks.json`）
- plugin-level agents 是否需在 manifest 声明（如 `"agents": "./agents/"`）——**待实测确认字段名与是否必需**。

### 6.2 skill 中性化（`skills/test-review/SKILL.md`）

- 正文步骤 6 的 `AskUserQuestion` → 改为描述动作：「向用户提两个问题（是否启动 test-writer / 补充注意事项）」。Claude 读到会自动用 AskUserQuestion 工具，Codex 用其自身问询方式。
- frontmatter `allowed-tools: AskUserQuestion`：**保留**（Codex 忽略未知字段，零风险；Claude 继续预授权）。
- `${CLAUDE_PLUGIN_ROOT}`：**保留**（Codex 提供兼容变量）。

### 6.3 skill 元数据（`skills/test-review/agents/openai.yaml`，新增）

```yaml
interface:
  display_name: "Test Review"
  short_description: "审查变更的测试需求，输出测试审查清单"
```

### 6.4 hooks（关键差异，含待实测）

现状（Claude）：`hooks/hooks.json`，事件 `Stop` + `PreToolUse:Bash`，命令 `node ${CLAUDE_PLUGIN_ROOT}/scripts/*.mjs`。

Codex 官方样本：根级 `hooks.json`，相对命令 `./scripts/*.sh`，事件见到 `PostToolUse`/`Stop`。

**实现第一步真机测三点，据结果决定共享一份还是双份 hooks 配置：**
1. Codex 是否也发现 `hooks/hooks.json`（还是必须根级 `hooks.json`）；
2. Codex 是否支持 `PreToolUse`（样本只见 `PostToolUse`/`Stop`）；
3. hook 命令里 `${CLAUDE_PLUGIN_ROOT}` 是否可用（官方样本用相对路径 `./scripts/`）。

脚本已有 `.mjs` 与 `.sh` 双版本，可按宿主选用。

### 6.5 test-writer agent（`agents/test-writer.md`）

- 共享 prompt template（Codex 支持 plugin-level `agents/`）。
- frontmatter `tools: Read, Grep, ...` 是 Claude 格式，Codex 是否需要 openai.yaml 式声明——**待实测**。
- Codex 侧调度：test-review 触发 test-writer，需 Codex 开启多 agent（`~/.codex/config.toml` 的 `[features] multi_agent = true`，据 superpowers `codex-tools.md`）；缺失时降级为当前 agent 内联执行，不伪造工具调用。

### 6.6 marketplace（`.agents/plugins/marketplace.json`，新增）

官方格式，指向 `./plugins`，包含 ai-testings 条目（policy/category 按官方 schema）。

## 7. 待实测点汇总（实现前置）

| # | 待测 | 影响 |
|---|---|---|
| 1 | Codex 认 `hooks/hooks.json` 还是仅根级 `hooks.json` | hooks 文件放置 |
| 2 | Codex 是否支持 `PreToolUse` | pre-commit-test-check hook 能否移植 |
| 3 | hook 命令里 `${CLAUDE_PLUGIN_ROOT}` 是否可用 | 命令写法（变量 vs 相对路径） |
| 4 | plugin-level agents 是否需 manifest 声明及字段名 | manifest 字段 |
| 5 | test-writer 的 Claude frontmatter 是否需 openai.yaml 补充 | agent 元数据 |

## 8. 明确不做（YAGNI）

- bootstrap 注入（官方不需要，§3.3）
- 打包脚本（POC 用本地 marketplace 直连 `./plugins`）
- 其余 7 个插件

## 9. 官方参考（一手来源）

- OpenAI 官方插件仓库：`https://github.com/openai/plugins`（README、`plugins/superpowers/.codex-plugin/plugin.json`、`plugins/figma/hooks.json`、`plugins/*/skills/*/agents/openai.yaml`）
- Codex 官方文档：`https://learn.chatgpt.com/docs/build-plugins`（SPA，本次因网络策略未抓到正文，以官方仓库真实插件为准）
- superpowers 本地缓存：`~/.claude/plugins/cache/.../superpowers/6.1.1/`（`.codex-plugin/plugin.json`、`docs/porting-to-a-new-harness.md`、`skills/using-superpowers/references/codex-tools.md`）
