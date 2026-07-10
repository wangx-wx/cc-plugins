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
