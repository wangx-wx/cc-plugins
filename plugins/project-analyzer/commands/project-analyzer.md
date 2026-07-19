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

Claude Code 侧的 slash 入口。三个子命令的**完整流程定义在共享真源** `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`（Claude command 与 Codex skill 共用同一份，避免逻辑重复）。

## 参数

- subcommand: {{subcommand}}（analyze | confirm | consolidate）
- project_path: {{project_path}}
- focus: {{focus}}（arch | api | security | robustness | db | cache | mq | testing | all）
- apply_entry: {{apply_entry}}
- dry_run: {{dry_run}}
- skip_hooks: {{skip_hooks}}

## 执行

当前宿主为 **Claude Code**：`RULES_ROOT` = `.claude/rules/`，`ENTRY` = `CLAUDE.md`，子 agent 用 Task 派发（`project-analyzer-scanner` / `project-analyzer-analyst` / `project-analyzer-rule-writer`）。

读取 `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`，按 `{{subcommand}}` 执行对应流程，代入以上参数与宿主取值。
