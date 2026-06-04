---
name: project-analyzer
description: Java 微服务项目规则分析器。路由 analyze/confirm/consolidate 子命令，调度 agents。
arguments:
  - {name: subcommand, required: true, type: string}
  - {name: project_path, required: true, type: string}
  - {name: focus, required: false, default: "all"}
  - {name: apply_entry, required: false, default: false}
  - {name: dry_run, required: false, default: false}
  - {name: skip_hooks, required: false, default: false}
examples:
  - "/project-analyzer analyze /workspace/my-service"
  - "/project-analyzer analyze /workspace/my-service --focus=api"
  - "/project-analyzer confirm /workspace/my-service --apply-entry"
  - "/project-analyzer consolidate /workspace/my-service --dry-run"
---

# Project Analyzer Command

## 参数

- subcommand: {{subcommand}}（analyze | confirm | consolidate）
- project_path: {{project_path}}
- focus: {{focus}}（arch | api | security | robustness | db | cache | mq | testing | all）
- apply_entry: {{apply_entry}}
- dry_run: {{dry_run}}
- skip_hooks: {{skip_hooks}}

---

## analyze 流程

**前置检查**：project_path 下无 pom.xml 且无 build.gradle 时，提示用户确认是否继续。

**步骤 1 — 项目探索**：派发 `project-analyzer-scanner` agent，传入 project_path。
等待产出：`{project_path}/.claude/rules/analysis/project-map.md`。

**步骤 2 — 并行分析**：根据 focus 参数派发 `project-analyzer-analyst` agent（focus=all 时并行派发 8 次）：

| focus | 传入参数 |
|-------|---------|
| arch | project_path, project_map_path, focus="arch", output=`.claude/rules/analysis/arch-observations.md` |
| api | 同上，focus="api", output=`.claude/rules/analysis/api-observations.md` |
| security | focus="security" |
| robustness | focus="robustness" |
| db | focus="db" |
| cache | focus="cache" |
| mq | focus="mq" |
| testing | focus="testing" |

**步骤 3 — 合并观察**：所有 analyst 完成后，将各 `{focus}-observations.md` 合并为 `.claude/rules/analysis/observations.md`。

**步骤 4 — 确认清单**：将 observations.md 中标记为 `confidence: medium/low` 或 `conflict` 的条目，按以下格式写入 `.claude/rules/pending/confirmation-required.md`：

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
  1. 查看 .claude/rules/pending/confirmation-required.md，填写 decision
  2. 运行: /project-analyzer confirm {project_path}
     或带入口更新: /project-analyzer confirm {project_path} --apply-entry
```

---

## confirm 流程

**前置检查**：`observations.md` 不存在时，提示先执行 analyze。

派发 `project-analyzer-rule-writer` agent，传入：
- project_path
- observations_path: `{project_path}/.claude/rules/analysis/observations.md`
- confirmation_path: `{project_path}/.claude/rules/pending/confirmation-required.md`（如存在）
- apply_entry: {{apply_entry}}

**Hook 安装**（仅当 apply_entry=true 且 skip_hooks=false 时执行）：

按以下优先级定位 `install-hooks.sh`：

1. 检查 `${CLAUDE_PLUGIN_ROOT}/scripts/install-hooks.sh` 是否存在。
2. 未找到时，输出 `⚠️ Hook 安装已跳过 — 未找到 install-hooks.sh，请确认插件已正确安装` 并继续。

找到脚本后执行：`bash ${CLAUDE_PLUGIN_ROOT}/scripts/install-hooks.sh {project_path}`。

完成后输出生成文件列表：

```
✅ Confirm 完成

生成文件:
  .claude/rules/generated/00-index.md
  .claude/rules/generated/01-architecture-rules.md
  .claude/rules/generated/02-api-contract-rules.md
  .claude/rules/generated/03-exception-logging-security-rules.md
  （按实际生成的文件列出）

{如果 apply_entry=true}
  ✅ CLAUDE.md / AGENTS.md 已更新（managed block 已写入）

  {如果 skip_hooks=false}
  ✅ Hooks 已安装: .claude/settings.json（PostToolUse）
     ① post-edit-rule-check.sh — 编辑 Java 文件后检查规则合规性
     ② post-edit-test.sh       — 合规后自动生成并运行单元测试

  {如果 skip_hooks=true}
  ⚠️  Hook 安装已跳过（--skip-hooks）

{如果 apply_entry=false}
  ⚠️  规则已生成但尚未激活。运行以下命令激活：
      /project-analyzer confirm {project_path} --apply-entry
```

---

## consolidate 流程

1. 读取 `{project_path}/CLAUDE.md` 和 `AGENTS.md`（若存在）
2. 提取 `<!-- project-analyzer:start -->` ... `<!-- project-analyzer:end -->` 块之外的规则内容
3. `--dry-run`：输出预览，不写文件
4. 非 dry-run：将提取内容写入 `.claude/rules/manual/existing-rules.md`，重写入口文件为精简版：

```markdown
# {项目名}

{一行描述（来自原文件的第一段）}

<!-- project-analyzer:start -->
Project-specific coding rules: `.claude/rules/generated/00-index.md`
Read the index first, then load only the rule file matching your task.
Also read `.claude/rules/manual/` when it exists.
<!-- project-analyzer:end -->
```

---

## 不做的事

- 不读取项目源码（由 agent 负责）
- 所有分析产物写入 `.claude/rules/analysis/`，不在 {project_path} 根目录生成文件
- 不修改 `.claude/rules/manual/` 目录（rule-writer 只写 generated/）
