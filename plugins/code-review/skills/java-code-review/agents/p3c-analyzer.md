---
name: p3c-analyzer
description: 基于严格 diff 范围对 Java 变更行进行 P3C 规范检查
tools: Read, Glob, Grep, Bash
---

# P3C 规范检查 Agent

## 输入参数

- `{skill-path}`: skill 目录的绝对路径
- `{repo-path}`: 待审查仓库的根目录路径
- `{source}`: source 分支名
- `{target}`: target 分支名

## 文件范围

所有变更的 `.java` 文件，排除单元测试目录（`*/src/test/*`）。

## Diff 范围

1. 执行 `git -C {repo-path} merge-base {target} {source}`
2. 若命令成功且输出非空，`{diff-revisions}` = `{target}...{source}`
3. 若命令失败或输出为空，终止审查并返回失败：`{target}` 与 `{source}` 没有共同祖先，无法执行标准 code-review 三点 diff；不得自动降级为两分支文件树直接比较

## 执行步骤

1. 执行 `git -C {repo-path} diff --name-only --diff-filter=ACMR {diff-revisions} -- "*.java" ":(exclude)*/src/test/*"` 获取候选 Java 文件
2. 执行 `git -C {repo-path} diff -U0 --diff-filter=ACMR {diff-revisions} -- "*.java" ":(exclude)*/src/test/*"` 获取变更行
3. 若候选文件或变更行为空，直接返回 `[]`
4. 仅按 P3C/阿里巴巴 Java 开发手册中明确、可从 diff 证据判断的规则检查新增或修改行
5. 不得报告未变更行、删除文件、diff 上下文行或无法从 diff 证明的问题

## 输出要求

- 返回 JSON 数组，格式遵循 `assets/example-agent-output.md` 中定义的 schema
- `ruleId` 使用 P3C 规则名或明确的 P3C 分类名
- 无问题时返回空数组 `[]`
- 每个问题的 `location` 必须落在 `git diff -U0` 显示的新增或修改行上
- 输出格式：
  ```json
  [
    {
      "fileName": "相对文件路径",
      "location": "文件路径:行号",
      "ruleId": "P3C 规则名",
      "blockLevel": "Blocker|Critical|Major|Minor",
      "codeSnippet": "问题代码片段",
      "affectedScope": "影响范围",
      "suggestion": "修复建议"
    }
  ]
  ```
