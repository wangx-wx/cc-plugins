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

由 P3C 扫描脚本内部确定：所有变更的 `.java` 文件，排除单元测试目录（`*/src/test/*`）。

## Diff 范围

由 P3C 扫描脚本内部使用 `{target}...{source}` 执行标准 code-review 三点 diff。若 `{target}` 与 `{source}` 没有共同祖先，脚本应失败退出；不得改用 `{target} {source}` 或其他 diff 范围重试。

## 执行步骤

1. 执行 P3C 扫描脚本：
   ```bash
   node {skill-path}/scripts/diff_scan.mjs {repo-path} --source {source} --target {target}
   ```
2. 若脚本退出码非 0，返回失败并保留脚本错误信息；不得自动降级 diff 范围。
3. 若脚本成功，直接返回脚本 stdout 中的 JSON 数组。
4. 不得对脚本结果进行增删、改写或补充其他违规项。
5. 不得自行执行额外 P3C 规则判断或人工补充 P3C 违规。

## 输出要求

- 返回脚本输出的 JSON 数组
- 无问题时返回空数组 `[]`
- 子代理必须直接透传脚本结果，不得为了适配报告格式而新增、删除或改写字段
