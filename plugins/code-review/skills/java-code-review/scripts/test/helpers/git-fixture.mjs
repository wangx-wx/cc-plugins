import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

function git(repo, args) {
  execFileSync("git", ["-C", repo, ...args], { stdio: ["pipe", "pipe", "pipe"] });
}
function writeAll(repo, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(repo, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

// 在 target 分支写 targetFiles 并提交；切 source 分支写 sourceFiles 覆盖并提交。
export function createGitFixture(targetFiles, sourceFiles) {
  const repo = mkdtempSync(join(tmpdir(), "sqlx-"));
  git(repo, ["init", "-q", "-b", "target"]);
  git(repo, ["config", "user.email", "t@t"]);
  git(repo, ["config", "user.name", "t"]);
  writeAll(repo, targetFiles);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "target"]);
  git(repo, ["checkout", "-q", "-b", "source"]);
  writeAll(repo, sourceFiles);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-q", "-m", "source"]);
  return { repo, source: "source", target: "target", cleanup: () => rmSync(repo, { recursive: true, force: true }) };
}
