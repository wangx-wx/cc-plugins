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

test("未展开 include 保留 refid", () => {
  const stmt = el("select", {}, [tx("SELECT "), el("include", { refid: "x" }, []), tx(" FROM t")]);
  assert.equal(normalizeXmlSql(stmt), 'SELECT <include refid="x"/> FROM t');
});

test("collapseWhitespace 保留字符串字面量内空白", () => {
  assert.equal(collapseWhitespace("a   =   'x   y'   AND  b"), "a = 'x   y' AND b");
});
