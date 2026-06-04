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

**执行：将控制权转给 `commands/project-analyzer.md`。**
