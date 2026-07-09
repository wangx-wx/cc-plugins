# SQL 提取方案

## 目标

在 code-review 场景中，从分支 diff 中提取 SQL 变更信息，并输出极简结构：

```json
{
  "items": [
    {
      "file": "src/main/resources/mapper/UserMapper.xml",
      "line": 12,
      "templateSql": "SELECT * FROM user WHERE id = ?"
    }
  ]
}
```

只做 SQL 提取，不做 SQL 风险判断、性能分析、索引分析、EXPLAIN，也不尝试静态还原所有动态 SQL 的最终执行形态。

## 基本假设

1. 输入来自 code-review 的分支对比，通常是 `{target}...{source}`。
2. 目标项目以 Java 为主，第一版重点覆盖 MyBatis XML、MyBatis 注解 SQL、MyBatis-Plus、普通 `.sql` 文件。
3. 输出只保留 `file`、`line`、`templateSql` 三个字段，方便后续 review agent 或其他流程消费。
4. 对动态 SQL 使用可读模板表达，不伪造唯一最终 SQL。

## 提取范围

第一版覆盖：

```text
1. MyBatis XML
   - <select>
   - <insert>
   - <update>
   - <delete>
   - <sql>
   - <include>
   - <if>
   - <choose>
   - <when>
   - <otherwise>
   - <foreach>
   - <where>
   - <trim>
   - <set>

2. MyBatis 注解 SQL
   - @Select
   - @Insert
   - @Update
   - @Delete
   - @SelectProvider / @UpdateProvider / @InsertProvider / @DeleteProvider 只标记为 provider，不深入解析

3. MyBatis-Plus
   - QueryWrapper
   - LambdaQueryWrapper
   - UpdateWrapper
   - LambdaUpdateWrapper
   - Wrappers.query()
   - Wrappers.lambdaQuery()
   - Wrappers.update()
   - lambdaQuery()
   - lambdaUpdate()

4. SQL 文件
   - .sql
   - .ddl
   - .dml
```

暂不覆盖：

```text
1. 完整 Java AST 语义分析
2. 运行时 BoundSql 捕获
3. 数据库连接与 EXPLAIN
4. 根据表结构、索引、业务规则判断风险
5. 复杂 Provider 方法的跨方法 SQL 推导
```

## 总体流程

```text
1. 确定 diff 范围
   - 校验 target 与 source 是否存在共同祖先
   - 使用三点 diff：target...source

2. 获取候选文件
   - git diff --name-only --diff-filter=ACMR target...source
   - 只保留 .xml / .java / .kt / .sql / .ddl / .dml

3. 获取变更行
   - git diff -U0 --diff-filter=ACMR target...source
   - 解析每个文件的新增或修改行号

4. 根据文件类型选择提取器
   - XML 提取器
   - Java/Kotlin 注解 SQL 提取器
   - MyBatis-Plus 调用链提取器
   - SQL 文件语句提取器

5. 将变更行扩展到完整 SQL 单元
   - XML：扩展到所属 <select>/<insert>/<update>/<delete>/<sql>
   - 注解：扩展到所属注解表达式
   - MyBatis-Plus：扩展到 wrapper 调用链或所在语句块
   - SQL 文件：扩展到分号分隔的 SQL 语句

6. 生成 templateSql
   - #{param} 替换为 ?
   - ${param} 保留为 ${param}
   - XML 动态标签转换为可读标记
   - Java 字符串数组合并
   - MyBatis-Plus 调用链转换为近似 SQL 模板

7. 输出 JSON，并保存到文件
```

## 输出格式

只输出一个 JSON 对象：

```json
{
  "items": [
    {
      "file": "相对仓库根目录的文件路径",
      "line": 变更 SQL 所在起始行号,
      "templateSql": "模板化 SQL"
    }
  ]
}
```

字段含义：

```text
file:
相对仓库根目录的文件路径。

line:
SQL 单元起始行号。对于 XML，使用 <select>/<insert>/<update>/<delete> 起始行；
对于注解 SQL，使用注解所在行；
对于 MyBatis-Plus，使用调用链起始行；
对于 SQL 文件，使用语句起始行。

templateSql:
提取后的 SQL 模板。参数化占位符用 ? 表示，动态条件使用 [IF ...]、[WHERE] 等标记保留。
```

## MyBatis XML 提取策略

核心原则：只要变更行落在某个 SQL statement 内，就提取完整 statement。

示例：

```xml
<select id="listUsers">
  SELECT *
  FROM user
  <where>
    <if test="status != null">
      AND status = #{status}
    </if>
  </where>
</select>
```

输出：

```json
{
  "items": [
    {
      "file": "src/main/resources/mapper/UserMapper.xml",
      "line": 1,
      "templateSql": "SELECT * FROM user [WHERE] [IF status != null] AND status = ?"
    }
  ]
}
```

处理规则：

```text
1. 解析 XML，定位 namespace 和 statement 节点。
2. 遍历 <select>/<insert>/<update>/<delete>/<sql>。
3. 判断 diff 变更行是否落在节点起止行内。
4. 把节点内容转换为 templateSql。
5. <include refid="xxx"/> 先转换为 [INCLUDE xxx]；同文件能稳定展开时再展开。
6. <where> 转换为 [WHERE]。
7. <set> 转换为 [SET]。
8. <if test="xxx"> 转换为 [IF xxx]。
9. <when test="xxx"> 转换为 [WHEN xxx]。
10. <otherwise> 转换为 [OTHERWISE]。
11. <foreach ...> 转换为 [FOREACH collection]。
12. #{param} 替换为 ?。
13. ${param} 保留为 ${param}。
```

XML 解析失败时降级为文本扫描：

```text
1. 从变更行向上寻找最近的 <select>/<insert>/<update>/<delete>/<sql>。
2. 从该行向下寻找对应关闭标签。
3. 若能找到完整片段，按文本规则生成 templateSql。
4. 若找不到完整片段，只提取变更行附近连续 SQL 文本。
```

## MyBatis 注解 SQL 提取策略

支持简单字符串：

```java
@Select("SELECT * FROM user WHERE id = #{id}")
```

输出：

```json
{
  "items": [
    {
      "file": "src/main/java/com/example/UserMapper.java",
      "line": 10,
      "templateSql": "SELECT * FROM user WHERE id = ?"
    }
  ]
}
```

支持字符串数组：

```java
@Update({
  "UPDATE user",
  "SET name = #{name}",
  "WHERE id = #{id}"
})
```

输出：

```json
{
  "items": [
    {
      "file": "src/main/java/com/example/UserMapper.java",
      "line": 10,
      "templateSql": "UPDATE user SET name = ? WHERE id = ?"
    }
  ]
}
```

处理规则：

```text
1. 识别 @Select/@Insert/@Update/@Delete。
2. 如果注解参数是字符串字面量，直接提取。
3. 如果注解参数是字符串数组，按顺序合并。
4. 如果存在字符串拼接，保留能确定的字符串，并把变量片段转换为 [JAVA_EXPR]。
5. 如果是 Provider 注解，输出 [PROVIDER ClassName.methodName]。
```

示例：

```java
@Select("SELECT * FROM user WHERE " + condition)
```

输出：

```json
{
  "items": [
    {
      "file": "src/main/java/com/example/UserMapper.java",
      "line": 10,
      "templateSql": "SELECT * FROM user WHERE [JAVA_EXPR]"
    }
  ]
}
```

## MyBatis-Plus 提取策略

MyBatis-Plus 第一版不强行还原完整 SQL，只根据调用链生成近似模板。

示例：

```java
lambdaQuery()
    .eq(User::getStatus, status)
    .like(User::getName, keyword)
    .orderByDesc(User::getCreateTime);
```

输出：

```json
{
  "items": [
    {
      "file": "src/main/java/com/example/UserService.java",
      "line": 20,
      "templateSql": "WHERE status = ? AND name LIKE ? ORDER BY create_time DESC"
    }
  ]
}
```

调用映射：

```text
eq(column, value)              -> column = ?
ne(column, value)              -> column <> ?
gt(column, value)              -> column > ?
ge(column, value)              -> column >= ?
lt(column, value)              -> column < ?
le(column, value)              -> column <= ?
between(column, a, b)          -> column BETWEEN ? AND ?
like(column, value)            -> column LIKE ?
likeLeft(column, value)        -> column LIKE ?
likeRight(column, value)       -> column LIKE ?
in(column, values)             -> column IN (...)
notIn(column, values)          -> column NOT IN (...)
isNull(column)                 -> column IS NULL
isNotNull(column)              -> column IS NOT NULL
orderByAsc(column)             -> ORDER BY column ASC
orderByDesc(column)            -> ORDER BY column DESC
groupBy(column)                -> GROUP BY column
having(sql, args...)           -> HAVING [RAW having(...)]
set(column, value)             -> SET column = ?
setSql(sql)                    -> [RAW setSql(...)]
last(sql)                      -> [RAW last(...)]
apply(sql, args...)            -> [RAW apply(...)]
inSql(column, sql)             -> column IN ([RAW SQL])
exists(sql)                    -> EXISTS ([RAW SQL])
notExists(sql)                 -> NOT EXISTS ([RAW SQL])
```

列名转换：

```text
1. Lambda 表达式 User::getCreateTime 可粗略转换为 create_time。
2. 字符串列名 "create_time" 原样使用。
3. 无法确定列名时使用 [COLUMN]。
```

操作类型推断：

```text
1. lambdaQuery/query/list/page/getOne/count -> 查询模板，通常从 WHERE 开始。
2. lambdaUpdate/update -> 更新模板，通常包含 SET 与 WHERE。
3. remove/delete -> 删除模板，通常包含 WHERE。
```

## SQL 文件提取策略

对于 `.sql`、`.ddl`、`.dml` 文件：

```text
1. 根据 diff 变更行定位 SQL 语句。
2. 从变更行向上找到上一个分号之后的位置。
3. 从变更行向下找到下一个分号。
4. 提取完整 SQL 语句。
5. 将常见字面值替换为 ?。
```

示例：

```sql
UPDATE user SET status = 'DISABLED' WHERE id = 1;
```

输出：

```json
{
  "items": [
    {
      "file": "db/migration/V1__update_user.sql",
      "line": 1,
      "templateSql": "UPDATE user SET status = ? WHERE id = ?"
    }
  ]
}
```

## templateSql 规范化规则

基础规则：

```text
1. 去掉 XML 标签中不影响 SQL 结构的换行和缩进。
2. 连续空白合并为一个空格。
3. 去除首尾空白。
4. #{xxx} 替换为 ?。
5. ${xxx} 保留为 ${xxx}。
6. Java 注解字符串中的转义引号和换行转为普通文本。
7. SQL 文件中的字符串、数字常量可替换为 ?。
```

动态 SQL 标记：

```text
<where>      -> [WHERE]
<set>        -> [SET]
<trim>       -> [TRIM]
<if test=""> -> [IF 条件]
<when test=""> -> [WHEN 条件]
<otherwise> -> [OTHERWISE]
<foreach>   -> [FOREACH collection]
<include>   -> [INCLUDE refid]
```

示例：

```text
输入：
SELECT * FROM user WHERE id = #{id} ORDER BY ${sortField}

输出：
SELECT * FROM user WHERE id = ? ORDER BY ${sortField}
```

## 去重规则

同一个 SQL 单元可能因为多行变更被多次命中，需要去重：

```text
去重 key = file + line + templateSql
```

如果同一 SQL 单元内多处变更，只输出一条记录。

## 结果保存

提取结果建议保存为 JSON 文件，默认路径：

```text
.codex/sql-extraction/sql-extraction-result.json
```

保存内容示例：

```json
{
  "items": [
    {
      "file": "src/main/resources/mapper/UserMapper.xml",
      "line": 12,
      "templateSql": "SELECT * FROM user WHERE id = ?"
    }
  ]
}
```

如果集成到 code-review plugin，也可以使用临时输出路径：

```text
plugins/code-review/.tmp/sql-extraction-result.json
```

推荐优先使用仓库内 `.codex/sql-extraction/`，因为它和具体 plugin 解耦，后续其他 agent 也可以读取。

## 封装为 Agent 的方式

Agent 只负责编排，不在提示词中手写复杂解析逻辑。稳定解析逻辑应该放到脚本中。

建议新增：

```text
plugins/code-review/agents/sql-extractor.md
plugins/code-review/skills/java-code-review/scripts/extract_sql_changes.mjs
```

Agent 执行步骤：

```text
1. 接收 repo-path、source、target。
2. 执行 extract_sql_changes.mjs。
3. 脚本输出 JSON。
4. Agent 将 JSON 保存到指定文件。
5. Agent 返回保存路径和 JSON 摘要。
```

脚本命令示例：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/java-code-review/scripts/extract_sql_changes.mjs \
  {repo-path} \
  --source {source} \
  --target {target} \
  --output .codex/sql-extraction/sql-extraction-result.json
```

Agent 输出可以保持简单：

```json
{
  "outputFile": ".codex/sql-extraction/sql-extraction-result.json",
  "count": 3
}
```

## MVP 验收标准

第一版做到以下能力即可：

```text
1. MyBatis XML 只改一行动态条件，也能提取完整 statement。
2. 能提取 select / insert / update / delete。
3. 能把 #{param} 转成 ?。
4. 能保留 ${param}。
5. 能把 if / where / foreach / choose / include 转成可读标记。
6. 能提取 @Select/@Update 等注解 SQL。
7. 能合并注解字符串数组。
8. 能提取 MyBatis-Plus wrapper 调用链并生成近似 templateSql。
9. 能提取 .sql 文件中变更行所在 SQL 语句。
10. 输出只包含 file、line、templateSql。
11. 结果能保存到固定 JSON 文件。
```

## 推荐实现顺序

```text
1. 实现 diff 文件和变更行收集。
2. 实现 MyBatis XML statement 提取。
3. 实现 templateSql 基础规范化。
4. 实现注解 SQL 提取。
5. 实现 SQL 文件语句提取。
6. 实现 MyBatis-Plus 调用链粗提取。
7. 实现结果去重和保存。
8. 再封装 sql-extractor agent。
```

这套方案的核心取舍是：输出字段极简，但提取过程要尽量保留完整 SQL 单元；遇到动态 SQL 和 ORM 构造器时，输出可读模板，不编造最终执行 SQL。
