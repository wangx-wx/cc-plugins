# Project Analyzer 工作流（宿主中立）

> 本文件是 `analyze` / `confirm` / `consolidate` 三流程的**唯一真源**，被 Claude Code 的 `commands/project-analyzer.md` 与 Codex 的 `skills/project-analyzer/SKILL.md` 共同引用，避免逻辑重复。

## 宿主适配（执行任何流程前先确定）

**① 产物根 `RULES_ROOT` 与入口文件 `ENTRY`，按当前宿主取值：**

| 宿主 | RULES_ROOT | ENTRY |
|---|---|---|
| Claude Code | `.claude/rules/` | `CLAUDE.md` |
| Codex / 其他 | `.agent-rules/` | `AGENTS.md` |

下文路径中的 `<RULES_ROOT>`、`<ENTRY>` 一律替换为上表当前宿主的值。

**② 子 agent 调度能力**：本流程多处需要执行 `scanner` / `analyst` / `rule-writer` 等角色。统一规则：
- 宿主支持命名子 agent（如 Claude Code 的 Task/派发）→ **派发**对应 agent；
- 不支持（如当前 Codex）→ 当前会话**内联执行** `agents/<角色>.md` 的规范；
- 支持并行子 agent → 可并行；否则**依次**执行。
- **绝不伪造**宿主不存在的子 agent 调用。
- 内联执行时只取 agent 文件**正文**的角色规范，忽略其 YAML frontmatter（`name`/`tools` 仅供 Claude 注册用）；agent 正文中的 `<RULES_ROOT>`/`<ENTRY>` 按上表当前宿主取值。

---

## analyze 流程

**前置检查**：`project_path` 下无 `pom.xml` 且无 `build.gradle` 时，提示用户确认是否继续。

**步骤 1 — 项目探索**：**执行 scanner 分析**（`agents/scanner.md` 的规范；支持子 agent 则派发 `project-analyzer-scanner`，否则内联执行），传入 `project_path`。
产出：`<RULES_ROOT>analysis/project-map.md`。

**步骤 2 — 分析**：**对每个 focus 执行 analyst 分析**（`agents/analyzer.md` 的规范；支持子 agent 则派发 `project-analyzer-analyst`，否则内联执行；支持并行则并行、否则依次）。`focus=all` 时覆盖 8 个维度：

| focus | 传入参数 |
|-------|---------|
| arch | project_path, project_map_path, focus="arch", output=`<RULES_ROOT>analysis/arch-observations.md` |
| api | 同上，focus="api" |
| security | focus="security" |
| robustness | focus="robustness" |
| db | focus="db" |
| cache | focus="cache" |
| mq | focus="mq" |
| testing | focus="testing" |

**步骤 3 — 合并观察**：所有 analyst 完成后，将各 `{focus}-observations.md` 合并为 `<RULES_ROOT>analysis/observations.md`。

**步骤 4 — 确认清单**：将 observations.md 中标记为 `confidence: medium/low` 或 `conflict` 的条目，按以下格式写入 `<RULES_ROOT>pending/confirmation-required.md`：

```markdown
## [{focus}] {观察标题}

**观察**: {发现了什么}
**证据**: `{file:line}`
**不确定原因**: {写法不一致 / 只有一处证据 / 推断性结论}
**候选约束**: {如果确认为 keep，建议的规则内容}

decision: （填写 keep / skip / legacy）
```

**步骤 5 — 输出摘要**：

```
✅ Analyze 完成
项目: {project_path}
Focus: {focus}

候选规则: {n} 条（高置信度: {n} | 待确认: {n}）

下一步:
  1. 查看 <RULES_ROOT>pending/confirmation-required.md，填写 decision
  2. 运行 confirm（Claude: /project-analyzer confirm {project_path}；Codex: 让我 confirm）
     或带入口更新: confirm ... --apply-entry
```

---

## confirm 流程

**前置检查**：`<RULES_ROOT>analysis/observations.md` 不存在时，提示先执行 analyze。

**执行 rule-writer**（`agents/rule-writer.md` 的规范；支持子 agent 则派发 `project-analyzer-rule-writer`，否则内联执行），传入：
- project_path
- observations_path: `<RULES_ROOT>analysis/observations.md`
- confirmation_path: `<RULES_ROOT>pending/confirmation-required.md`（如存在）
- apply_entry
- output_dir: `<RULES_ROOT>generated/`

**入口更新**（仅当 `apply_entry=true`）：将规则索引写入 `<ENTRY>` 的 managed block：
```markdown
<!-- project-analyzer:start -->
Project-specific coding rules: `<RULES_ROOT>generated/00-index.md`
Read the index first, then load only the rule file matching your task.
Also read `<RULES_ROOT>manual/` when it exists.
<!-- project-analyzer:end -->
```

**Hook 安装（仅 Claude Code；且 `apply_entry=true` 且 `skip_hooks=false`）**：
> ⚠️ **仅 Claude Code 支持**。`install-hooks.sh` 往 `.claude/settings.json` 写 PostToolUse hook（改 .java 后提醒查规则 / 补测试）。**Codex 不支持该自动提醒**（Codex 不读 `.claude/settings.json`，且插件 hook 输出实效待定，见 `docs/claude-code-codex-plugin-compatibility.md`）——Codex 侧**跳过此步**，规则检查 / 测试生成改为**用户主动触发**。
>
> Claude 侧执行：按优先级定位 `${CLAUDE_PLUGIN_ROOT}/scripts/install-hooks.sh`，找到则 `bash ${CLAUDE_PLUGIN_ROOT}/scripts/install-hooks.sh {project_path}`；未找到则输出 `⚠️ Hook 安装已跳过 — 未找到 install-hooks.sh` 并继续。

**输出**：列出 `<RULES_ROOT>generated/` 下生成的文件，并按情况给出提示：
- `apply_entry=true`：`✅ <ENTRY> 已更新（managed block 已写入）`；
- `apply_entry=true` 且 Claude Code 且 `skip_hooks=false`：`✅ Hooks 已安装（.claude/settings.json PostToolUse）① post-edit-rule-check.sh 检查规则合规 ② post-edit-test.sh 生成并运行单测`；
- `apply_entry=true` 且 `skip_hooks=true`：`⚠️ Hook 安装已跳过（--skip-hooks）`；
- `apply_entry=false`：`⚠️ 规则已生成但尚未激活。运行以下命令激活：/project-analyzer confirm {project_path} --apply-entry`。

---

## consolidate 流程

1. 读取 `{project_path}/<ENTRY>`（Claude 读 `CLAUDE.md`，Codex 读 `AGENTS.md`；两者都在则都读）。
2. 提取 `<!-- project-analyzer:start -->` ... `<!-- project-analyzer:end -->` 块**之外**的规则内容。
3. `--dry-run`：输出预览，不写文件。
4. 非 dry-run：将提取内容写入 `<RULES_ROOT>manual/existing-rules.md`，并把 `<ENTRY>` 重写为精简版：

```markdown
# {项目名}

{一行描述（来自原文件的第一段）}

<!-- project-analyzer:start -->
Project-specific coding rules: `<RULES_ROOT>generated/00-index.md`
Read the index first, then load only the rule file matching your task.
Also read `<RULES_ROOT>manual/` when it exists.
<!-- project-analyzer:end -->
```

---

## 不做的事

- 不读取项目源码（由 scanner / analyst 角色负责）。
- 所有分析产物写入 `<RULES_ROOT>analysis/`，不在 `{project_path}` 根目录散落文件。
- 不修改 `<RULES_ROOT>manual/`（rule-writer 只写 `generated/`）。
