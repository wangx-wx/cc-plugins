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

test("找不到 refid 保留完整 include", () => {
  const stmt = el("select", {}, [tx("SELECT "), el("include", { refid: "missing" }, []), tx(" FROM t")]);
  const resolved = resolveIncludes(stmt, {});
  assert.equal(normalizeXmlSql(resolved), 'SELECT <include refid="missing"/> FROM t');
});

test("循环引用保留触发循环的完整 include，不无限递归", () => {
  const frags = { a: el("sql", { id: "a" }, [tx("X "), el("include", { refid: "a" }, [])]) };
  const stmt = el("select", {}, [el("include", { refid: "a" }, [])]);
  const resolved = resolveIncludes(stmt, frags);
  assert.equal(normalizeXmlSql(resolved), 'X <include refid="a"/>');
});

test("找不到 include 时保留 property 子节点", () => {
  const stmt = el("select", {}, [
    el("include", { refid: "missing" }, [el("property", { name: "alias", value: "u" }, [])]),
  ]);
  const resolved = resolveIncludes(stmt, {});
  assert.equal(
    normalizeXmlSql(resolved),
    '<include refid="missing"><property name="alias" value="u"/></include>',
  );
});

test("特殊 refid 不读取 Object 原型属性", () => {
  const stmt = el("select", {}, [el("include", { refid: "toString" }, [])]);
  const resolved = resolveIncludes(stmt, {});
  assert.equal(normalizeXmlSql(resolved), '<include refid="toString"/>');
});
