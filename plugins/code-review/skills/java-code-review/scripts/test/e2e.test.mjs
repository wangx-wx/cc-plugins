import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildItems, main } from "../extract_mybatis_xml_changes.mjs";
import { createGitFixture } from "./helpers/git-fixture.mjs";
import { resolveDiff, resolveDiffContext } from "../lib/git-diff.mjs";

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
    assert.equal(result.gitBranch, fx.source);
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
    assert.equal(onDisk.gitBranch, fx.source);
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

// 不传 --project-mapping：脚本使用相对路径默认文件 <scriptDir>/datasource/project_datasources.json
test("main() 端到端：不传 --project-mapping 时使用默认相对路径映射文件", () => {
  const REMOTE = "http://gitlab.leyaoyao.com/ai/observability/starsmith.git";
  const fx = createGitFixture({ "m/ReportMapper.xml": V1 }, { "m/ReportMapper.xml": V2 });
  execFileSync("git", ["-C", fx.repo, "remote", "add", "origin", REMOTE], { stdio: ["pipe", "pipe", "pipe"] });
  const tmpDir = mkdtempSync(join(tmpdir(), "sqlx-default-"));
  try {
    const outputFile = join(tmpDir, "out", "result.json");
    // 不传 --project-mapping：脚本读默认 <scriptDir>/datasource/project_datasources.json
    const result = main([
      "--repo-path", fx.repo,
      "--source", fx.source,
      "--target", fx.target,
      "--output", outputFile,
    ]);
    // 默认映射含 starsmith 条目：project=starsmith, dataSources=[starsmith], alias=[starsmith-prod]
    assert.equal(result.project, "starsmith");
    assert.equal(result.gitlabUrl, REMOTE);
    assert.deepEqual(result.dataSources, ["starsmith"]);
    assert.deepEqual(result.dataSourcesAlias, ["starsmith-prod"]);
    assert.ok(Array.isArray(result.items));
  } finally {
    fx.cleanup();
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function buildProjectItems(fx) {
  const diff = resolveDiffContext(fx.repo, fx.source, fx.target);
  return buildItems({ ...diff, repo: fx.repo, source: fx.source });
}

test("只修改同文件共享 sql fragment 时输出依赖 statement", () => {
  const before = `<mapper namespace="demo.M">
  <sql id="cols">id</sql>
  <select id="list">SELECT <include refid="cols"/> FROM users</select>
</mapper>`;
  const after = before.replace("id</sql>", "id, name</sql>");
  const fx = createGitFixture({ "m/M.xml": before }, { "m/M.xml": after });
  try {
    const items = buildProjectItems(fx);
    assert.equal(items.length, 1);
    assert.equal(items[0].templateSql, "SELECT id, name FROM users");
  } finally { fx.cleanup(); }
});

test("跨 Mapper fragment 变化时输出未直接修改的依赖 statement", () => {
  const baseBefore = `<mapper namespace="common.Base">
  <sql id="cols">id</sql>
</mapper>`;
  const baseAfter = baseBefore.replace("id</sql>", "id, name</sql>");
  const query = `<mapper namespace="demo.Query">
  <select id="list">SELECT <include refid="common.Base.cols"/> FROM users</select>
</mapper>`;
  const fx = createGitFixture(
    { "m/Base.xml": baseBefore, "m/Query.xml": query },
    { "m/Base.xml": baseAfter, "m/Query.xml": query },
  );
  try {
    const items = buildProjectItems(fx);
    assert.equal(items.length, 1);
    assert.match(items[0].file, /^m\/Query\.xml:2$/);
    assert.equal(items[0].templateSql, "SELECT id, name FROM users");
  } finally { fx.cleanup(); }
});

test("多层 fragment 依赖向上传播", () => {
  const before = `<mapper namespace="demo.M">
  <sql id="table">users</sql>
  <sql id="from">FROM <include refid="table"/></sql>
  <select id="list">SELECT id <include refid="from"/></select>
</mapper>`;
  const after = before.replace("users</sql>", "active_users</sql>");
  const fx = createGitFixture({ "m/M.xml": before }, { "m/M.xml": after });
  try {
    const items = buildProjectItems(fx);
    assert.equal(items.length, 1);
    assert.equal(items[0].templateSql, "SELECT id FROM active_users");
  } finally { fx.cleanup(); }
});

test("修改未被引用的 fragment 不输出 item", () => {
  const before = `<mapper namespace="demo.M">
  <sql id="unused">old_value</sql>
  <select id="list">SELECT id FROM users</select>
</mapper>`;
  const after = before.replace("old_value", "new_value");
  const fx = createGitFixture({ "m/M.xml": before }, { "m/M.xml": after });
  try {
    assert.deepEqual(buildProjectItems(fx), []);
  } finally { fx.cleanup(); }
});

test("删除 fragment 后输出依赖 statement，并保留找不到的 include", () => {
  const before = `<mapper namespace="demo.M">
  <sql id="cols">id, name</sql>
  <select id="list">SELECT <include refid="cols"/> FROM users</select>
</mapper>`;
  const after = `<mapper namespace="demo.M">
  <select id="list">SELECT <include refid="cols"/> FROM users</select>
</mapper>`;
  const fx = createGitFixture({ "m/M.xml": before }, { "m/M.xml": after });
  try {
    const items = buildProjectItems(fx);
    assert.equal(items.length, 1);
    assert.equal(items[0].templateSql, 'SELECT <include refid="cols"/> FROM users');
  } finally { fx.cleanup(); }
});

test("statement 与依赖 fragment 同时变化时只输出一次", () => {
  const before = `<mapper namespace="demo.M">
  <sql id="cols">id</sql>
  <select id="list">SELECT <include refid="cols"/> FROM users</select>
</mapper>`;
  const after = `<mapper namespace="demo.M">
  <sql id="cols">id, name</sql>
  <select id="list">SELECT <include refid="cols"/> FROM active_users</select>
</mapper>`;
  const fx = createGitFixture({ "m/M.xml": before }, { "m/M.xml": after });
  try {
    const items = buildProjectItems(fx);
    assert.equal(items.length, 1);
    assert.equal(items[0].templateSql, "SELECT id, name FROM active_users");
  } finally { fx.cleanup(); }
});

test("删除提供 fragment 的 Mapper 文件后输出其他 Mapper 的未解析依赖", () => {
  const base = `<mapper namespace="common.Base">
  <sql id="cols">id, name</sql>
</mapper>`;
  const query = `<mapper namespace="demo.Query">
  <select id="list">SELECT <include refid="common.Base.cols"/> FROM users</select>
</mapper>`;
  const fx = createGitFixture(
    { "README.md": "before", "m/Base.xml": base, "m/Query.xml": query },
    { "README.md": "after", "m/Base.xml": base, "m/Query.xml": query },
  );
  try {
    execFileSync("git", ["-C", fx.repo, "rm", "-q", "m/Base.xml"], { stdio: ["pipe", "pipe", "pipe"] });
    execFileSync("git", ["-C", fx.repo, "commit", "-q", "-m", "remove base"], { stdio: ["pipe", "pipe", "pipe"] });
    const items = buildProjectItems(fx);
    assert.equal(items.length, 1);
    assert.match(items[0].file, /^m\/Query\.xml:2$/);
    assert.equal(items[0].templateSql, 'SELECT <include refid="common.Base.cols"/> FROM users');
  } finally { fx.cleanup(); }
});

test("完整删除中间 statement 不误报前一个 statement", () => {
  const before = `<mapper namespace="demo.M">
  <select id="before">SELECT * FROM before_table</select>
  <select id="removed">SELECT * FROM removed_table</select>
  <select id="after">SELECT * FROM after_table</select>
</mapper>`;
  const after = `<mapper namespace="demo.M">
  <select id="before">SELECT * FROM before_table</select>
  <select id="after">SELECT * FROM after_table</select>
</mapper>`;
  const fx = createGitFixture({ "m/M.xml": before }, { "m/M.xml": after });
  try {
    assert.deepEqual(buildProjectItems(fx), []);
  } finally { fx.cleanup(); }
});

test("重命名并修改 Mapper 时使用 source 的新路径", () => {
  const before = `<mapper namespace="demo.M">
  <select id="list">SELECT id FROM users</select>
</mapper>`;
  const after = `<mapper namespace="demo.M">
  <select id="list">SELECT id, name FROM users</select>
</mapper>`;
  const fx = createGitFixture({ "m/Old.xml": before }, { "m/New.xml": after });
  try {
    execFileSync("git", ["-C", fx.repo, "rm", "-q", "m/Old.xml"], { stdio: ["pipe", "pipe", "pipe"] });
    execFileSync("git", ["-C", fx.repo, "commit", "-q", "-m", "remove old mapper"], { stdio: ["pipe", "pipe", "pipe"] });
    const items = buildProjectItems(fx);
    assert.equal(items.length, 1);
    assert.match(items[0].file, /^m\/New\.xml:2$/);
    assert.equal(items[0].templateSql, "SELECT id, name FROM users");
  } finally { fx.cleanup(); }
});
