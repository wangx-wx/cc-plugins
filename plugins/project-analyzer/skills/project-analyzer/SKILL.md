---
name: project-analyzer
description: 分析 Java 微服务项目，提取编码约束，生成 AI 可消费的规则文件（.claude/rules/generated/）。与 project-readme 不同：本插件输出约束规则，不是项目简介。
argument-hint: "[分析类型 analyze|confirm|consolidate] [project_path] [--focus=...] [--apply-entry] [--dry-run]"
triggers:
  - "分析.*项目规则"
  - "生成.*编码规则"
  - "生成.*编码约束"
  - "分析.*Java.*规则"
  - "project-analyzer"
---

# Project Analyzer

从 Java 微服务项目代码中提取**项目特有**的编码约束，生成 `.claude/rules/generated/` 规则文件。

**目标**：AI 按规则写出的代码，团队成员认为在模块位置、API 契约、异常日志、健壮性四个方面符合项目风格。

## 使用方式

```
/project-analyzer analyze <project_path> [--focus=arch|api|security|robustness|db|cache|mq|testing|all]
/project-analyzer confirm <project_path> [--apply-entry]
/project-analyzer consolidate <project_path> [--dry-run]
```

**analyze** — 读取项目代码，提取候选规则。高置信度规则直接就绪，不确定的写入 `confirmation-required.md` 供审阅。

**confirm** — 应用已确认的规则，写入 `.claude/rules/generated/*.md`，可选更新入口文件（`--apply-entry`）。

**consolidate** — 将现有 CLAUDE.md/AGENTS.md 内容迁移到 `.claude/rules/manual/`，精简入口文件。

## 执行

识别子命令（`analyze` | `confirm` | `consolidate`）与参数后，按 `${CLAUDE_PLUGIN_ROOT}/references/workflow.md`（三流程唯一真源）执行对应流程。workflow.md 会先按当前宿主确定产物路径（Claude→`.claude/rules/`，Codex→`.agent-rules/`）、入口文件（Claude→`CLAUDE.md`，Codex→`AGENTS.md`）与子 agent 调度方式（支持则派发，否则内联执行 `agents/*.md` 规范）。

> Claude Code 也可用 `/project-analyzer <subcommand> <project_path>` 命令触发同一流程。
