# MyBatis XML 变更 SQL 提取器

从 `{target}...{source}` 的 MyBatis Mapper XML 变更提取所属完整 statement 的模板 SQL，
附数据源归属，产出 `{ project, gitlabUrl, items }` JSON 供下游 LLM SQL 分析消费。

## 调用

    node extract_mybatis_xml_changes.mjs \
      --repo-path <repo> --source <src> --target <tgt> \
      --project-mapping <mapping.json> \
      --output <out.json>

`--project-mapping` 指向一个 JSON 数组文件，每条描述一个项目：

    [
      {
        "project": "advert",
        "gitlabUrl": "https://gitlab.example.com/advert.git",
        "dataSources": ["advert-master", "advert-read"],
        "dataSourcesAlias": ["广告主库", "只读库"]
      }
    ]

匹配规则：脚本执行 `git ls-remote --get-url` 取仓库 remote url，归一化（去 `.git` 后缀、小写）
后与每条 `gitlabUrl` 同样归一化后比对，命中第一个相等的条目。任一条缺非空 `gitlabUrl`、
无任何条目命中、命中条目 `dataSources` 为空、或 `dataSourcesAlias` 长度与 `dataSources` 不一致，
脚本报错退出，错误信息追加写入 `<output目录>/error.log`。

## 归属优先级

`dataSources[0]` 为默认主数据源。归属优先级：

方法级 @DS > 接口级 @DS > Service 唯一调用方 @DS > default-first（取 dataSources[0]）。

候选项需 ∈ `dataSources`，否则按下一优先级继续判定；全部不命中则降级 default-first。
调试文件 `<output目录>/.debug-candidates.json` 记录每条 `evidence` 来源。

最终输出结构：

    { "project": "advert", "gitlabUrl": "https://gitlab.example.com/advert.git",
      "items": [ { "dataSource": "advert-master", "dataSourcesAlia": "广告主库",
                   "file": ".../AdvertMapper.xml", "templateSql": "SELECT ..." } ] }

## 已知限制（本版）

- 多数据源 + @DS 在 Service 的复杂写法（构造注入、lombok、跨方法转发）识别不出，
  降级 default-first，归属可能不准。
- 一个 Mapper 方法被多个不同 @DS 调用（多义）时降级 default-first。
- 跨文件 include 不展开，输出 `<include/>`。
- 完整删除的 statement 不输出历史 SQL。
- 不还原运行时最终 SQL。
- `gitlabUrl` 不匹配 / `dataSources` 缺失或空 / `dataSourcesAlias` 长度不等时脚本报错退出，
  错误追加写入 `<output目录>/error.log`。

## 测试

    node --test "plugins/code-review/skills/java-code-review/scripts/test/**/*.test.mjs"
