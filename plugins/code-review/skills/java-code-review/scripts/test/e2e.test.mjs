import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildItems, main } from "../extract_mybatis_xml_changes.mjs";
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

test("单行新增 <if> 输出完整 select 模板 SQL 与 tables", () => {
  const fx = createGitFixture({ "m/ReportMapper.xml": V1 }, { "m/ReportMapper.xml": V2 });
  try {
    const changed = resolveDiff(fx.repo, fx.source, fx.target);
    const items = buildItems({ changed, repo: fx.repo, source: fx.source });
    assert.equal(items.length, 1);
    assert.match(items[0].file, /m\/ReportMapper\.xml:2$/);
    assert.equal(items[0].templateSql,
      "SELECT id, name FROM user <where> <if> AND status = ? </if> </where>");
    assert.deepEqual(items[0].tables, ["user"]);
    // 归属链已移除：不再有 dataSource/dataSourcesAlia/evidence
    assert.equal(items[0].dataSource, undefined);
    assert.equal(items[0].dataSourcesAlia, undefined);
    assert.equal(items[0].evidence, undefined);
  } finally {
    fx.cleanup();
  }
});

// 多行 <select>：startLine=2，body 跨 3 行（SELECT/FROM/WHERE），</select> 在第 6 行。
// 变更只改第 5 行（WHERE 子句）—— statement body 中间行，不是 startLine（第 2 行）也不是结束标签行。
// 若 _endLine 缺失回退到 startLine(2)，则 changedLine=5 不在 [2,2] → 漏检 → 用例失败。
const V1b = `<mapper namespace="cn.demo.ReportMapper">
  <select id="list">
    SELECT id, name
    FROM user
    WHERE status = #{status}
  </select>
</mapper>`;
const V2b = `<mapper namespace="cn.demo.ReportMapper">
  <select id="list">
    SELECT id, name
    FROM user
    WHERE status = #{status} AND deleted = #{deleted}
  </select>
</mapper>`;

test("变更落在 statement body 中间行（非 startLine）仍正确归属该 statement", () => {
  const fx = createGitFixture({ "m/ReportMapper.xml": V1b }, { "m/ReportMapper.xml": V2b });
  try {
    const changed = resolveDiff(fx.repo, fx.source, fx.target);
    const items = buildItems({ changed, repo: fx.repo, source: fx.source });
    assert.equal(items.length, 1);
    assert.match(items[0].file, /m\/ReportMapper\.xml:2$/); // startLine=2，非变更行 5
    assert.equal(items[0].templateSql,
      "SELECT id, name FROM user WHERE status = ? AND deleted = ?");
    assert.deepEqual(items[0].tables, ["user"]);
    assert.equal(items[0].dataSource, undefined);
    assert.equal(items[0].dataSourcesAlia, undefined);
    assert.equal(items[0].evidence, undefined);
  } finally {
    fx.cleanup();
  }
});

// main() 端到端：临时 git 仓库带 remote + 映射文件，断言输出 JSON 含 project/gitlabUrl/items，
// 顶层 dataSources/dataSourcesAlias；items[0] 含 tables；成功路径不应写 error.log。
test("main() 端到端：输出含 project/gitlabUrl/dataSources/dataSourcesAlias/items，items[0] 含 tables", () => {
  const REMOTE = "git@gitlab.com:team/advert.git";
  const fx = createGitFixture({ "m/ReportMapper.xml": V1 }, { "m/ReportMapper.xml": V2 });
  // createGitFixture 不设 remote；这里补 origin 供 loadProjectMapping 匹配
  execFileSync("git", ["-C", fx.repo, "remote", "add", "origin", REMOTE], { stdio: ["pipe", "pipe", "pipe"] });
  const tmpDir = mkdtempSync(join(tmpdir(), "sqlx-main-"));
  try {
    const mapping = [{
      gitlabUrl: REMOTE,
      project: "advert",
      dataSources: ["m", "r"],
      dataSourcesAlias: ["m-alias", "r-alias"],
    }];
    const mappingFile = join(tmpDir, "mapping.json");
    writeFileSync(mappingFile, JSON.stringify(mapping));
    const outputFile = join(tmpDir, "out", "result.json");
    const result = main([
      "--repo-path", fx.repo,
      "--source", fx.source,
      "--target", fx.target,
      "--project-mapping", mappingFile,
      "--output", outputFile,
    ]);
    // 返回值校验
    assert.equal(result.project, "advert");
    assert.equal(result.gitlabUrl, REMOTE);
    assert.deepEqual(result.dataSources, ["m", "r"]);
    assert.deepEqual(result.dataSourcesAlias, ["m-alias", "r-alias"]);
    assert.ok(Array.isArray(result.items));
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0].tables, ["user"]);
    // 归属链已移除：items 不再有 dataSource/dataSourcesAlia/evidence
    assert.equal(result.items[0].dataSource, undefined);
    assert.equal(result.items[0].dataSourcesAlia, undefined);
    assert.equal(result.items[0].evidence, undefined);
    // 输出文件落盘且内容一致
    const onDisk = JSON.parse(readFileSync(outputFile, "utf-8"));
    assert.equal(onDisk.project, "advert");
    assert.equal(onDisk.gitlabUrl, REMOTE);
    assert.deepEqual(onDisk.dataSources, ["m", "r"]);
    assert.deepEqual(onDisk.dataSourcesAlias, ["m-alias", "r-alias"]);
    assert.deepEqual(onDisk.items[0].tables, ["user"]);
    // .debug-candidates.json 不再写
    assert.throws(() => readFileSync(join(tmpDir, "out", ".debug-candidates.json"), "utf-8"));
    // 成功路径不应写 error.log
    assert.throws(() => readFileSync(join(tmpDir, "out", "error.log"), "utf-8"));
  } finally {
    fx.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
