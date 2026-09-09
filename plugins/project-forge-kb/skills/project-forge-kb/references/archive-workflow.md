# 归档工作流

对当前人工定义领域的每个项目文档，以及 `yuque-candidates.yaml` 中人工明确批准的每个语雀文档执行本流程。

## 1. 准备归档

不得对 `pending` 或 `rejected` 候选调用 `yuque_get_document`。任何 MCP 错误都必须停止流程并直接报告。

项目文档：

```bash
node <skill-dir>/scripts/archive-prepare.js --from-file <仓库相对 Markdown 路径> --name <稳定名称>
```

语雀文档：

```bash
node <skill-dir>/scripts/archive-prepare.js --from-yuque --document-url <url> --name <稳定名称>
```

`--doc-id <id>` 只用于过渡兼容。正常知识库建设必须使用已批准的 `document_url`。脚本输出 JSON：

- `action: skipped`：来源版本未变化，使用已有 archive。
- `action: staged`：继续处理返回的 `staging_path`。

不得归档未跟踪或有未提交修改的项目文档，否则无法确定其来源 commit。

## 2. 完成摘要

在 `staging_path` 内：

1. 按顺序读取 `chunks/*.md`。
2. 将每个 chunk frontmatter 的 `title` 替换为简洁、可搜索的名词短语。
3. 将每个 chunk 的 `summary` 替换为不超过 50 个中文字符的准确摘要；其他语言使用同等简洁的一句话。
4. 不得修改 chunk 正文。
5. 完成 `summary.md`：保留全部来源字段，提供 3 至 7 个 `keyTopics`、简短概述和 `## 涵盖内容` 列表。
6. 不得修改 `original.md` 或 `manifest.json`。

来源元数据属于权威机器数据。不得推断或修改 `source_commit`、`source_updated_at`、`source_hash`、`source_ref`、`doc_id` 或 `archived_at`。

## 3. 发布归档

```bash
node <skill-dir>/scripts/archive-publish.js --staging <staging_path>
```

摘要仍含 `TODO`、chunk 正文变化、必填元数据缺失或最终路径越出 archive 根目录时，发布必须失败。发布成功后，使用返回的不可变 archive 路径提取知识。

## 增量标记

- 项目文档：`git log -1 --format=%H -- <path>` 返回的 commit。
- 语雀文档：`yuque_get_document` 返回的 `content_updated_at`，缺失时回退到 `updated_at`。
- `source_hash`：只用于完整性校验和诊断，不作为主要变更标记。
