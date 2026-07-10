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
