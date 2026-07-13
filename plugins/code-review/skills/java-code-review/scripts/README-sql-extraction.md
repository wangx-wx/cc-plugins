# MyBatis XML 变更 SQL 提取器

从 `{target}...{source}` 的 MyBatis Mapper XML 变更提取所属完整 statement 的模板 SQL 与
SQL 涉及的实表名，产出 `{ project, dataSources, dataSourcesAlias, gitlabUrl, items }` JSON
供下游 LLM SQL 分析消费。

## 调用

    node extract_mybatis_xml_changes.mjs \
      --repo-path <repo> --source <src> --target <tgt> \
      --project-mapping <mapping.json> \
      --output <out.json>

- `--output` 默认 `.code-review/sql-extraction/sql-extraction-result.json`（相对路径基于 `--repo-path`）。
- `--project-mapping` 指向一个 JSON 数组文件，每条描述一个项目：

      [
        {
          "project": "advert",
          "gitlabUrl": "https://gitlab.example.com/advert.git",
          "dataSources": ["advert-master", "advert-read"],
          "dataSourcesAlias": ["广告主库", "只读库"]
        }
      ]

## 数据源映射与匹配

脚本执行 `git ls-remote --get-url` 取仓库 remote url，归一化（去 `.git` 后缀、小写）后
与每条 `gitlabUrl` 同样归一化后比对，命中第一个相等的条目。匹配条目的 `project` /
`dataSources` / `dataSourcesAlias` / `gitlabUrl` 原样透传到顶层输出。

任一以下情况脚本报错退出，错误信息追加写入 `<output目录>/error.log`：

- 任一条目缺非空 `gitlabUrl`；
- 无任何条目命中（仓库 remote url 未在映射中找到）；
- 命中条目 `project` 为空；
- 命中条目 `dataSources` 为空或缺失；
- 命中条目 `dataSourcesAlias` 长度与 `dataSources` 不一致。

## 表提取

每条 item 的 `tables` 为该 statement 模板 SQL 涉及的实表名数组，提取规则：

- 覆盖 `FROM` / `JOIN` / `UPDATE` / `INSERT INTO` / `DELETE FROM` 后的表名；
- 去 alias：仅取首个 token（如 `user u` → `user`）；
- 去引号：去掉 `" ` `[ ]` 包裹（如 `"user"` → `user`、`[user]` → `user`）；
- 大小写保留原样（`User` 不归一化为 `user`）；
- 去重并保持首次出现顺序。

已知限制（本版）：

- 字符串字面量中出现的 `FROM xxx` / `JOIN xxx` 等可能被误识别为表名；
- `FROM a, b` 逗号分隔多表写法只取首个表名 `a`（正则只捕首个 token）；
- CTE (`WITH name AS (...)`) 的 CTE 名会被当作表名收录；
- 跨文件 `<include/>` 已在模板 SQL 中展开，但表名提取基于展开后的文本。

## 输出结构

    {
      "project": "advert",
      "gitlabUrl": "https://gitlab.example.com/advert.git",
      "dataSources": ["advert-master", "advert-read"],
      "dataSourcesAlias": ["广告主库", "只读库"],
      "items": [
        {
          "tables": ["user", "order"],
          "file": ".../AdvertMapper.xml:12",
          "templateSql": "SELECT * FROM user u JOIN order o ON u.id = o.user_id"
        }
      ]
    }

注：本版不再提取数据源归属（每条 item 不再有 `dataSource` / `dataSourcesAlia` /
`evidence` 字段），数据源信息仅在顶层以数组形式提供。亦不再写 `.debug-candidates.json`。

## 其他已知限制（本版）

- 跨文件 include 在模板 SQL 中已展开；无法解析的 include 保留原标签。
- 完整删除的 statement 不输出历史 SQL。
- 不还原运行时最终 SQL（`?` 占位符、动态 `<if>` 等保留模板形态）。

## 测试

    node --test "plugins/code-review/skills/java-code-review/scripts/test/**/*.test.mjs"
