# MyBatis XML 变更 SQL 提取 Agent 技术方案

## 1. 范围与目标

本版只处理 **MyBatis Mapper XML 文件中的 SQL 变更**。不提取 Java 注解 SQL、普通 `.sql` 文件或 MyBatis-Plus wrapper；后两类能力仅列入后续演进。

目标流程：

```text
target...source 的 XML diff
        ↓
定位 source 版本中所属的完整 MyBatis statement
        ↓
根据 Mapper 的 @DS 和项目数据源映射解析数据源
        ↓
移除动态 XML 标签属性，保留完整 SQL 结构
        ↓
Agent 审核提取结果
        ↓
保存并返回 JSON 对象
```

例如只增加了一个动态条件：

```xml
<if test="status != null">
  AND status = #{status}
</if>
```

最终输出必须是它所在的完整 `<select>`、`<insert>`、`<update>` 或 `<delete>` 的 SQL 内容，而不是该条件的局部片段。

### 1.1 本版非目标

- SQL 风险、索引、性能、EXPLAIN 或数据库连接；
- Java 注解 SQL、Provider 方法、Kotlin SQL；
- MyBatis-Plus `QueryWrapper` / `LambdaQueryWrapper`；
- 根据运行时参数还原唯一的最终 SQL；
- 完整删除且在 source 中已不存在的 statement 的历史 SQL。

## 2. 关键设计决策

### 2.1 diff 只用于触发，完整 source 文件用于提取

使用 `{target}...{source}` 三点 diff 找到变更 XML 行。随后读取 source 版本的完整 Mapper XML，以 statement 的真实边界提取 SQL。

这样“只新增一行 `AND` 条件”的变更也会输出完整 SQL。

### 2.2 XML 标签保留结构，移除属性

statement 外层 `<select>`、`<insert>`、`<update>`、`<delete>` 只是容器，不进入 `templateSql`。statement 内的 MyBatis 动态标签保留标签结构，但移除所有属性：

```xml
<if test="status != null">              -> <if>
<when test="type == 'A'">               -> <when>
<foreach collection="ids" item="id">   -> <foreach>
<trim prefix="WHERE" prefixOverrides="AND"> -> <trim>
<include refid="baseColumns"/>           -> 同文件可解析时展开；否则 <include/>
```

`#{param}` 统一转换为 `?`；`${param}` 原样保留。最终 SQL 压缩连续空白为一个空格，但标签成对保留，例如：

```text
SELECT id, name FROM user <where> <if> AND status = ? </if> </where>
```

这保留了完整 SQL 的动态结构，同时不暴露 `test`、`collection` 等 XML 标签参数。

### 2.3 数据源必须可证实，不能猜测

每条输出都要带项目名和数据源名。数据源解析的优先级为：

```text
Mapper 方法上的 @DS("name")
  > Mapper 接口上的 @DS("name")
  > 项目配置中的 defaultDataSource
```

解析到的名称必须存在于该项目的 `dataSources` 列表。否则该项不输出，只记入内部日志，避免把 SQL 错误归属到默认数据源。

单数据源项目不会有 `@DS` 注解；这属于正常情况。此时脚本不再尝试从 Java 查找注解，直接使用规范化数据源上下文中的 `defaultDataSource`。只有配置声明为多数据源，或 Mapper/interface/method 上存在 `@DS` 时，才执行 `@DS` 解析与优先级覆盖。

本版假设多数据源的归属信息可从 Mapper 方法或 Mapper 接口的 `@DS` 直接获得；未标注时使用项目默认数据源。若 `@DS` 只标在 Service 调用方，同一个 Mapper statement 可能在不同调用路径使用不同数据源，单靠 XML 无法唯一归属，必须在实施前确认是否需要 Java 调用链分析。

### 2.4 脚本提取、Agent 审核、输出保持极简

脚本负责确定性定位和提取。Agent 读取临时候选数据，核查 diff 命中、statement 边界、数据源归属和 SQL 模板是否一致。

Agent 不改写脚本结果，不推测遗漏 SQL。最终回复和保存的 JSON 文件只包含项目名与审核通过的 SQL 列表，不包含统计、状态或审核信息。

## 3. 配置设计

### 3.1 项目识别

项目名和项目—数据源映射由外部调用方提供；其存储位置与文件格式尚未确定。本方案不依赖任何本地项目地图，也不预设 YAML、JSON 或配置中心实现。

本方案只定义传给提取脚本的**规范化数据源上下文**。外部映射格式确定后，通过单独的适配层将其转换为该上下文；适配层不属于 XML SQL 提取逻辑。

### 3.2 项目与数据源映射

外部映射只需提供数据源逻辑名称，不应包含 JDBC URL、用户名、密码或其他凭据。无论外部格式为何，传入脚本的规范化上下文固定为：

```json
{
  "project": "advert",
  "defaultDataSource": "advert-master",
  "dataSources": ["advert-master", "advert-read"]
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `project` | 当前执行对应的项目 ID |
| `defaultDataSource` | 未发现可用 `@DS` 时的默认数据源 |
| `dataSources` | 该项目允许输出的数据源名称列表 |

上下文校验规则：`project` 为空或 `defaultDataSource` 不在 `dataSources` 内时，脚本直接失败；不会降级到任意默认值。

## 4. 输入与输出契约

### 4.1 Agent 输入

| 参数 | 含义 |
|---|---|
| `repo-path` | 待审查仓库根目录 |
| `source` | source 分支或提交 |
| `target` | target 分支或提交 |
| `project` | 项目 ID，由调用方提供 |
| `data-source-context` | 由外部映射适配后生成的规范化数据源上下文 |
| `output` | 最终 JSON 保存路径 |

默认输出路径：

```text
.codex/sql-extraction/sql-extraction-result.json
```

### 4.2 最终 JSON

Agent 的最终回复与保存文件内容完全一致，都是 JSON 对象：

```json
{
  "project": "advert",
  "items": [
    {
      "dataSource": "advert-read",
      "file": "src/main/resources/mapper/ReportMapper.xml:12",
      "templateSql": "SELECT id, name FROM user <where> <if> AND status = ? </if> </where>"
    }
  ]
}
```

字段定义：

| 字段 | 含义 |
|---|---|
| `project` | 顶层字段，当前执行的项目 ID |
| `items` | 当前项目中审核通过的 SQL 变更列表 |
| `items[].dataSource` | 由 `@DS` 和规范化数据源上下文解析出的数据源逻辑名称 |
| `items[].file` | 相对仓库根目录的 XML 文件路径，后接 `:` 和 statement 起始行 |
| `items[].templateSql` | 完整 statement 的 SQL 内容；动态 XML 标签保留但不带属性 |

没有 XML SQL 变更、数据源无法确认或 Agent 审核未通过时，输出 `{ "project": "<当前项目>", "items": [] }`。

## 5. XML 与数据源解析设计

### 5.1 Diff 与 XML statement 定位

1. 执行 `git merge-base {target} {source}`；没有共同祖先立即失败。
2. 执行 `git diff --name-only --diff-filter=ACMR {target}...{source} -- "*.xml"`。
3. 排除 `pom.xml`，再用文件内容或路径确认它是 MyBatis Mapper XML；非 Mapper XML 跳过。
4. 执行 `git diff -U0`，取得 source 侧的变更行。
5. 从 source 版本完整文件中定位包含变更行的 `<select>`、`<insert>`、`<update>`、`<delete>`。
6. 多个变更行命中同一 statement 时只输出一次。

纯删除条件但 statement 仍在 source 中时，使用删除 hunk 的 source 插入锚点定位该 statement，输出变更后的完整 SQL。整个 statement 被删除时不输出。

### 5.2 MyBatis XML 解析器

解析器采用字符流与标签栈，不使用整段正则。必须正确跳过 XML 注释、CDATA 和属性字符串中的伪标签，并记录每个 statement 的起止行。

支持：

```text
<select> <insert> <update> <delete>
<sql> <include>
<if> <choose> <when> <otherwise>
<foreach> <where> <trim> <set> <bind>
```

处理规则：

1. 去掉 statement 外层标签及其属性。
2. 保留内部动态标签名称，删除开始标签中的全部属性。
3. 同一个 Mapper 文件内的 `<include refid="..."/>` 递归展开为对应 `<sql>` 片段。
4. 跨文件 include、找不到的 refid 或循环引用输出 `<include/>`，不猜测内容。
5. `#{...}` 转为 `?`；`${...}` 保留。
6. 压缩连续空白，保留 SQL 中原有字符串字面量内容。

XML 无法确定完整 statement 边界时，跳过该项，不输出截断 SQL。

### 5.3 Mapper namespace 与 `@DS` 解析

MyBatis XML 的 `<mapper namespace="...">` 必须是 Mapper 接口的全限定类名。例如：

```xml
<mapper namespace="cn.lyy.advert.mapper.ReportMapper">
  <select id="list">...</select>
</mapper>
```

脚本在 source 版本中定位对应 Java 接口文件，并只做数据源注解读取，不提取 Java SQL：

1. 读取接口声明上的 `@DS("...")`。
2. 读取与 XML statement `id` 同名的方法上的 `@DS("...")`。
3. 支持导入后的 `@DS` 与全限定名 `@com.baomidou.dynamic.datasource.annotation.DS(...)`。
4. 仅接受字符串字面量参数，如 `@DS("advert-read")`；表达式、常量引用或 SpEL 视为无法确认。
5. 按第 2.3 节优先级解析并校验数据源名称。

若项目是单数据源且没有 `@DS`，第 1 至 4 步不执行，直接采用 `defaultDataSource`。

若 XML 的 statement `id` 无对应方法，则跳过方法级 `@DS`，继续采用接口级或项目默认数据源。

## 6. 脚本与 Agent 设计

### 6.1 脚本

建议新增：

```text
plugins/code-review/skills/java-code-review/scripts/extract_mybatis_xml_changes.mjs
```

调用示例：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/java-code-review/scripts/extract_mybatis_xml_changes.mjs \
  --repo-path {repo-path} \
  --source {source} \
  --target {target} \
  --project {project} \
  --data-source-context {normalized-data-source-context.json} \
  --candidate-output .codex/sql-extraction/.tmp/candidates.json
```

脚本模块：

```text
extract_mybatis_xml_changes.mjs
├── parseArguments
├── loadDataSourceContext
├── resolveDiff
├── readSourceAtRevision
├── parseMapperXml
├── resolveIncludes
├── resolveMapperDataSource
├── normalizeXmlSql
├── buildCandidates
└── writeCandidates
```

脚本输出临时候选项，包含 XML 原文范围、命中 diff 行、Mapper namespace、statement id、解析的数据源与 `templateSql`。该文件仅供 Agent 审核，完成后删除。

数据源的职责划分如下：

- 外部适配层：将格式待定的项目—数据源映射转换为规范化数据源上下文；
- 脚本：从 Mapper interface/method 的 `@DS` 提取数据源名称，并按第 2.3 节优先级结合上下文确定每条 SQL 的 `dataSource`；
- Agent：检查脚本记录的 `@DS` 来源、优先级和上下文校验结果是否正确，不自行解析或猜测数据源。

### 6.2 Agent

建议新增：

```text
plugins/code-review/agents/mybatis-xml-sql-extractor.md
```

Agent 执行步骤：

1. 接收调用方提供的 `project` 和规范化数据源上下文；不依赖本地项目地图。
2. 校验数据源上下文中的项目 ID 与 `project` 一致。
3. 调用提取脚本。
4. 逐项审核：diff 命中、statement 范围、XML 标签属性清理、Mapper namespace、`@DS` 优先级与数据源配置校验。
5. 将通过项转换为第 4.2 节的 JSON 对象，保存到 `output`。
6. 最终只返回该 JSON 对象。

Agent 不得补写 SQL、猜测数据源或在最终输出中附加审核信息。审核失败项只记录在内部日志。

## 7. 本版实施行动计划

| 步骤 | 工作内容 | 验证方式 |
|---|---|---|
| 1 | 固化规范化数据源上下文契约和最终 JSON 对象 schema | 校验缺项目、未知数据源、默认数据源非法时失败 |
| 2 | 实现三点 diff 与 MyBatis Mapper XML 文件识别 | fixture 覆盖空 diff、非 Mapper XML、修改与删除条件 |
| 3 | 实现 XML 标签栈、statement 行号和完整 SQL 提取 | 单行修改 `<if>` 时返回完整 select；insert/update/delete 均覆盖 |
| 4 | 实现标签属性清理、参数占位符和 include 展开 | 断言 `<if test>` 变为 `<if>`，同文件 include 正确展开 |
| 5 | 实现 namespace、Mapper 接口与方法 `@DS` 解析 | 验证方法级优先于接口级，未标注时使用默认值 |
| 6 | 实现临时候选、Agent 审核与 JSON 保存 | 人工构造错误范围或未知数据源，确认不会出现在最终 `items` |
| 7 | 接入插件 manifest、补充使用文档和 Git fixture 回归测试 | 全量 fixture 稳定通过，输出文件内容与 Agent 回复一致 |

本版验收标准：

1. XML 中任意动态条件变更均能输出完整所属 statement。
2. `templateSql` 中动态 XML 标签无属性，如 `<if>`、`<foreach>`。
3. 每条结果都有正确的 `project` 与可配置验证的数据源。
4. 方法级和接口级 `@DS` 的优先级正确。
5. 最终输出为包含 `project` 与 `items` 的 JSON 对象，并已保存到指定文件。

## 8. 后续版本演进

### 8.1 XML 能力增强

1. 支持跨 Mapper 文件的 `<include>` 解析。
2. 支持配置化 XML namespace 到 Mapper 接口路径的映射。
3. 支持保留完整删除 statement 的 `beforeTemplateSql` 与 `changeType`。
4. 支持可选的 XML 格式校验和更多 MyBatis 标签。

### 8.2 Java 与 MyBatis-Plus wrapper SQL

在 XML 提取稳定后，再新增独立的 Java wrapper 提取器，不与本版 XML 提取器混合。

演进路径：

1. 引入 Java AST（Tree-sitter Java 或 JavaParser）定位变更行所属方法及调用链。
2. 在单方法、局部变量范围内识别 `QueryWrapper`、`LambdaQueryWrapper`、`Wrappers.lambdaQuery()` 等构造与调用。
3. 收集 `eq`、`like`、`in`、`orderBy`、`set` 等调用，生成近似 SQL 模板。
4. 从 `@TableName`、`@TableField` 和项目约定解析表名、列名；无法确认时保留占位符，不猜测。
5. 解析 `@DS`、Mapper 执行点和 service 调用路径，将 wrapper SQL 归属到正确数据源。
6. 逐步扩展到跨方法 wrapper 传递和受限 Provider 方法；无法证明的数据流继续跳过。

该阶段仍以“结构化、可审查的近似 SQL”为目标；若需要真正运行时 SQL，应另行接入受控环境的 MyBatis `BoundSql` 捕获。
