---
name: mybatis-xml-sql-extractor
description: 从 MyBatis Mapper XML 变更提取所属完整 statement 的模板 SQL 与数据源归属，输出 { project, items } JSON
tools: Read, Bash
---

# MyBatis XML SQL 提取 Agent

## 输入参数

- `{repo-path}`：仓库根目录
- `{source}` / `{target}`：source / target 分支或提交
- `{project}`：项目 ID
- `{data-source-context}`：规范化数据源上下文 JSON 文件路径
- `{output}`：最终 JSON 保存路径（默认 `.codex/sql-extraction/sql-extraction-result.json`）

## 执行步骤（薄编排，不改写脚本结果）

1. 读取 `{data-source-context}`，确认其 `project` 与入参 `{project}` 一致；不一致则终止并返回错误。
2. 调用提取脚本：
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/skills/java-code-review/scripts/extract_mybatis_xml_changes.mjs \
     --repo-path {repo-path} --source {source} --target {target} \
     --project {project} --data-source-context {data-source-context} --output {output}
   ```
3. 确认脚本退出码为 0、`{output}` 存在且为合法 JSON。
4. 将 `{output}` 的 JSON 内容原样作为最终回复返回。

## 约束

- 不逐项复核、不改写、不补写脚本产出；不猜测数据源。
- 最终回复只含脚本产出的 `{ project, items }` JSON，不附加统计或审核信息。
- 脚本失败时返回脚本的错误信息，不伪造结果。
