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

test("单行新增 <if> 输出完整 select 模板 SQL 与数据源", () => {
  const fx = createGitFixture({ "m/ReportMapper.xml": V1 }, { "m/ReportMapper.xml": V2 });
  try {
    const context = { project: "advert", defaultDataSource: "m", dataSources: ["m", "r"], dataSourcesAlias: ["m-alias", "r-alias"] };
    const changed = resolveDiff(fx.repo, fx.source, fx.target);
    const items = buildItems({ changed, repo: fx.repo, source: fx.source, context });
    assert.equal(items.length, 1);
    assert.match(items[0].file, /m\/ReportMapper\.xml:2$/);
    assert.equal(items[0].templateSql,
      "SELECT id, name FROM user <where> <if> AND status = ? </if> </where>");
    assert.equal(items[0].dataSource, "m");        // 无 @DS -> 多数据源 default-first
    assert.equal(items[0].dataSourcesAlia, "m-alias");
    assert.equal(items[0].evidence, "default-first");
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
    const context = { project: "advert", defaultDataSource: "m", dataSources: ["m", "r"], dataSourcesAlias: ["m-alias", "r-alias"] };
    const changed = resolveDiff(fx.repo, fx.source, fx.target);
    const items = buildItems({ changed, repo: fx.repo, source: fx.source, context });
    assert.equal(items[0].dataSource, "r");
    assert.equal(items[0].dataSourcesAlia, "r-alias");
    assert.equal(items[0].evidence, "service-@DS");
  } finally { fx.cleanup(); }
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
    const context = { project: "advert", defaultDataSource: "m", dataSources: ["m", "r"], dataSourcesAlias: ["m-alias", "r-alias"] };
    const changed = resolveDiff(fx.repo, fx.source, fx.target);
    const items = buildItems({ changed, repo: fx.repo, source: fx.source, context });
    assert.equal(items.length, 1);
    assert.match(items[0].file, /m\/ReportMapper\.xml:2$/); // startLine=2，非变更行 5
    assert.equal(items[0].templateSql,
      "SELECT id, name FROM user WHERE status = ? AND deleted = ?");
    assert.equal(items[0].dataSource, "m");        // 无 @DS -> 多数据源 default-first
    assert.equal(items[0].dataSourcesAlia, "m-alias");
    assert.equal(items[0].evidence, "default-first");
  } finally {
    fx.cleanup();
  }
});

// main() 端到端：临时 git 仓库带 remote + 映射文件，断言输出 JSON 含 project/gitlabUrl/items，
// items[0] 含 dataSourcesAlia；成功路径不应写 error.log。
test("main() 端到端：输出含 project/gitlabUrl/items，items[0] 含 dataSourcesAlia", () => {
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
    assert.ok(Array.isArray(result.items));
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].dataSource, "m");
    assert.equal(result.items[0].dataSourcesAlia, "m-alias");
    // 顶层 finalJson 的 item 已剥离 evidence
    assert.equal(result.items[0].evidence, undefined);
    // 输出文件落盘且内容一致
    const onDisk = JSON.parse(readFileSync(outputFile, "utf-8"));
    assert.equal(onDisk.project, "advert");
    assert.equal(onDisk.gitlabUrl, REMOTE);
    assert.equal(onDisk.items[0].dataSourcesAlia, "m-alias");
    // 成功路径不应写 error.log
    assert.throws(() => readFileSync(join(tmpDir, "out", "error.log"), "utf-8"));
  } finally {
    fx.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
