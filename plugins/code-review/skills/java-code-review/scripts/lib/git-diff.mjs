import { execFileSync } from "node:child_process";

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 50 * 1024 * 1024 }).toString("utf-8");
}

export function isMapperXml(content) {
  return /<mapper\b/.test(content) && /namespace\s*=/.test(content);
}

export function readSourceAtRevision(repo, rev, file) {
  return git(repo, ["show", `${rev}:${file}`]);
}

// 解析 git diff -U0 的 source 侧新增/修改行号（@@ -a,b +c,d @@ 中的 c..c+d-1）
function parseChangedLines(diffText) {
  const lines = [];
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let m;
  while ((m = re.exec(diffText)) !== null) {
    const start = parseInt(m[1], 10);
    const count = m[2] === undefined ? 1 : parseInt(m[2], 10);
    if (count === 0) lines.push(start); // 纯删除 hunk（+c,0）：用 source 锚点行 c 命中所属 statement
    else for (let i = 0; i < count; i++) lines.push(start + i);
  }
  return lines;
}

export function resolveDiff(repo, source, target) {
  let base;
  try {
    base = git(repo, ["merge-base", target, source]).trim();
  } catch {
    base = "";
  }
  if (!base) throw new Error(`${target} 与 ${source} 无共同祖先，无法执行三点 diff`);

  const nameOnly = git(repo, [
    "diff", "--name-only", "--diff-filter=ACMR", `${target}...${source}`,
    "--", "*.xml", ":(exclude)*pom.xml",
  ]).split("\n").map((s) => s.trim()).filter(Boolean);

  const result = [];
  for (const file of nameOnly) {
    let content;
    try {
      content = readSourceAtRevision(repo, source, file);
    } catch {
      continue; // source 中不存在（纯删除文件）跳过
    }
    if (!isMapperXml(content)) continue;
    const diffText = git(repo, [
      "diff", "-U0", "--diff-filter=ACMR", `${target}...${source}`, "--", file,
    ]);
    const changedLines = parseChangedLines(diffText);
    if (changedLines.length > 0) result.push({ file, changedLines });
  }
  return result;
}
