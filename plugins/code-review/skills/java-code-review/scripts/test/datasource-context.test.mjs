import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectMapping } from "../lib/datasource.mjs";

// 构造临时 git 仓库并设置 origin remote，返回 { repo, cleanup }。
function createRepoWithRemote(remoteUrl) {
  const repo = mkdtempSync(join(tmpdir(), "sqlx-pm-"));
  execFileSync("git", ["-C", repo, "init", "-q"], { stdio: ["pipe", "pipe", "pipe"] });
  execFileSync("git", ["-C", repo, "remote", "add", "origin", remoteUrl], { stdio: ["pipe", "pipe", "pipe"] });
  return { repo, cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}

const REMOTE = "git@gitlab.com:team/advert.git";

function entry(overrides = {}) {
  return {
    gitlabUrl: REMOTE,
    project: "advert",
    dataSources: ["master", "replica"],
    dataSourcesAlias: ["m", "r"],
    ...overrides,
  };
}

test("1. 合法输入 + 命中：返回完整项目上下文", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    const out = loadProjectMapping(JSON.stringify([entry()]), repo);
    assert.equal(out.project, "advert");
    assert.deepEqual(out.dataSources, ["master", "replica"]);
    assert.deepEqual(out.dataSourcesAlias, ["m", "r"]);
    assert.equal(out.gitlabUrl, REMOTE);
    assert.equal(out.defaultDataSource, "master");
  } finally {
    cleanup();
  }
});

test("2. URL 大小写差异归一化后命中", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    const arr = [entry({ gitlabUrl: "GIT@Gitlab.com:Team/ADVERT.git" })];
    const out = loadProjectMapping(JSON.stringify(arr), repo);
    assert.equal(out.project, "advert");
  } finally {
    cleanup();
  }
});

test("3. remote 带 .git 后缀、映射条目无 → 归一化后命中", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    const arr = [entry({ gitlabUrl: "git@gitlab.com:team/advert" })];
    const out = loadProjectMapping(JSON.stringify(arr), repo);
    assert.equal(out.project, "advert");
  } finally {
    cleanup();
  }
});

test("4. 仓库无 remote → 抛错包含 remote url", () => {
  const repo = mkdtempSync(join(tmpdir(), "sqlx-noremote-"));
  try {
    execFileSync("git", ["-C", repo, "init", "-q"], { stdio: ["pipe", "pipe", "pipe"] });
    assert.throws(
      () => loadProjectMapping(JSON.stringify([entry()]), repo),
      /remote url/
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("5. 映射文件非数组 → 抛错包含 数组", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    assert.throws(
      () => loadProjectMapping(JSON.stringify({ project: "x" }), repo),
      /数组/
    );
  } finally {
    cleanup();
  }
});

test("6. 任一条缺 gitlabUrl → 抛错包含 gitlabUrl", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    const arr = [{ project: "p", dataSources: ["m"], dataSourcesAlias: ["m"] }];
    assert.throws(
      () => loadProjectMapping(JSON.stringify(arr), repo),
      /gitlabUrl/
    );
  } finally {
    cleanup();
  }
});

test("7. 仓库 remote 与所有条目都不匹配 → 抛错包含 未在项目映射中", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    const arr = [entry({ gitlabUrl: "git@gitlab.com:other/repo.git" })];
    assert.throws(
      () => loadProjectMapping(JSON.stringify(arr), repo),
      /未在项目映射中/
    );
  } finally {
    cleanup();
  }
});

test("8. 匹配条目 project 为空 → 抛错包含 project", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    const arr = [entry({ project: "" })];
    assert.throws(
      () => loadProjectMapping(JSON.stringify(arr), repo),
      /project/
    );
  } finally {
    cleanup();
  }
});

test("9. 匹配条目 dataSources 为空数组 → 抛错包含 dataSources", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    const arr = [entry({ dataSources: [], dataSourcesAlias: [] })];
    assert.throws(
      () => loadProjectMapping(JSON.stringify(arr), repo),
      /dataSources/
    );
  } finally {
    cleanup();
  }
});

test("10. dataSources 与 dataSourcesAlias 长度不等 → 抛错包含 长度与 dataSources 不一致", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    const arr = [entry({ dataSources: ["master", "replica"], dataSourcesAlias: ["m"] })];
    assert.throws(
      () => loadProjectMapping(JSON.stringify(arr), repo),
      /长度与 dataSources 不一致/
    );
  } finally {
    cleanup();
  }
});

test("11. JSON 不合法 → 抛错包含 不是合法 JSON", () => {
  const { repo, cleanup } = createRepoWithRemote(REMOTE);
  try {
    assert.throws(
      () => loadProjectMapping("{not json", repo),
      /不是合法 JSON/
    );
  } finally {
    cleanup();
  }
});
