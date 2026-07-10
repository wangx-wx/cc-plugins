# MyBatis XML 变更 SQL 提取器 · 技术设计

> 本文档由 `sql-extraction-plan.md` 经协作讨论修订而来。原方案文件保留，本文档为定稿设计。
> 讨论中相对原方案的改动，均在下方「决策摘要」和正文 **【改】** 标记处注明。

## 0. 决策摘要（本次讨论确定）

| # | 决策点 | 结论 | 理由 |
|---|---|---|---|
| D1 | 下游消费者 | 提取结果喂给**下游一个 LLM SQL 分析 agent** 做风险/索引/性能判断；本版只做前置数据准备，不做任何 SQL 分析 | 原方案未交代「为什么提取」，补齐后所有格式决策才有依据 |
| D2 | `templateSql` 格式 | **保持原方案 2.2**：保留动态标签、去属性、`#{}`→`?`、`${}`保留、压缩空白 | 下游是 LLM，保留 `<if>` 等分支能帮它理解动态 SQL，不会误判为恒定条件 |
| D3 | 数据源归属链 | `方法级 @DS > 接口级 @DS > Service @DS（仅唯一调用方）> defaultDataSource` | 用户要求在 default 前多找一层 Service |
| D4 | 归属证明不了时 | **default 兜底、照常输出**（接受多数据源项目可能误归属）；候选/调试文件记录归属证据来源，对外 JSON 不变 | 优先保证每条变更 SQL 都交付下游；用证据日志保留可追溯性 |
| D5 | Service 层实现 | **grep 保守版**：找注入字段名→grep 调用点→有限回溯读方法/类 `@DS`；仅识别干净且唯一时采用，其余降级 default | 与「唯一调用方才采用」的保守取向一致；不引入重型 Java AST（留 8.2） |
| D6 | XML 解析 | **vendor 零依赖单文件 sax 解析器**到 `scripts/lib/`，替代原方案的手写字符流状态机 | 天然正确处理注释/CDATA/属性转义，带行号；工作量与出错面远小于手写 |
| D7 | 脚本 vs Agent 职责 | 脚本**直接产出最终 JSON**；Agent 是**薄编排层**，不逐项复核确定性输出 | 提取是确定性计算，正确性靠脚本 + fixture 回归，而非 LLM 复核 |

---

## 1. 范围与目标

本版只处理 **MyBatis Mapper XML 文件中的 SQL 变更**。不提取 Java 注解 SQL、普通 `.sql` 文件或 MyBatis-Plus wrapper。

提取器是**前置数据准备**：产出「本次变更所属的完整模板 SQL + 数据源归属」，交给**下游一个 LLM SQL 分析 agent** 读取，由后者做风险/索引/性能判断。本版自身不做任何 SQL 分析。

目标流程：

```text
target...source 的 XML diff
        ↓
定位 source 版本中所属的完整 MyBatis statement
        ↓
解析数据源：方法/接口 @DS → Service 调用点 @DS（唯一调用方）→ 默认兜底
        ↓
移除动态 XML 标签属性，保留完整 SQL 结构
        ↓
脚本产出最终 JSON（含证据日志）
        ↓
Agent 薄编排：校验上下文 → 调脚本 → 保存并返回 JSON
```

例如只新增了一个动态条件：

```xml
<if test="status != null">
  AND status = #{status}
</if>
```

最终输出必须是它所在的完整 `<select>`、`<insert>`、`<update>` 或 `<delete>` 的 SQL 内容，而非该条件的局部片段。

### 1.1 本版目标

1. XML 中任意动态条件变更，均能输出完整所属 statement 的模板 SQL。
2. `templateSql` 中动态标签保留但无属性（如 `<if>`、`<foreach>`）。
3. 每条结果都有 `project` 与经过配置校验的 `dataSource`。
4. 数据源归属按 D3 的四级链解析，优先级正确。
5. 最终输出为 `{ project, items }` 的 JSON 对象，并保存到指定文件。

### 1.2 本版非目标

- SQL 风险、索引、性能、EXPLAIN 或数据库连接；
- 提取 Java 注解 SQL、Provider 方法、Kotlin SQL；
- MyBatis-Plus `QueryWrapper` / `LambdaQueryWrapper`；
- 完整的 Java 调用图分析（本版只做「单跳调用点 + 就近 `@DS`」的有限扫描，见 5.3）；
- 根据运行时参数还原唯一的最终 SQL；
- 完整删除且在 source 中已不存在的 statement 的历史 SQL。

> **【改】关于 Java**：原方案将 Java 完全列为非目标。本版因引入 Service 层 `@DS` 归属，**有限度地读取 Java 源码，且仅用于解析 `@DS`**——不提取任何 Java SQL、不构建完整调用图。

## 2. 关键设计决策

### 2.1 diff 只用于触发，完整 source 文件用于提取

使用 `{target}...{source}` 三点 diff 找到变更 XML 行；随后读取 source 版本的完整 Mapper XML，以 statement 的真实边界提取 SQL。这样「只新增一行 `AND` 条件」的变更也会输出完整 SQL。

### 2.2 XML 标签保留结构，移除属性

statement 外层 `<select>`/`<insert>`/`<update>`/`<delete>` 只是容器，不进入 `templateSql`。statement 内的动态标签保留标签名，但移除所有属性：

```xml
<if test="status != null">                  -> <if>
<when test="type == 'A'">                    -> <when>
<foreach collection="ids" item="id">        -> <foreach>
<trim prefix="WHERE" prefixOverrides="AND"> -> <trim>
<include refid="baseColumns"/>               -> 同文件可解析时展开；否则 <include/>
```

`#{param}` 统一转换为 `?`；`${param}` 原样保留。最终 SQL 压缩连续空白为一个空格，标签成对保留：

```text
SELECT id, name FROM user <where> <if> AND status = ? </if> </where>
```

> **为何保留标签（D2）**：下游是 LLM，保留 `<if>` 等动态分支能帮助它理解这是条件 SQL，而不会把 `AND status = ?` 误判为恒定条件。既保留了动态结构，又不暴露 `test`、`collection` 等标签参数。

### 2.3 数据源归属：四级链 + 证据可追溯 + 已知限制

每条输出都带项目名和数据源名。归属优先级（D3）：

```text
Mapper 方法上的 @DS("name")
  > Mapper 接口上的 @DS("name")
  > Service 调用点的 @DS("name")（仅当唯一调用方且 @DS 明确，见 5.3）
  > 项目配置中的 defaultDataSource
```

- 解析到的名称必须存在于该项目的 `dataSources` 列表；否则视为无效，继续沿链向下。
- 单数据源项目不查 `@DS`，直接使用 `defaultDataSource`（正常情况）。
- **归属证明不了时用 `defaultDataSource` 兜底、照常输出**（D4）。

**归属证据来源**（D4）：脚本在候选/调试文件中为每条记录一个 `evidence` 字段，取值之一：

```text
method-@DS | interface-@DS | service-@DS | single-ds | default-fallback
```

> **对外最终 JSON 仍是 4.2 三字段，不含 `evidence`。** 证据仅落在调试文件，用于将来排查 default 兜底是否归错库。

**已知限制**（见第 8.1 节）：多数据源项目中，若 `@DS` 标在 Service 且写法复杂（构造注入、lombok、跨方法转发），或一个 Mapper 方法被多个不同 `@DS` 调用（多义），归属会降级到 `default-fallback`，**此时可能不准**。这是本版明确接受的取舍。

### 2.4 脚本产出、Agent 薄编排

> **【改】** 原方案让 Agent「逐项审核脚本结果」。本版取消该职责。

脚本负责全部确定性工作，并**直接产出最终 JSON**。Agent 是薄编排层：校验数据源上下文 → 调脚本 → 确认执行成功 → 保存并返回 JSON。Agent 不逐项复核、不改写、不补写。

理由：提取是确定性计算，用 LLM 复核确定性输出只会引入不确定和成本，且发现问题也无法修正。正确性由**脚本 + fixture 回归**保证。这与做主观规范判断的 4 个 reviewer agent 性质不同。

## 3. 配置设计

### 3.1 项目识别

项目名和项目—数据源映射由外部调用方提供；其存储位置与文件格式不在本方案范围内。本方案只定义传给提取脚本的**规范化数据源上下文**，外部映射经单独适配层转换为该上下文；适配层不属于 XML SQL 提取逻辑。

### 3.2 项目与数据源映射

外部映射只需提供数据源逻辑名称，不含 JDBC URL、用户名、密码等凭据。传入脚本的规范化上下文固定为：

```json
{
  "project": "advert",
  "defaultDataSource": "advert-master",
  "dataSources": ["advert-master", "advert-read"]
}
```

| 字段 | 含义 |
|---|---|
| `project` | 当前执行对应的项目 ID |
| `defaultDataSource` | 未发现可用 `@DS` 时的默认数据源 |
| `dataSources` | 该项目允许输出的数据源名称列表 |

校验规则：`project` 为空、或 `defaultDataSource` 不在 `dataSources` 内时，脚本直接失败，不降级到任意默认值。

## 4. 输入与输出契约

### 4.1 Agent / 脚本输入

| 参数 | 含义 |
|---|---|
| `repo-path` | 待审查仓库根目录 |
| `source` | source 分支或提交 |
| `target` | target 分支或提交 |
| `project` | 项目 ID，由调用方提供 |
| `data-source-context` | 由外部映射适配后生成的规范化数据源上下文 |
| `output` | 最终 JSON 保存路径 |

默认输出路径：`.codex/sql-extraction/sql-extraction-result.json`

### 4.2 最终 JSON

Agent 的最终回复与保存文件内容完全一致：

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

| 字段 | 含义 |
|---|---|
| `project` | 顶层字段，当前执行的项目 ID |
| `items` | 当前项目中提取到的 SQL 变更列表 |
| `items[].dataSource` | 按 2.3 归属链解析出的数据源逻辑名称 |
| `items[].file` | 相对仓库根目录的 XML 路径，后接 `:` 与 statement 起始行 |
| `items[].templateSql` | 完整 statement 的 SQL；动态标签保留但不带属性 |

没有 XML SQL 变更时，输出 `{ "project": "<当前项目>", "items": [] }`。

## 5. 解析与归属设计

### 5.1 Diff 与 XML statement 定位

沿用现有 `git_diff.mjs` 相同的 git 口径与校验风格（脚本内联 git 调用，不与其耦合）：

1. `git -C {repo} merge-base {target} {source}`；无共同祖先立即失败（不降级为两分支文件树比较）。
2. `git diff --name-only --diff-filter=ACMR {target}...{source} -- "*.xml" ":(exclude)*pom.xml"`。
3. 用文件内容/路径确认为 MyBatis Mapper XML；非 Mapper XML 跳过。
4. `git diff -U0 --diff-filter=ACMR {target}...{source} -- ...` 取 source 侧变更行。
5. 从 source 版本完整文件中定位包含变更行的 `<select>`/`<insert>`/`<update>`/`<delete>`。
6. 多个变更行命中同一 statement 时只输出一次。

纯删除条件但 statement 仍在 source 中时，用删除 hunk 的 source 插入锚点定位该 statement，输出变更后的完整 SQL。整个 statement 被删除时不输出。

### 5.2 MyBatis XML 解析器 · 【改：sax 库】

> **【改】** 原方案要求手写字符流 + 标签栈。本版改为 **vendor 一个零依赖单文件 sax/XML 解析器**到 `plugins/code-review/skills/java-code-review/scripts/lib/`（与现有 `lib/` 放 jar 同理，不引入 `package.json`）。

在 sax 事件流上完成解析——由解析器天然、正确地处理 XML 注释、CDATA、属性字符串中的伪标签与转义，并提供每个节点的**起始行号**。

支持标签：`<select> <insert> <update> <delete>` / `<sql> <include>` / `<if> <choose> <when> <otherwise>` / `<foreach> <where> <trim> <set> <bind>`。

模板化处理规则：

1. 去掉 statement 外层标签及其属性。
2. 保留内部动态标签名，删除开始标签中的全部属性。
3. 同文件内 `<include refid="..."/>` 递归展开为对应 `<sql>` 片段。
4. 跨文件 include、找不到的 refid 或循环引用输出 `<include/>`，不猜测内容。
5. `#{...}` → `?`；`${...}` 保留。
6. 压缩连续空白，保留 SQL 字符串字面量内容。

statement 边界无法确定时，跳过该项，不输出截断 SQL。

### 5.3 namespace 与 `@DS` 归属 · 【改：新增 Service 层】

`<mapper namespace="...">` 是 Mapper 接口全限定类名，例如 `cn.lyy.advert.mapper.ReportMapper`。脚本在 source 版本中定位对应 Java 接口文件，仅做 `@DS` 读取。

**前两级（直接读注解，确定性、成本低）：**

1. 读接口声明上的 `@DS("...")`。
2. 读与 statement `id` 同名的方法上的 `@DS("...")`。
3. 支持导入后的 `@DS` 与全限定名 `@com.baomidou.dynamic.datasource.annotation.DS(...)`。
4. 仅接受字符串字面量参数（如 `@DS("advert-read")`）；表达式、常量引用、SpEL 视为无法确认。

**第三级 · Service 调用点（grep 保守版，D5）：** 当前两级都未取到、且项目为多数据源时执行：

1. 由 namespace 拿到 Mapper 全限定名与类型简单名（如 `ReportMapper`）。
2. 在 source 版本 Java 源码中，找**显式声明为该 Mapper 类型的字段**，取字段名（`ReportMapper\s+(\w+)`，含 `@Autowired`/`@Resource`/成员字段写法）。
3. 对每个 `(文件, 字段名)`，grep 调用点 `字段名.方法名(`（`方法名` = statement `id`）。
4. 对每个调用点，向上回溯定位所在方法，读方法 `@DS`；方法无则读所在类 `@DS`（仅字符串字面量）。
5. 汇总所有调用点解析出的 `@DS` 值集合：**恰好唯一非空值 → 采用（`service-@DS`）；空 → 该级无贡献；多值 → 多义 → 降级 default。**
6. **保守判定**：只处理字段注入这类类型显式可见的写法；构造注入、lombok `@RequiredArgsConstructor`、泛型 Mapper 基类等不显式的写法一律跳过，视为未识别 → 降级 default。

**兜底：** 以上均未取到有效数据源名 → `defaultDataSource`（`default-fallback`）。单数据源项目直接走此级（`single-ds`）。

若 statement `id` 无对应接口方法，跳过方法级 `@DS`，继续沿链。

## 6. 脚本与 Agent 设计

### 6.1 脚本

新增：`plugins/code-review/skills/java-code-review/scripts/extract_mybatis_xml_changes.mjs`

调用示例：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/java-code-review/scripts/extract_mybatis_xml_changes.mjs \
  --repo-path {repo-path} \
  --source {source} \
  --target {target} \
  --project {project} \
  --data-source-context {normalized-data-source-context.json} \
  --output .codex/sql-extraction/sql-extraction-result.json
```

脚本模块：

```text
extract_mybatis_xml_changes.mjs
├── parseArguments
├── loadDataSourceContext          # 含 3.2 上下文校验
├── resolveDiff                    # 内联 5.1 的三点 diff + merge-base
├── readSourceAtRevision
├── loadSaxParser                  # 加载 lib/ 中 vendor 的单文件解析器
├── parseMapperXml                 # sax 事件流 → statement 边界 + 行号 + 标签树
├── resolveIncludes
├── resolveMapperDataSource        # 方法级 / 接口级 @DS
├── resolveServiceDataSource       # 【新增】5.3 grep 保守版调用点扫描
├── normalizeXmlSql
├── buildResult                    # 直接产出 4.2 JSON，并记录每条 evidence
└── writeResult                    # 写 output（4.2）；另写含 evidence 的调试文件
```

数据源职责划分：

- **外部适配层**：把格式待定的项目—数据源映射转换为规范化数据源上下文；
- **脚本**：按 5.3 归属链结合上下文，确定每条 SQL 的 `dataSource` 与 `evidence`；
- **Agent**：只校验上下文并编排，不自行解析或猜测数据源。

### 6.2 Agent · 【改：薄编排】

新增：`plugins/code-review/agents/mybatis-xml-sql-extractor.md`

执行步骤：

1. 接收调用方提供的 `project` 与规范化数据源上下文；不依赖本地项目地图。
2. 校验上下文中的项目 ID 与 `project` 一致，且 `defaultDataSource ∈ dataSources`。
3. 调用提取脚本。
4. 确认脚本执行成功（退出码、输出文件存在且为合法 JSON）。
5. 将脚本产出的 JSON 保存到 `output`，并原样返回。
6. **不逐项复核、不改写、不补写、不附加审核信息。**

## 7. 本版实施行动计划

| 步骤 | 工作内容 | 验证方式 |
|---|---|---|
| 1 | 固化规范化数据源上下文契约与最终 JSON schema | 校验缺 project、未知数据源、默认数据源非法时失败 |
| 2 | 实现三点 diff 与 MyBatis Mapper XML 识别 | fixture 覆盖空 diff、非 Mapper XML、修改与删除条件 |
| 3 | vendor sax 解析器，实现 statement 边界、行号与完整 SQL 提取 | 单行改 `<if>` 返回完整 select；insert/update/delete 均覆盖 |
| 4 | 实现标签属性清理、参数占位符、同文件 include 展开 | 断言 `<if test>` → `<if>`；同文件 include 正确展开；跨文件 include 输出 `<include/>` |
| 5 | 实现 namespace、接口/方法 `@DS`，及 Service grep 保守版（唯一调用方） | 方法级优先接口级；唯一调用方采用 service-@DS；多义/复杂注入降级 default；证据来源正确 |
| 6 | Agent 薄编排与 JSON 保存 | 人工构造未知数据源上下文确认脚本失败；确认 Agent 不改写脚本结果 |
| 7 | 接入插件 manifest、补充文档与 Git fixture 回归 | 全量 fixture 稳定通过，output 内容与 Agent 回复一致 |

本版验收标准：

1. XML 中任意动态条件变更均能输出完整所属 statement。
2. `templateSql` 中动态标签无属性。
3. 每条结果都有正确 `project` 与可配置校验的数据源。
4. 归属四级链优先级正确；Service 层仅在唯一调用方时生效，多义/复杂写法降级 default。
5. 最终输出为 `{ project, items }` JSON，并已保存到指定文件。

## 8. 已知限制与后续演进

### 8.1 本版已知限制

1. **多数据源 + Service `@DS` 复杂写法**：构造注入、lombok、跨私有方法转发等，Service 层识别不出而降级 `default-fallback`，归属可能不准。
2. **多义归属**：一个 Mapper 方法被多个不同 `@DS` 调用时，降级 `default-fallback`。
3. **跨文件 include** 不展开，输出 `<include/>`。
4. **完整删除的 statement** 不输出历史 SQL。
5. 不还原运行时最终 SQL。

以上限制通过 `evidence` 调试字段可追溯（哪些条目是 `default-fallback`）。

### 8.2 XML 与 Java 能力增强

1. 跨 Mapper 文件的 `<include>` 解析。
2. 配置化 namespace 到 Mapper 接口路径的映射。
3. 保留完整删除 statement 的 `beforeTemplateSql` 与 `changeType`。
4. 引入 **Java AST（Tree-sitter Java / JavaParser）** 做完整 service→mapper 调用图，替代 5.3 的 grep 保守版，覆盖复杂注入与跨方法传递。

### 8.3 Java 与 MyBatis-Plus wrapper SQL

在 XML 提取稳定后，另建独立的 Java wrapper 提取器，不与本版 XML 提取器混合。演进路径：AST 定位变更方法及调用链 → 识别 `QueryWrapper`/`LambdaQueryWrapper` 构造与调用 → 从 `@TableName`/`@TableField` 解析表名列名 → 归属数据源。无法证明的数据流继续跳过。若需真正运行时 SQL，另行接入受控环境的 MyBatis `BoundSql` 捕获。
