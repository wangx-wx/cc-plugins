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
