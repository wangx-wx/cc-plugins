# MyBatis XML 变更 SQL 提取器

从 `{target}...{source}` 的 MyBatis Mapper XML 变更提取所属完整 statement 的模板 SQL，
附数据源归属，产出 `{ project, items }` JSON 供下游 LLM SQL 分析消费。

## 调用

    node extract_mybatis_xml_changes.mjs \
      --repo-path <repo> --source <src> --target <tgt> \
      --project <id> --data-source-context <ctx.json> \
      --output <out.json>

规范化数据源上下文 `ctx.json`：

    { "project": "advert", "defaultDataSource": "advert-master",
      "dataSources": ["advert-master", "advert-read"] }

## 归属优先级

方法级 @DS > 接口级 @DS > Service 唯一调用方 @DS > defaultDataSource。
调试文件 `<output目录>/.debug-candidates.json` 记录每条 `evidence` 来源。

## 已知限制（本版）

- 多数据源 + @DS 在 Service 的复杂写法（构造注入、lombok、跨方法转发）识别不出，
  降级 `default-fallback`，归属可能不准。
- 一个 Mapper 方法被多个不同 @DS 调用（多义）时降级 `default-fallback`。
- 跨文件 include 不展开，输出 `<include/>`。
- 完整删除的 statement 不输出历史 SQL。
- 不还原运行时最终 SQL。

## 测试

    node --test plugins/code-review/skills/java-code-review/scripts/test/
