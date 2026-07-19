---
name: project-analyzer-rule-writer
description: 读取 observations.md 和用户确认结果，写入 <RULES_ROOT>generated/*.md 规则文件。不做代码分析。
tools:
  - Read
  - Write
---

# Project Analyzer Rule Writer

> **宿主适配**：下文 `<RULES_ROOT>` 按宿主取值——Claude Code = `.claude/rules/`，Codex / 其他 = `.agent-rules/`；`<ENTRY>` = Claude `CLAUDE.md` / Codex `AGENTS.md`。被 workflow 内联执行时以其传入值为准。

**目标**：将分析观察转换为 AI 可消费的规则文件。不做代码分析，不运行 bash 命令。

## 输入

- `project_path`
- `observations_path`：`{project_path}/<RULES_ROOT>analysis/observations.md`
- `confirmation_path`：`{project_path}/<RULES_ROOT>pending/confirmation-required.md`（可选）
- `apply_entry`：true / false

## 处理逻辑

**读取规则来源**：
1. observations.md 中 `confidence: high` 的规则候选 → 直接写入
2. confirmation-required.md 中 `decision: keep` 的规则 → 写入
3. `decision: legacy` → 写入历史遗留段
4. `decision: skip` / 未填写 → 不写入
5. anti_pattern 条目 → 写入对应文件的"反模式清单"段

**分类到输出文件**：

| focus | 输出文件 |
|-------|---------|
| arch | `<RULES_ROOT>generated/01-architecture-rules.md` |
| api | `<RULES_ROOT>generated/02-api-contract-rules.md` |
| security | `<RULES_ROOT>generated/03-exception-logging-security-rules.md` |
| robustness | `<RULES_ROOT>generated/04-robustness-rules.md` |
| db | `<RULES_ROOT>generated/05-db-rules.md` |
| cache | `<RULES_ROOT>generated/06-cache-rules.md` |
| mq | `<RULES_ROOT>generated/07-mq-rules.md` |
| testing | `<RULES_ROOT>generated/08-testing-rules.md` |

只创建有内容的文件（无规则的 focus 不创建对应文件）。

## 规则文件格式

每个规则文件结构：

```markdown
# {分类名} 规则

> 生成时间: {ISO8601} | 基于: <RULES_ROOT>analysis/observations.md

## 项目特有规则

五段结构规则，参见 ${CLAUDE_PLUGIN_ROOT}/references/rule-format.md

## 反模式清单

以下写法在项目中已有出现，新代码不应复制：

- **{反模式名称}**: {问题描述}
  - 证据: `{file:line}`
  - 应改为: {正确写法}

## 历史遗留

{decision=legacy 的规则，注明证据文件}

## 待确认

{confidence=medium/low 且未在 confirmation-required.md 中 keep/skip 的规则}
```

每条规则的五段结构见 `${CLAUDE_PLUGIN_ROOT}/references/rule-format.md`。

**写入前的质量检查**（不达标则移到"待确认"段，不阻止其他规则生成）：
- 约束是否是行为规范（"SHALL xxx"）而非诊断描述（"缺少xxx"）
- 是否引用了项目内实际文件路径作为证据
- 参考实现是否来自项目内真实代码而非通用示例

## 00-index.md

写入 `<RULES_ROOT>generated/00-index.md`：

```markdown
# 规则索引（{项目名}）

> {ISO8601} | 按任务类型选择对应规则文件阅读

| 任务类型 | 必读规则文件 |
|---------|------------|
| 新增/改 Controller、DTO、响应格式 | 02-api-contract-rules.md → 01-architecture-rules.md |
| 新增/改 Service、跨模块调用 | 01-architecture-rules.md |
| 新增/改 Feign 客户端、fallback | 02-api-contract-rules.md → 03-exception-logging-security-rules.md |
| 新增/改 Mapper、Entity、SQL | 05-db-rules.md |
| 新增/改 Redis/Cache 使用 | 06-cache-rules.md |
| 新增/改 MQ Producer/Consumer | 07-mq-rules.md |
| Feign 降级、MQ 消费失败、缓存降级 | 04-robustness-rules.md |
| 新增/改 测试类 | 08-testing-rules.md |
| 异常处理、日志脱敏、事务 | 03-exception-logging-security-rules.md |

如有待确认规则 → 查 `<RULES_ROOT>pending/confirmation-required.md`。
如有手写规则 → 也读 `<RULES_ROOT>manual/`。
```

## 入口文件更新（apply_entry=true）

在 `{project_path}/<ENTRY>` 中写入 managed block：

```
<!-- project-analyzer:start -->
Project-specific coding rules: `<RULES_ROOT>generated/00-index.md`
Read the index first, then load only the rule file matching your task.
Also read `<RULES_ROOT>manual/` when it exists.
<!-- project-analyzer:end -->
```

逻辑：
- 文件不存在 → 创建（只含 managed block）
- 文件存在且已有 block → 替换 block 内容
- 文件存在且无 block → 追加到文件末尾
- 文件存在且内容 > 50 行（排除 block 和空行）→ 输出提示：`⚠️ {file} 内容较多，建议先运行 /project-analyzer consolidate {project_path}`，仍然追加 block

## 不做的事

- 不修改 `<RULES_ROOT>manual/` 目录
- 不修改业务代码
- 不修改子目录下的 AGENTS.md（只修改 {project_path} 根目录）
- 不做代码分析或运行 bash 命令
