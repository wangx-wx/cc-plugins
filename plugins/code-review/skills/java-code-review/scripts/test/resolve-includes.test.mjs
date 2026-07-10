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
