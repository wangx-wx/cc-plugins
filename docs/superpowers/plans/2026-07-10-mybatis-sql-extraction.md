# MyBatis XML 变更 SQL 提取器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 `{target}...{source}` 的 MyBatis Mapper XML 变更中提取所属完整 statement 的模板 SQL，附带数据源归属，产出 `{ project, items }` JSON 供下游 LLM SQL 分析 agent 消费。

**Architecture:** 一个 Node ESM 入口脚本 `extract_mybatis_xml_changes.mjs` 编排四个纯逻辑模块（`lib/mybatis-xml.mjs`、`lib/datasource.mjs`、`lib/git-diff.mjs` 与 vendored `lib/sax.js`）。纯函数用 `node:test` 单元测试，依赖 git 的部分用临时 git fixture 集成测试。Agent 是薄编排层，只校验上下文、调脚本、透传 JSON。

**Tech Stack:** Node.js v24（ESM `.mjs`）、内置 `node:test` / `node:assert`、vendored `sax` 1.6.0（单文件 CJS）、`git` CLI。

## Global Constraints

以下为全项目约束，每个任务都隐含遵守：

- **零 npm 依赖、无 `package.json`**：唯一第三方是 vendored 的 `scripts/lib/sax.js`（单文件，随仓库提交）。
- **ESM 模块**：所有新 `.mjs` 用 `import` / `export`；导入 vendored CJS 用 `import sax from "../lib/sax.js"`。
- **测试命令**：`node --test plugins/code-review/skills/java-code-review/scripts/test/`。
- **最终 JSON 严格三字段**：`items[]` 仅 `dataSource`、`file`、`templateSql`；`evidence` 只写入调试文件，绝不进最终输出。
- **数据源名必须 ∈ `dataSources` 列表**，否则视为未命中、沿归属链向下。
- **仅接受字符串字面量 `@DS("name")`**；表达式、常量、SpEL 视为无法确认。
- **statement 边界无法确定则跳过该项**，绝不输出截断 SQL。
- **归属链**：`方法级 @DS > 接口级 @DS > Service 唯一调用方 @DS > defaultDataSource`。
- **commit 粒度**：每个任务末尾一次 commit；只 `git add` 该任务涉及的文件。

**路径前缀（下文简写 `{S}`）：** `plugins/code-review/skills/java-code-review/scripts`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `{S}/lib/sax.js` | vendored sax 1.6.0 单文件解析器（第三方，CJS） |
| `{S}/lib/mybatis-xml.mjs` | `parseMapperXml`、`resolveIncludes`、`normalizeXmlSql`、`collapseWhitespace` |
| `{S}/lib/datasource.mjs` | `loadDataSourceContext`、`resolveMapperDataSource`、`resolveServiceDataSource`、`resolveDataSource` |
| `{S}/lib/git-diff.mjs` | `isMapperXml`、`resolveDiff`、`readSourceAtRevision` |
| `{S}/extract_mybatis_xml_changes.mjs` | 入口：`parseArguments` + 编排 + `buildResult` + `writeResult` |
| `{S}/test/*.test.mjs` | 各模块 `node:test` 测试 |
| `{S}/test/helpers/git-fixture.mjs` | 构造临时 git 仓库的测试辅助 |
| `plugins/code-review/agents/mybatis-xml-sql-extractor.md` | 薄编排 Agent 定义 |
| `plugins/code-review/.claude-plugin/plugin.json` | 追加注册新 agent |

---

## Task 1: 数据源上下文加载与校验

**Files:**
- Create: `{S}/lib/datasource.mjs`
- Test: `{S}/test/datasource-context.test.mjs`

**Interfaces:**
- Produces: `loadDataSourceContext(jsonText: string) => { project: string, defaultDataSource: string, dataSources: string[] }`；非法时 `throw new Error(msg)`。

- [ ] **Step 1: 写失败测试**

Create `{S}/test/datasource-context.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDataSourceContext } from "../lib/datasource.mjs";

test("接受合法上下文", () => {
  const ctx = loadDataSourceContext(
    JSON.stringify({ project: "advert", defaultDataSource: "m", dataSources: ["m", "r"] })
  );
  assert.equal(ctx.project, "advert");
  assert.deepEqual(ctx.dataSources, ["m", "r"]);
});

test("project 为空则抛错", () => {
  assert.throws(
    () => loadDataSourceContext(JSON.stringify({ project: "", defaultDataSource: "m", dataSources: ["m"] })),
    /project/
  );
});

test("defaultDataSource 不在 dataSources 内则抛错", () => {
  assert.throws(
    () => loadDataSourceContext(JSON.stringify({ project: "advert", defaultDataSource: "x", dataSources: ["m"] })),
    /defaultDataSource/
  );
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test {S}/test/datasource-context.test.mjs`
Expected: FAIL（`Cannot find module '../lib/datasource.mjs'`）

- [ ] **Step 3: 最小实现**

Create `{S}/lib/datasource.mjs`:

```javascript
export function loadDataSourceContext(jsonText) {
  let ctx;
  try {
    ctx = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`数据源上下文不是合法 JSON: ${e.message}`);
  }
  if (!ctx || typeof ctx.project !== "string" || ctx.project.trim() === "") {
    throw new Error("数据源上下文缺少非空 project");
  }
  if (!Array.isArray(ctx.dataSources) || ctx.dataSources.length === 0) {
    throw new Error("数据源上下文缺少非空 dataSources");
  }
  if (!ctx.dataSources.includes(ctx.defaultDataSource)) {
    throw new Error("defaultDataSource 必须在 dataSources 列表内");
  }
  return { project: ctx.project, defaultDataSource: ctx.defaultDataSource, dataSources: ctx.dataSources };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test {S}/test/datasource-context.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add {S}/lib/datasource.mjs {S}/test/datasource-context.test.mjs
git commit -m "feat(sql-extract): 数据源上下文加载与校验"
```

---

## Task 2: vendor sax 解析器 + 冒烟测试

**Files:**
- Create: `{S}/lib/sax.js`（vendored，不手写）
- Test: `{S}/test/sax-smoke.test.mjs`

**Interfaces:**
- Produces: 可 `import sax from "../lib/sax.js"`，`sax.parser(true, { position: true })` 返回带 `onopentag/onclosetag/ontext`、`line`/`column`/`position`/`startTagPosition` 的解析器。

- [ ] **Step 1: 获取 vendored sax（单文件）**

Run（在仓库根）:

```bash
TMP=$(mktemp -d) && ( cd "$TMP" && npm pack sax@1.6.0 >/dev/null 2>&1 && tar -xf sax-1.6.0.tgz ) \
  && cp "$TMP/package/lib/sax.js" {S}/lib/sax.js \
  && rm -rf "$TMP" \
  && head -5 {S}/lib/sax.js
```

Expected: 成功拷贝，`head` 显示 sax 版权注释。若无网络，需人工从 https://github.com/isaacs/sax-js `lib/sax.js`（tag v1.6.0）放置到该路径。

- [ ] **Step 2: 写冒烟测试**

Create `{S}/test/sax-smoke.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import sax from "../lib/sax.js";

test("sax 能解析标签并给出行号", () => {
  const parser = sax.parser(true, { position: true });
  const opened = [];
  parser.onopentag = (node) => opened.push({ name: node.name, line: parser.line });
  parser.write("<a>\n<b/>\n</a>").close();
  assert.deepEqual(opened.map((o) => o.name), ["a", "b"]);
  assert.equal(typeof opened[0].line, "number");
});
```

- [ ] **Step 3: 跑测试确认通过**

Run: `node --test {S}/test/sax-smoke.test.mjs`
Expected: PASS（1 test）。若 FAIL 于 import，检查 Step 1 文件是否就位。

- [ ] **Step 4: Commit**

```bash
git add {S}/lib/sax.js {S}/test/sax-smoke.test.mjs
git commit -m "chore(sql-extract): vendor sax 1.6.0 单文件解析器"
```

---

## Task 3: 解析 Mapper XML 为 statement AST（含行号）

**Files:**
- Create: `{S}/lib/mybatis-xml.mjs`
- Test: `{S}/test/parse-mapper-xml.test.mjs`

**Interfaces:**
- Consumes: `sax`（Task 2）。
- Produces:
  - 节点类型：`ElementNode = { kind: "element", name: string, attributes: Record<string,string>, children: Node[] }`；`TextNode = { kind: "text", text: string }`。
  - `parseMapperXml(xml: string) => { namespace: string, statements: Statement[], sqlFragments: Record<string, ElementNode> }`
  - `Statement = { type: "select"|"insert"|"update"|"delete", id: string, startLine: number, node: ElementNode }`（`startLine` 为 1-based，指向开标签 `<` 所在行）。

- [ ] **Step 1: 写失败测试**

Create `{S}/test/parse-mapper-xml.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMapperXml } from "../lib/mybatis-xml.mjs";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="cn.demo.ReportMapper">
  <sql id="cols">id, name</sql>
  <select id="list" resultType="X">
    SELECT <include refid="cols"/> FROM user
    <where>
      <if test="status != null">AND status = #{status}</if>
    </where>
  </select>
</mapper>`;

test("解析 namespace 与 statement 列表", () => {
  const r = parseMapperXml(XML);
  assert.equal(r.namespace, "cn.demo.ReportMapper");
  assert.equal(r.statements.length, 1);
  assert.equal(r.statements[0].type, "select");
  assert.equal(r.statements[0].id, "list");
});

test("statement 起始行为 1-based 开标签行", () => {
  const r = parseMapperXml(XML);
  // <select ...> 在第 4 行
  assert.equal(r.statements[0].startLine, 4);
});

test("收集 sql 片段供 include 使用", () => {
  const r = parseMapperXml(XML);
  assert.ok(r.sqlFragments.cols);
  assert.equal(r.sqlFragments.cols.children[0].text.trim(), "id, name");
});

test("保留内部标签属性（供后续按需读取）", () => {
  const r = parseMapperXml(XML);
  const whereNode = r.statements[0].node.children.find((c) => c.kind === "element" && c.name === "where");
  const ifNode = whereNode.children.find((c) => c.kind === "element" && c.name === "if");
  assert.equal(ifNode.attributes.test, "status != null");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test {S}/test/parse-mapper-xml.test.mjs`
Expected: FAIL（`parseMapperXml` 未导出）

- [ ] **Step 3: 实现 parseMapperXml**

Create `{S}/lib/mybatis-xml.mjs`（本任务只加 `parseMapperXml` 及其辅助）:

```javascript
import sax from "../lib/sax.js";

const STATEMENT_TYPES = new Set(["select", "insert", "update", "delete"]);

// 建立字符偏移 -> 1-based 行号 的映射
function buildOffsetToLine(xml) {
  const lineStarts = [0];
  for (let i = 0; i < xml.length; i++) {
    if (xml[i] === "\n") lineStarts.push(i + 1);
  }
  return (offset) => {
    // 二分：最后一个 <= offset 的 lineStart 下标
    let lo = 0, hi = lineStarts.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] <= offset) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans + 1; // 1-based
  };
}

export function parseMapperXml(xml) {
  const parser = sax.parser(true, { position: true, trim: false, normalize: false });
  const offsetToLine = buildOffsetToLine(xml);

  let namespace = "";
  const statements = [];
  const sqlFragments = {};
  const stack = []; // ElementNode 栈
  let currentStartLine = 1;

  parser.onopentag = (tag) => {
    if (tag.name === "mapper") {
      namespace = tag.attributes.namespace || "";
    }
    const node = { kind: "element", name: tag.name, attributes: { ...tag.attributes }, children: [] };
    // startTagPosition 指向 '<' 的偏移（1-based position），转 0-based 再查行
    const startOffset = Math.max(0, (parser.startTagPosition || parser.position) - 1);
    node._startLine = offsetToLine(startOffset);
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    stack.push(node);
  };

  parser.ontext = (t) => {
    if (stack.length > 0) stack[stack.length - 1].children.push({ kind: "text", text: t });
  };
  parser.oncdata = (t) => {
    if (stack.length > 0) stack[stack.length - 1].children.push({ kind: "text", text: t });
  };

  parser.onclosetag = (name) => {
    const node = stack.pop();
    if (!node) return;
    node._endLine = offsetToLine(Math.max(0, parser.position - 1)); // 结束标签所在行
    if (STATEMENT_TYPES.has(name)) {
      statements.push({ type: name, id: node.attributes.id || "", startLine: node._startLine, node });
    } else if (name === "sql" && node.attributes.id) {
      sqlFragments[node.attributes.id] = node;
    }
  };

  parser.write(xml).close();
  return { namespace, statements, sqlFragments };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test {S}/test/parse-mapper-xml.test.mjs`
Expected: PASS（4 tests）。若 `startLine` 断言差 1，核对 `startTagPosition` 的 1/0-based：sax 1.6.0 的 `position`/`startTagPosition` 为已消费字符数，`'<'` 的 0-based 偏移 = `startTagPosition - 1`。

- [ ] **Step 5: Commit**

```bash
git add {S}/lib/mybatis-xml.mjs {S}/test/parse-mapper-xml.test.mjs
git commit -m "feat(sql-extract): 解析 Mapper XML 为带行号的 statement AST"
```

---

## Task 4: 模板化 normalizeXmlSql（去属性 / 占位符 / 压空白）

**Files:**
- Modify: `{S}/lib/mybatis-xml.mjs`（新增 `collapseWhitespace`、`normalizeXmlSql`）
- Test: `{S}/test/normalize-sql.test.mjs`

**Interfaces:**
- Consumes: `ElementNode`/`TextNode`（Task 3）。
- Produces:
  - `collapseWhitespace(sql: string) => string`（压缩空白，保留单引号字符串字面量内空白）。
  - `normalizeXmlSql(statementNode: ElementNode) => string`（遍历 statement 根节点的 children，输出模板 SQL；根标签本身不输出；`name==="include"` 的元素输出 `<include/>`）。

- [ ] **Step 1: 写失败测试**

Create `{S}/test/normalize-sql.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeXmlSql, collapseWhitespace } from "../lib/mybatis-xml.mjs";

function el(name, attributes, children) { return { kind: "element", name, attributes: attributes || {}, children: children || [] }; }
function tx(text) { return { kind: "text", text }; }

test("去外层容器、内部标签保留但去属性、#{}->? 、${} 保留", () => {
  // <select> SELECT id, name FROM user <where> <if test=..> AND status = #{status} </if> </where> </select>
  const stmt = el("select", { id: "list" }, [
    tx(" SELECT id, name FROM user "),
    el("where", {}, [
      el("if", { test: "status != null" }, [tx(" AND status = #{status} ")]),
    ]),
  ]);
  assert.equal(
    normalizeXmlSql(stmt),
    "SELECT id, name FROM user <where> <if> AND status = ? </if> </where>"
  );
});

test("${} 原样保留", () => {
  const stmt = el("select", {}, [tx("ORDER BY ${orderBy}")]);
  assert.equal(normalizeXmlSql(stmt), "ORDER BY ${orderBy}");
});

test("未展开 include 输出 <include/>", () => {
  const stmt = el("select", {}, [tx("SELECT "), el("include", { refid: "x" }, []), tx(" FROM t")]);
  assert.equal(normalizeXmlSql(stmt), "SELECT <include/> FROM t");
});

test("collapseWhitespace 保留字符串字面量内空白", () => {
  assert.equal(collapseWhitespace("a   =   'x   y'   AND  b"), "a = 'x   y' AND b");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test {S}/test/normalize-sql.test.mjs`
Expected: FAIL（`normalizeXmlSql` 未导出）

- [ ] **Step 3: 实现**

Append to `{S}/lib/mybatis-xml.mjs`:

```javascript
export function collapseWhitespace(sql) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (!inStr && /\s/.test(ch)) {
      if (!out.endsWith(" ")) out += " ";
    } else {
      out += ch;
    }
  }
  return out.trim();
}

function emit(node, parts) {
  if (node.kind === "text") {
    parts.push(node.text.replace(/#\{[^}]*\}/g, "?")); // ${...} 不动
    return;
  }
  if (node.name === "include") {
    parts.push(" <include/> ");
    return;
  }
  parts.push(` <${node.name}> `);
  for (const child of node.children) emit(child, parts);
  parts.push(` </${node.name}> `);
}

export function normalizeXmlSql(statementNode) {
  const parts = [];
  for (const child of statementNode.children) emit(child, parts);
  return collapseWhitespace(parts.join(""));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test {S}/test/normalize-sql.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add {S}/lib/mybatis-xml.mjs {S}/test/normalize-sql.test.mjs
git commit -m "feat(sql-extract): statement 模板化（去属性/占位符/压空白）"
```

---

## Task 5: 同文件 include 展开 resolveIncludes

**Files:**
- Modify: `{S}/lib/mybatis-xml.mjs`（新增 `resolveIncludes`）
- Test: `{S}/test/resolve-includes.test.mjs`

**Interfaces:**
- Consumes: `ElementNode`、`sqlFragments`（Task 3）。
- Produces: `resolveIncludes(node: ElementNode, sqlFragments: Record<string,ElementNode>) => ElementNode`（返回新树：可解析的 `<include refid>` 就地替换为对应 `<sql>` 的 children；跨文件/找不到/循环引用则保留为 `{ kind:"element", name:"include", attributes:{}, children:[] }` 占位，交由 `normalizeXmlSql` 输出 `<include/>`）。

- [ ] **Step 1: 写失败测试**

Create `{S}/test/resolve-includes.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveIncludes, normalizeXmlSql } from "../lib/mybatis-xml.mjs";

function el(name, attributes, children) { return { kind: "element", name, attributes: attributes || {}, children: children || [] }; }
function tx(text) { return { kind: "text", text }; }

test("同文件 include 展开为 sql 片段内容", () => {
  const frags = { cols: el("sql", { id: "cols" }, [tx("id, name")]) };
  const stmt = el("select", {}, [tx("SELECT "), el("include", { refid: "cols" }, []), tx(" FROM t")]);
  const resolved = resolveIncludes(stmt, frags);
  assert.equal(normalizeXmlSql(resolved), "SELECT id, name FROM t");
});

test("找不到 refid 保留 <include/>", () => {
  const stmt = el("select", {}, [tx("SELECT "), el("include", { refid: "missing" }, []), tx(" FROM t")]);
  const resolved = resolveIncludes(stmt, {});
  assert.equal(normalizeXmlSql(resolved), "SELECT <include/> FROM t");
});

test("循环引用保留 <include/>，不无限递归", () => {
  const frags = { a: el("sql", { id: "a" }, [tx("X "), el("include", { refid: "a" }, [])]) };
  const stmt = el("select", {}, [el("include", { refid: "a" }, [])]);
  const resolved = resolveIncludes(stmt, frags);
  assert.equal(normalizeXmlSql(resolved), "X <include/>");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test {S}/test/resolve-includes.test.mjs`
Expected: FAIL（`resolveIncludes` 未导出）

- [ ] **Step 3: 实现**

Append to `{S}/lib/mybatis-xml.mjs`:

```javascript
const UNRESOLVED_INCLUDE = () => ({ kind: "element", name: "include", attributes: {}, children: [] });

export function resolveIncludes(node, sqlFragments, seen = new Set()) {
  if (node.kind !== "element") return node;
  const newChildren = [];
  for (const child of node.children) {
    if (child.kind === "element" && child.name === "include") {
      const refid = child.attributes.refid;
      if (refid && sqlFragments[refid] && !seen.has(refid)) {
        const nextSeen = new Set(seen).add(refid);
        const expanded = resolveIncludes(sqlFragments[refid], sqlFragments, nextSeen);
        newChildren.push(...expanded.children);
      } else {
        newChildren.push(UNRESOLVED_INCLUDE());
      }
    } else {
      newChildren.push(resolveIncludes(child, sqlFragments, seen));
    }
  }
  return { ...node, children: newChildren };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test {S}/test/resolve-includes.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add {S}/lib/mybatis-xml.mjs {S}/test/resolve-includes.test.mjs
git commit -m "feat(sql-extract): 同文件 include 展开与循环/缺失兜底"
```

---

## Task 6: Mapper 接口/方法 @DS 解析

**Files:**
- Modify: `{S}/lib/datasource.mjs`（新增 `resolveMapperDataSource`）
- Test: `{S}/test/mapper-ds.test.mjs`

**Interfaces:**
- Produces: `resolveMapperDataSource(javaSource: string, methodName: string) => { name: string, evidence: "method-@DS"|"interface-@DS" } | null`（仅字符串字面量；方法级优先接口级；无则 null）。

- [ ] **Step 1: 写失败测试**

Create `{S}/test/mapper-ds.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMapperDataSource } from "../lib/datasource.mjs";

const IFACE = `package cn.demo;
import com.baomidou.dynamic.datasource.annotation.DS;
@DS("advert-read")
public interface ReportMapper {
  @DS("advert-master")
  int save(Report r);
  List<Report> list();
}`;

test("方法级 @DS 优先", () => {
  assert.deepEqual(resolveMapperDataSource(IFACE, "save"), { name: "advert-master", evidence: "method-@DS" });
});

test("方法无 @DS 时回落接口级", () => {
  assert.deepEqual(resolveMapperDataSource(IFACE, "list"), { name: "advert-read", evidence: "interface-@DS" });
});

test("全限定名 @DS 也识别", () => {
  const src = `public interface M { @com.baomidou.dynamic.datasource.annotation.DS("x") int a(); }`;
  assert.deepEqual(resolveMapperDataSource(src, "a"), { name: "x", evidence: "method-@DS" });
});

test("无任何 @DS 返回 null", () => {
  assert.equal(resolveMapperDataSource(`public interface M { int a(); }`, "a"), null);
});

test("非字符串字面量参数视为无", () => {
  const src = `public interface M { @DS(DsConst.READ) int a(); }`;
  assert.equal(resolveMapperDataSource(src, "a"), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test {S}/test/mapper-ds.test.mjs`
Expected: FAIL（`resolveMapperDataSource` 未导出）

- [ ] **Step 3: 实现**

Append to `{S}/lib/datasource.mjs`:

```javascript
// 匹配 @DS("literal") 或 @...DS("literal")，仅字符串字面量
const DS_LITERAL = /@(?:[\w.]*\.)?DS\s*\(\s*"([^"]+)"\s*\)/;

// 找方法声明前紧邻的 @DS。策略：定位 `methodName(`，向前截取到上一个 `;`、`}` 或 `{` 之后的片段作为“方法头”，在其中找 @DS。
function findMethodDs(javaSource, methodName) {
  const re = new RegExp(`\\b${methodName}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(javaSource)) !== null) {
    const head = javaSource.slice(0, m.index);
    const cut = Math.max(head.lastIndexOf(";"), head.lastIndexOf("{"), head.lastIndexOf("}"));
    const methodHead = javaSource.slice(cut + 1, m.index);
    const dm = methodHead.match(DS_LITERAL);
    if (dm) return dm[1];
  }
  return null;
}

// 接口级：取 interface/class 声明关键字之前的 @DS
function findTypeDs(javaSource) {
  const decl = javaSource.search(/\b(?:public\s+)?(?:interface|class)\s+\w+/);
  if (decl < 0) return null;
  const dm = javaSource.slice(0, decl).match(DS_LITERAL);
  return dm ? dm[1] : null;
}

export function resolveMapperDataSource(javaSource, methodName) {
  const method = findMethodDs(javaSource, methodName);
  if (method) return { name: method, evidence: "method-@DS" };
  const iface = findTypeDs(javaSource);
  if (iface) return { name: iface, evidence: "interface-@DS" };
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test {S}/test/mapper-ds.test.mjs`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add {S}/lib/datasource.mjs {S}/test/mapper-ds.test.mjs
git commit -m "feat(sql-extract): Mapper 接口/方法级 @DS 解析"
```

---

## Task 7: Service 层 grep 保守版 @DS 解析

**Files:**
- Modify: `{S}/lib/datasource.mjs`（新增 `resolveServiceDataSource`）
- Test: `{S}/test/service-ds.test.mjs`

**Interfaces:**
- Consumes: `DS_LITERAL`（Task 6，模块内复用）。
- Produces: `resolveServiceDataSource(javaFiles: {path:string,content:string}[], mapperSimpleName: string, methodName: string) => { name: string, evidence: "service-@DS" } | null`（唯一调用方且 @DS 明确才返回；多义/复杂/找不到返回 null）。

- [ ] **Step 1: 写失败测试**

Create `{S}/test/service-ds.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveServiceDataSource } from "../lib/datasource.mjs";

const SINGLE = [{
  path: "OrderService.java",
  content: `class OrderService {
  private ReportMapper reportMapper;
  @DS("advert-master")
  public void doIt() { reportMapper.list(); }
}`,
}];

test("唯一调用方 + 方法 @DS 采用 service-@DS", () => {
  assert.deepEqual(resolveServiceDataSource(SINGLE, "ReportMapper", "list"),
    { name: "advert-master", evidence: "service-@DS" });
});

test("多个不同 @DS 调用方 -> 多义 -> null", () => {
  const files = [
    { path: "A.java", content: `class A { ReportMapper m; @DS("x") void f(){ m.list(); } }` },
    { path: "B.java", content: `class B { ReportMapper m; @DS("y") void g(){ m.list(); } }` },
  ];
  assert.equal(resolveServiceDataSource(files, "ReportMapper", "list"), null);
});

test("找不到该 Mapper 类型字段 -> null（复杂注入降级）", () => {
  const files = [{ path: "C.java", content: `class C { @DS("x") void f(){ someOther.list(); } }` }];
  assert.equal(resolveServiceDataSource(files, "ReportMapper", "list"), null);
});

test("调用点所在方法无 @DS 但类级有 @DS -> 采用类级", () => {
  const files = [{ path: "D.java", content: `@DS("clazz") class D { ReportMapper m; void f(){ m.list(); } }` }];
  assert.deepEqual(resolveServiceDataSource(files, "ReportMapper", "list"),
    { name: "clazz", evidence: "service-@DS" });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test {S}/test/service-ds.test.mjs`
Expected: FAIL（`resolveServiceDataSource` 未导出）

- [ ] **Step 3: 实现**

Append to `{S}/lib/datasource.mjs`:

```javascript
// 从调用点位置向上回溯，找最近的方法头上的 @DS；无则找类级 @DS。近似实现，复杂写法返回 null。
function dsAtCallSite(content, callIndex) {
  const before = content.slice(0, callIndex);
  // 最近方法头：向前找上一个 '{'（方法体起点）之前的方法签名片段
  const braceIdx = before.lastIndexOf("{");
  if (braceIdx >= 0) {
    const sigCut = Math.max(before.lastIndexOf(";", braceIdx), before.lastIndexOf("}", braceIdx));
    const methodHead = before.slice(sigCut + 1, braceIdx);
    const dm = methodHead.match(DS_LITERAL);
    if (dm) return dm[1];
  }
  // 类级：整文件第一个 class/interface 前的 @DS
  const decl = content.search(/\b(?:public\s+)?(?:interface|class)\s+\w+/);
  if (decl >= 0) {
    const dm = content.slice(0, decl).match(DS_LITERAL);
    if (dm) return dm[1];
  }
  return null;
}

export function resolveServiceDataSource(javaFiles, mapperSimpleName, methodName) {
  const fieldDecl = new RegExp(`\\b${mapperSimpleName}\\s+(\\w+)\\s*[;=]`);
  const found = new Set();
  for (const f of javaFiles) {
    const fm = f.content.match(fieldDecl);
    if (!fm) continue; // 该文件未显式声明此 Mapper 类型字段 -> 跳过（保守）
    const fieldName = fm[1];
    const callRe = new RegExp(`\\b${fieldName}\\s*\\.\\s*${methodName}\\s*\\(`, "g");
    let cm;
    while ((cm = callRe.exec(f.content)) !== null) {
      const ds = dsAtCallSite(f.content, cm.index);
      if (ds) found.add(ds);
    }
  }
  if (found.size === 1) return { name: [...found][0], evidence: "service-@DS" };
  return null; // 0（无）或 >1（多义）都降级
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test {S}/test/service-ds.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add {S}/lib/datasource.mjs {S}/test/service-ds.test.mjs
git commit -m "feat(sql-extract): Service 层 grep 保守版 @DS 归属"
```

---

## Task 8: 归属链组装 resolveDataSource

**Files:**
- Modify: `{S}/lib/datasource.mjs`（新增 `resolveDataSource`）
- Test: `{S}/test/resolve-datasource.test.mjs`

**Interfaces:**
- Consumes: `context`（Task 1），候选来自 Task 6/7。
- Produces: `resolveDataSource(orderedCandidates: ({name:string,evidence:string}|null)[], context) => { dataSource: string, evidence: string }`。按顺序取第一个 `name ∈ context.dataSources` 的候选；都无效时：`dataSources.length===1` → `{ defaultDataSource, "single-ds" }`，否则 `{ defaultDataSource, "default-fallback" }`。

- [ ] **Step 1: 写失败测试**

Create `{S}/test/resolve-datasource.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDataSource } from "../lib/datasource.mjs";

const CTX = { project: "advert", defaultDataSource: "m", dataSources: ["m", "r"] };

test("按顺序取第一个合法候选", () => {
  const out = resolveDataSource([{ name: "r", evidence: "method-@DS" }, { name: "m", evidence: "interface-@DS" }], CTX);
  assert.deepEqual(out, { dataSource: "r", evidence: "method-@DS" });
});

test("跳过 null 与不在 dataSources 的候选", () => {
  const out = resolveDataSource([null, { name: "unknown", evidence: "service-@DS" }, { name: "r", evidence: "interface-@DS" }], CTX);
  assert.deepEqual(out, { dataSource: "r", evidence: "interface-@DS" });
});

test("多数据源无有效候选 -> default-fallback", () => {
  assert.deepEqual(resolveDataSource([null], CTX), { dataSource: "m", evidence: "default-fallback" });
});

test("单数据源无候选 -> single-ds", () => {
  const ctx1 = { project: "p", defaultDataSource: "only", dataSources: ["only"] };
  assert.deepEqual(resolveDataSource([null], ctx1), { dataSource: "only", evidence: "single-ds" });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test {S}/test/resolve-datasource.test.mjs`
Expected: FAIL（`resolveDataSource` 未导出）

- [ ] **Step 3: 实现**

Append to `{S}/lib/datasource.mjs`:

```javascript
export function resolveDataSource(orderedCandidates, context) {
  for (const c of orderedCandidates) {
    if (c && context.dataSources.includes(c.name)) {
      return { dataSource: c.name, evidence: c.evidence };
    }
  }
  const evidence = context.dataSources.length === 1 ? "single-ds" : "default-fallback";
  return { dataSource: context.defaultDataSource, evidence };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test {S}/test/resolve-datasource.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add {S}/lib/datasource.mjs {S}/test/resolve-datasource.test.mjs
git commit -m "feat(sql-extract): 数据源归属链组装与兜底"
```

---

## Task 9: git diff 与 statement 定位

**Files:**
- Create: `{S}/lib/git-diff.mjs`
- Create: `{S}/test/helpers/git-fixture.mjs`
- Test: `{S}/test/git-diff.test.mjs`

**Interfaces:**
- Produces:
  - `isMapperXml(content: string) => boolean`（含 `<mapper` 且 `namespace`，排除非 mapper）。
  - `resolveDiff(repo: string, source: string, target: string) => { file: string, changedLines: number[] }[]`（仅 `*.xml`、排除 `pom.xml`、且 `isMapperXml`；`changedLines` 为 source 侧行号）。无共同祖先 `throw`。
  - `readSourceAtRevision(repo: string, rev: string, file: string) => string`。
  - helper：`createGitFixture(targetFiles, sourceFiles) => { repo: string, source: string, target: string, cleanup() }`。

- [ ] **Step 1: 写 git fixture helper**

Create `{S}/test/helpers/git-fixture.mjs`:

```javascript
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

function git(repo, args) {
  execFileSync("git", ["-C", repo, ...args], { stdio: ["pipe", "pipe", "pipe"] });
}
function writeAll(repo, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

// 在 target 分支写 targetFiles 并提交；切 source 分支写 sourceFiles 覆盖并提交。
export function createGitFixture(targetFiles, sourceFiles) {
  const repo = mkdtempSync(join(tmpdir(), "sqlx-"));
  git(repo, ["init", "-q", "-b", "target"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  writeAll(repo, targetFiles);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "target"]);
  git(repo, ["checkout", "-q", "-b", "source"]);
  writeAll(repo, sourceFiles);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "source"]);
  return { repo, source: "source", target: "target", cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}
```

- [ ] **Step 2: 写失败测试**

Create `{S}/test/git-diff.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDiff, readSourceAtRevision, isMapperXml } from "../lib/git-diff.mjs";
import { createGitFixture } from "./helpers/git-fixture.mjs";

const MAPPER_V1 = `<mapper namespace="cn.demo.ReportMapper">
  <select id="list">SELECT id FROM user</select>
</mapper>`;
const MAPPER_V2 = `<mapper namespace="cn.demo.ReportMapper">
  <select id="list">SELECT id FROM user WHERE x = #{x}</select>
</mapper>`;

test("isMapperXml 识别 mapper 文件", () => {
  assert.equal(isMapperXml(MAPPER_V1), true);
  assert.equal(isMapperXml(`<beans><bean/></beans>`), false);
});

test("resolveDiff 返回变更的 mapper 文件及 source 侧行号", () => {
  const fx = createGitFixture(
    { "m/ReportMapper.xml": MAPPER_V1 },
    { "m/ReportMapper.xml": MAPPER_V2 }
  );
  try {
    const changed = resolveDiff(fx.repo, fx.source, fx.target);
    assert.equal(changed.length, 1);
    assert.equal(changed[0].file, "m/ReportMapper.xml");
    assert.ok(changed[0].changedLines.includes(2)); // 第 2 行 select 被改
  } finally {
    fx.cleanup();
  }
});

test("readSourceAtRevision 读到 source 版本内容", () => {
  const fx = createGitFixture({ "m/ReportMapper.xml": MAPPER_V1 }, { "m/ReportMapper.xml": MAPPER_V2 });
  try {
    assert.match(readSourceAtRevision(fx.repo, fx.source, "m/ReportMapper.xml"), /WHERE x/);
  } finally {
    fx.cleanup();
  }
});

test("纯删除条件但 statement 仍在 -> 命中 source 锚点行（spec §5.1）", () => {
  const v1 = `<mapper namespace="cn.demo.M">
  <select id="list">SELECT id FROM user
    AND status = 1
  </select>
</mapper>`;
  const v2 = `<mapper namespace="cn.demo.M">
  <select id="list">SELECT id FROM user
  </select>
</mapper>`;
  const fx = createGitFixture({ "m/M.xml": v1 }, { "m/M.xml": v2 });
  try {
    const changed = resolveDiff(fx.repo, fx.source, fx.target);
    assert.equal(changed.length, 1);
    assert.ok(changed[0].changedLines.length > 0); // 纯删除也产出锚点
  } finally {
    fx.cleanup();
  }
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `node --test {S}/test/git-diff.test.mjs`
Expected: FAIL（`../lib/git-diff.mjs` 不存在）

- [ ] **Step 4: 实现**

Create `{S}/lib/git-diff.mjs`:

```javascript
import { execFileSync } from "node:child_process";

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 50 * 1024 * 1024 }).toString("utf-8");
}

export function isMapperXml(content) {
  return /<mapper\b/.test(content) && /namespace\s*=/.test(content);
}

export function readSourceAtRevision(repo, rev, file) {
  return git(repo, ["show", `${rev}:${file}`]);
}

// 解析 git diff -U0 的 source 侧新增/修改行号（@@ -a,b +c,d @@ 中的 c..c+d-1）
function parseChangedLines(diffText) {
  const lines = [];
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = re.exec(diffText)) !== null) {
    const start = parseInt(m[1], 10);
    const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
    if (count === 0) lines.push(start); // 纯删除 hunk（+c,0）：用 source 锚点行 c 命中所属 statement
    else for (let i = 0; i < count; i++) lines.push(start + i);
  }
  return lines;
}

export function resolveDiff(repo, source, target) {
  let base;
  try {
    base = git(repo, ["merge-base", target, source]).trim();
  } catch {
    base = "";
  }
  if (!base) throw new Error(`${target} 与 ${source} 无共同祖先，无法执行三点 diff`);

  const nameOnly = git(repo, [
    "diff", "--name-only", "--diff-filter=ACMR", `${target}...${source}`,
    "--", "*.xml", ":(exclude)*pom.xml",
  ]).split("\n").map((s) => s.trim()).filter(Boolean);

  const result = [];
  for (const file of nameOnly) {
    let content;
    try {
      content = readSourceAtRevision(repo, source, file);
    } catch {
      continue; // source 中不存在（纯删除文件）跳过
    }
    if (!isMapperXml(content)) continue;
    const diffText = git(repo, [
      "diff", "-U0", "--diff-filter=ACMR", `${target}...${source}`, "--", file,
    ]);
    const changedLines = parseChangedLines(diffText);
    if (changedLines.length > 0) result.push({ file, changedLines });
  }
  return result;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `node --test {S}/test/git-diff.test.mjs`
Expected: PASS（3 tests）

- [ ] **Step 6: Commit**

```bash
git add {S}/lib/git-diff.mjs {S}/test/git-diff.test.mjs {S}/test/helpers/git-fixture.mjs
git commit -m "feat(sql-extract): 三点 diff、mapper 识别与变更行定位"
```

---

## Task 10: 入口编排 + 端到端

**Files:**
- Create: `{S}/extract_mybatis_xml_changes.mjs`
- Test: `{S}/test/e2e.test.mjs`

**Interfaces:**
- Consumes: 全部 lib 模块。
- Produces:
  - `parseArguments(argv: string[]) => { repoPath, source, target, project, dataSourceContextPath, output }`
  - `buildItems({ changed, repo, source, context }) => { dataSource, file, templateSql, evidence }[]`（`file` 形如 `path:line`；`evidence` 供调试文件；Service 层所需 Java 源在内部自采集）。
  - `main(argv)`：写最终 JSON（去掉 evidence）到 `output`，写含 evidence 的调试文件到 `<output目录>/.debug-candidates.json`，并 `console.log` 最终 JSON。

- [ ] **Step 1: 写失败端到端测试**

Create `{S}/test/e2e.test.mjs`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItems } from "../extract_mybatis_xml_changes.mjs";
import { createGitFixture } from "./helpers/git-fixture.mjs";
import { resolveDiff } from "../lib/git-diff.mjs";

const V1 = `<mapper namespace="cn.demo.ReportMapper">
  <select id="list">SELECT id, name FROM user</select>
</mapper>`;
const V2 = `<mapper namespace="cn.demo.ReportMapper">
  <select id="list">SELECT id, name FROM user
    <where><if test="status != null">AND status = #{status}</if></where>
  </select>
</mapper>`;

test("单行新增 <if> 输出完整 select 模板 SQL 与数据源", () => {
  const fx = createGitFixture({ "m/ReportMapper.xml": V1 }, { "m/ReportMapper.xml": V2 });
  try {
    const context = { project: "advert", defaultDataSource: "m", dataSources: ["m", "r"] };
    const changed = resolveDiff(fx.repo, fx.source, fx.target);
    const items = buildItems({ changed, repo: fx.repo, source: fx.source, context });
    assert.equal(items.length, 1);
    assert.match(items[0].file, /m\/ReportMapper\.xml:2$/);
    assert.equal(items[0].templateSql,
      "SELECT id, name FROM user <where> <if> AND status = ? </if> </where>");
    assert.equal(items[0].dataSource, "m");        // 无 @DS -> 多数据源 default
    assert.equal(items[0].evidence, "default-fallback");
  } finally {
    fx.cleanup();
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test {S}/test/e2e.test.mjs`
Expected: FAIL（入口未创建）

- [ ] **Step 3: 实现入口**

Create `{S}/extract_mybatis_xml_changes.mjs`:

```javascript
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { parseMapperXml, resolveIncludes, normalizeXmlSql } from "./lib/mybatis-xml.mjs";
import { loadDataSourceContext, resolveMapperDataSource, resolveServiceDataSource, resolveDataSource } from "./lib/datasource.mjs";
import { resolveDiff, readSourceAtRevision } from "./lib/git-diff.mjs";

export function parseArguments(argv) {
  const o = {};
  const map = { "--repo-path": "repoPath", "--source": "source", "--target": "target",
    "--project": "project", "--data-source-context": "dataSourceContextPath", "--output": "output" };
  for (let i = 0; i < argv.length; i++) {
    const key = map[argv[i]];
    if (key && i + 1 < argv.length) o[key] = argv[++i];
  }
  o.output = o.output || ".codex/sql-extraction/sql-extraction-result.json";
  return o;
}

// 找到包含任一 changedLine 的 statement；同一 statement 只取一次
function statementsForChanges(parsed, changedLines) {
  const hits = new Map();
  for (const stmt of parsed.statements) {
    const endLine = stmt.node._endLine || stmt.startLine; // Task 3 onclosetag 已记录
    if (changedLines.some((ln) => ln >= stmt.startLine && ln <= endLine)) {
      hits.set(stmt.startLine, stmt);
    }
  }
  return [...hits.values()];
}

export function buildItems({ changed, repo, source, context }) {
  const items = [];
  for (const { file, changedLines } of changed) {
    const xml = readSourceAtRevision(repo, source, file);
    const parsed = parseMapperXml(xml);
    const mapperJava = tryReadMapperInterface(repo, source, parsed.namespace);
    for (const stmt of statementsForChanges(parsed, changedLines)) {
      const resolvedNode = resolveIncludes(stmt.node, parsed.sqlFragments);
      const templateSql = normalizeXmlSql(resolvedNode);
      if (!templateSql) continue; // 边界不确定则跳过

      const candidates = [];
      if (mapperJava) candidates.push(resolveMapperDataSource(mapperJava, stmt.id)); // method/interface
      // Service 层仅多数据源时尝试；javaFiles 汇集见 main()（此处留空数组=不查）
      const { dataSource, evidence } = resolveDataSource(candidates, context);
      items.push({ dataSource, file: `${file}:${stmt.startLine}`, templateSql, evidence });
    }
  }
  return items;
}

function tryReadMapperInterface(repo, source, namespace) {
  if (!namespace) return null;
  const rel = namespace.replace(/\./g, "/") + ".java";
  for (const base of ["src/main/java/", ""]) {
    try { return readSourceAtRevision(repo, source, base + rel); } catch { /* try next */ }
  }
  return null;
}

export function main(argv) {
  const opts = parseArguments(argv);
  const context = loadDataSourceContext(readFileSync(opts.dataSourceContextPath, "utf-8"));
  if (context.project !== opts.project) {
    throw new Error(`--project (${opts.project}) 与上下文 project (${context.project}) 不一致`);
  }
  const changed = resolveDiff(opts.repoPath, opts.source, opts.target);
  const withEvidence = buildItems({ changed, repo: opts.repoPath, source: opts.source, context });
  const outAbs = isAbsolute(opts.output) ? opts.output : resolve(opts.repoPath, opts.output);
  mkdirSync(dirname(outAbs), { recursive: true });
  const finalJson = { project: context.project, items: withEvidence.map(({ evidence, ...rest }) => rest) };
  writeFileSync(outAbs, JSON.stringify(finalJson, null, 2));
  writeFileSync(join(dirname(outAbs), ".debug-candidates.json"), JSON.stringify({ project: context.project, items: withEvidence }, null, 2));
  console.log(JSON.stringify(finalJson));
  return finalJson;
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exit(1); }
}
```

> **说明（Service 层接线）**：`buildItems` 当前对 Service 层留空（`candidates` 只含 mapper 级）。Service 层需要跨文件 Java 源，属集成增强——在 Step 5 补一个「多数据源时收集候选 Java 文件并追加 `resolveServiceDataSource` 候选」的用例后再接线，避免本步端到端测试引入大量 fixture。若执行到此发现端到端测试已覆盖 Service 需求，则在此追加；否则记入 Task 12 文档的已知限制回归项。

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test {S}/test/e2e.test.mjs`
Expected: PASS（1 test）

- [ ] **Step 5: 补 Service 层接线测试与实现**

Add to `{S}/test/e2e.test.mjs`:

```javascript
test("多数据源 + 唯一 Service @DS 调用方 -> 采用 service-@DS", () => {
  const V1s = `<mapper namespace="cn.demo.ReportMapper"><select id="list">SELECT id FROM user</select></mapper>`;
  const V2s = `<mapper namespace="cn.demo.ReportMapper"><select id="list">SELECT id, name FROM user</select></mapper>`;
  const svc = `class OrderService { private ReportMapper reportMapper; @DS("r") void f(){ reportMapper.list(); } }`;
  const fx = createGitFixture(
    { "m/ReportMapper.xml": V1s, "svc/OrderService.java": svc },
    { "m/ReportMapper.xml": V2s, "svc/OrderService.java": svc }
  );
  try {
    const context = { project: "advert", defaultDataSource: "m", dataSources: ["m", "r"] };
    const changed = resolveDiff(fx.repo, fx.source, fx.target);
    const items = buildItems({ changed, repo: fx.repo, source: fx.source, context });
    assert.equal(items[0].dataSource, "r");
    assert.equal(items[0].evidence, "service-@DS");
  } finally { fx.cleanup(); }
});
```

Modify `buildItems` in `{S}/extract_mybatis_xml_changes.mjs` — 在 mapper 候选之后、`resolveDataSource` 之前追加 Service 候选：

```javascript
      // 仅多数据源、且 mapper 级未取到有效候选时，尝试 Service 层
      const mapperHit = candidates.find((c) => c && context.dataSources.includes(c.name));
      if (!mapperHit && context.dataSources.length > 1) {
        const javaFiles = collectJavaFiles(repo, source);
        const simpleName = parsed.namespace.split(".").pop();
        candidates.push(resolveServiceDataSource(javaFiles, simpleName, stmt.id));
      }
```

Add helper to `{S}/extract_mybatis_xml_changes.mjs`:

```javascript
import { execFileSync } from "node:child_process";
function collectJavaFiles(repo, source) {
  let list = [];
  try {
    list = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", source], { maxBuffer: 50 * 1024 * 1024 })
      .toString("utf-8").split("\n").filter((p) => p.endsWith(".java"));
  } catch { return []; }
  const files = [];
  for (const p of list) {
    try { files.push({ path: p, content: readSourceAtRevision(repo, source, p) }); } catch { /* skip */ }
  }
  return files;
}
```

- [ ] **Step 6: 跑全部测试确认通过**

Run: `node --test {S}/test/`
Expected: PASS（所有测试文件全绿）

- [ ] **Step 7: Commit**

```bash
git add {S}/extract_mybatis_xml_changes.mjs {S}/test/e2e.test.mjs
git commit -m "feat(sql-extract): 入口编排、归属接线与端到端"
```

---

## Task 11: Agent 定义（薄编排）

**Files:**
- Create: `plugins/code-review/agents/mybatis-xml-sql-extractor.md`

**Interfaces:**
- Consumes: 入口脚本调用约定（Task 10 `parseArguments`）。

- [ ] **Step 1: 写 Agent 文件**

Create `plugins/code-review/agents/mybatis-xml-sql-extractor.md`:

```markdown
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
```

- [ ] **Step 2: 校验 frontmatter 合法**

Run: `node -e "const s=require('fs').readFileSync('plugins/code-review/agents/mybatis-xml-sql-extractor.md','utf8'); const m=s.match(/^---\n([\s\S]*?)\n---/); if(!m||!/name:\s*mybatis-xml-sql-extractor/.test(m[1])) { console.error('frontmatter 缺失'); process.exit(1);} console.log('ok')"`
Expected: 输出 `ok`

- [ ] **Step 3: Commit**

```bash
git add plugins/code-review/agents/mybatis-xml-sql-extractor.md
git commit -m "feat(sql-extract): 新增 mybatis-xml-sql-extractor 薄编排 agent"
```

---

## Task 12: 注册 agent + 使用文档

**Files:**
- Modify: `plugins/code-review/.claude-plugin/plugin.json:14-19`
- Create: `{S}/README-sql-extraction.md`

**Interfaces:** 无（发布接线）。

- [ ] **Step 1: 注册 agent 到 plugin.json**

Modify `plugins/code-review/.claude-plugin/plugin.json` 的 `agents` 数组，追加一行（保持 4 空格缩进与逗号）：

```json
    "agents": [
        "./agents/config-reviewer.md",
        "./agents/p3c-reviewer.md",
        "./agents/java-standards-reviewer.md",
        "./agents/db-xml-reviewer.md",
        "./agents/mybatis-xml-sql-extractor.md"
    ],
```

- [ ] **Step 2: 校验 plugin.json 合法**

Run: `node -e "JSON.parse(require('fs').readFileSync('plugins/code-review/.claude-plugin/plugin.json','utf8')); console.log('valid json')"`
Expected: 输出 `valid json`

- [ ] **Step 3: 写使用文档（含已知限制）**

Create `{S}/README-sql-extraction.md`:

```markdown
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
```

- [ ] **Step 4: 跑全量测试回归**

Run: `node --test {S}/test/`
Expected: PASS（全绿）

- [ ] **Step 5: Commit**

```bash
git add plugins/code-review/.claude-plugin/plugin.json {S}/README-sql-extraction.md
git commit -m "feat(sql-extract): 注册 agent 并补充使用文档与已知限制"
```

---

## 附：验收对照（对应 spec §1.1 / §7）

1. XML 任意动态条件变更输出完整所属 statement → Task 3 + Task 10 e2e。
2. `templateSql` 动态标签无属性 → Task 4。
3. 每条有正确 `project` 与配置校验的数据源 → Task 1 + Task 8 + Task 10。
4. 归属四级链优先级正确、Service 仅唯一调用方生效 → Task 6/7/8 + Task 10 Step 5。
5. 最终输出 `{ project, items }` 并保存到指定文件 → Task 10 `main`。
