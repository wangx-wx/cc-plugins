---
name: java-code-review
description: 对已有的 Java 代码进行审查，以确保其可重复使用性、质量和效率，然后生成审查报告。当用户提到代码审查、review、代码检查、合并前审查、MR 审查、PR 审查、代码质量检查、P3C 检查、Java 规范检查时，应使用此 skill。即使用户只是说"帮我看看代码"或"检查一下改动"，只要上下文是 Java 项目，都应触发此 skill。
allowed-tools: Bash(git:*), Bash(date:*), Bash(mkdir:*), AskUserQuestion, Agent, Read, Grep, Glob, Write
---

# Java Code Review

对两个分支之间所有变更文件进行多维度审查（P3C 静态分析、基础规范、配置文件、数据库 XML），最终生成一份结构化的审查报告。

## 阶段1：确认分支信息

1. 若 `$ARGUMENTS[0]` 非空，执行 `git show-ref --verify refs/heads/$ARGUMENTS[0] || git show-ref --verify refs/remotes/$ARGUMENTS[0]`，命令成功则 `{source}` = `$ARGUMENTS[0]`
2. 若 `$ARGUMENTS[1]` 非空，执行 `git show-ref --verify refs/heads/$ARGUMENTS[1] || git show-ref --verify refs/remotes/$ARGUMENTS[1]`，命令成功则 `{target}` = `$ARGUMENTS[1]`
3. 若 `{source}` 和 `{target}` 均已设置，跳过第 4-6 步直接继续
4. 执行 `git rev-parse --abbrev-ref HEAD` 获取当前分支名，作为 `{source}` 的默认值
5. `{target}` 默认值设为 `origin/master`，`{repo}` 默认值设为当前工作目录
6. 使用 AskUserQuestion 让用户确认或修改以下信息：
   - **source 分支**：默认当前分支
   - **target 分支**：默认 `origin/master`
   - **仓库路径**：默认当前工作目录

> 后续阶段中，`{source}` 代表最终确定的 source 分支，`{target}` 代表最终确定的 target 分支，`{repo-path}` 代表仓库路径。
> `{skill-path}` = ${CLAUDE_SKILL_DIR}

## 阶段2：确定严格 Diff 范围

主 Agent 不执行检查，但必须把以下 diff 规则完整传递给每个子 Agent。旧版 `scripts/*.mjs` 脚本保留在仓库中作为历史工具，不作为本流程的必需依赖。

每个子 Agent 必须独立执行以下步骤来确定 `{diff-revisions}`：

1. 执行 `git -C {repo-path} merge-base {target} {source}`
2. 若命令成功且输出非空，`{diff-revisions}` = `{target}...{source}`
3. 若命令失败或输出为空，终止审查并返回失败：`{target}` 与 `{source}` 没有共同祖先，无法执行标准 code-review 三点 diff；不得自动降级为两分支文件树直接比较

每个子 Agent 获取文件和变更内容时必须遵守：

1. 只使用 `git -C {repo-path} diff --name-only --diff-filter=ACMR {diff-revisions} -- <pathspec...>` 获取候选文件
2. 只使用 `git -C {repo-path} diff -U0 --diff-filter=ACMR {diff-revisions} -- <pathspec...>` 获取变更行
3. 只审查候选文件中的新增或修改行；不得因为同一文件被修改就报告未变更行上的历史问题
4. 删除文件、未变更文件、diff 上下文行不得产生违规结果

## 阶段3：并行启动 4 个 Review Agents

使用 Agent tool 在一条消息中同时启动 4 个Agent（`subagent_type: "general-purpose"`），每个代理独立完成各自的检查任务并返回结果，主 Agent 不参与具体的检查过程，仅负责收集结果。

启动每个子 Agent 前，主 Agent 必须读取对应的 `agents/*.md` 文件，并将文件完整内容作为该子 Agent 的任务指令，同时传入 `{source}`、`{target}`、`{repo-path}`、`{skill-path}`。

每个子代理返回的结果是 JSON 数组，格式遵循 [assets/example-agent-output.md](assets/example-agent-output.md) 中定义的 schema。无问题时返回空数组 `[]`。

> **规则约束**：
> 1. 除 Agent 1 外，每个子代理必须先读取对应的参考规则文件，仅使用文件中定义的规则进行检查，返回结果中的 ruleId 必须与参考文件中的编号完全一致。
> 2. 只对严格 diff 范围内的新增或修改行进行检查，未变更的文件和未变更行不应产生任何违规结果。
> 3. 每个子代理自行使用 Git 命令获取 diff，不依赖 `scripts/*.mjs`。

并行启动以下 4 个子 Agent：

1. **P3C 规范检查**：读取并使用 `{skill-path}/agents/p3c-analyzer.md`
2. **Java 规范检查**：读取并使用 `{skill-path}/agents/java-standards-reviewer.md`
3. **配置文件检查**：读取并使用 `{skill-path}/agents/config-review.md`
4. **数据库 XML 检查**：读取并使用 `{skill-path}/agents/db-xml-reviewer.md`

## 阶段4：汇总输出并保存审查报告

收集所有 Agent 返回的 JSON 数组结果，按以下步骤生成最终报告：

1. **合并结果**：将 4 个 Agent 的 JSON 数组合并为一个结果报告
2. **分级排列**：按 `blockLevel` 严重程度排序：Blocker → Critical → Major → Minor
3. **生成报告**：按照 [assets/example-output.md](assets/example-output.md) 的格式输出最终 Markdown 报告，包含：
   - 审查范围（分支信息）
   - 统计（每个级别的问题数量）
   - 优势（变更中做得好的方面）
   - 按级别分组的问题展示（每个问题包含规则编号、位置、代码片段、影响、修复建议）
      - P3C 违规问题展示时，需要标记是P3C检查结果
   - 清单覆盖情况
   - 建议
   - 是否可合并的评估结论
