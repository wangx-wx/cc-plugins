import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("plugins/code-review/skills/java-code-review/scripts/extract_mybatis_xml_changes.mjs");

test("--help 输出用法并成功退出", () => {
  const result = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf-8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--repo-path/);
});

test("参数缺少值不创建误导性目录", () => {
  const cwd = mkdtempSync(join(tmpdir(), "sqlx-cli-args-"));
  try {
    const result = spawnSync(process.execPath, [
      SCRIPT,
      "--repo-path", "--source", "source",
      "--target", "target",
      "--project-mapping", "mapping.json",
    ], { cwd, encoding: "utf-8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--repo-path 缺少值/);
    assert.equal(existsSync(join(cwd, "--source")), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
