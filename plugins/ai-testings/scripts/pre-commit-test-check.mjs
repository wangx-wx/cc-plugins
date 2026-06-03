#!/usr/bin/env node
// H4 / PreToolUse(Bash) 软提醒：仅当命令是 git commit 时，检查暂存的 src/main 改动缺测试则提示（不阻断）。
// 规范见 plugin 内 references/testing-rules.md。判断故意做"粗"，精确分层判断交给 /test-review。

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

// ---- 豁免判断 ----

const EXEMPT_SUFFIXES = ["DTO", "VO", "Entity", "Config", "Constant", "Constants", "Enum", "Properties"];

// FIX 1: 补充 @interface（Java 注解类型），与 H2 保持一致
const TYPE_KEYWORD_RE = /^\s*(public\s+)?(@interface|abstract\s+class|interface|enum)\b/m;

function isExemptBySuffix(baseName) {
  return EXEMPT_SUFFIXES.some((s) => baseName.endsWith(s));
}

function isExemptByKeyword(filePath) {
  try {
    const content = readFileSync(filePath, "utf8");
    return TYPE_KEYWORD_RE.test(content);
  } catch {
    return false;
  }
}

// FIX 2: 用 find 替代 git ls-files + **glob，与 H2 保持一致
function hasTestFile(baseName) {
  try {
    const out = execSync(
      `find . \\( -name "${baseName}Test.java" -o -name "${baseName}IT.java" \\) -path "*/src/test/java/*" 2>/dev/null`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    );
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

// ---- 主逻辑 ----

let input = "";
try {
  input = readFileSync("/dev/stdin", "utf8");
} catch {
  process.exit(0);
}

let command = "";
try {
  command = JSON.parse(input).tool_input?.command ?? "";
} catch {
  process.exit(0);
}

// 只在 git commit 时介入
if (!command.includes("git commit")) process.exit(0);

// FIX 3: 多模块路径正则，与 H2 保持一致
// 原正则 ^src/main 只匹配单模块，多模块路径 module-a/src/main/... 会被完全漏掉
const MAIN_JAVA_RE = /(?:^|\/)src\/main\/java\/.*\.java$/;

let staged;
try {
  const out = execSync("git diff --cached --name-only", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],  // FIX 4: 补全 stdio，stderr 静默
  });
  staged = out.split("\n").filter((f) => MAIN_JAVA_RE.test(f));
} catch {
  process.exit(0);
}

if (staged.length === 0) process.exit(0);

const missing = [];
for (const f of staged) {
  const base = basename(f, ".java");
  if (isExemptBySuffix(base)) continue;
  if (isExemptByKeyword(f)) continue;
  if (!hasTestFile(base)) {
    missing.push(`  - ${f}  (缺 ${base}Test / ${base}IT)`);
  }
}

if (missing.length === 0) process.exit(0);

const listed = missing.slice(0, 2).join("\n");
const more = missing.length > 2 ? `\n  ...等共 ${missing.length} 个文件` : "";
const msg = `提交前测试提醒（不阻断）：本次暂存的 src/main 改动疑似缺对应测试：\n${listed}${more}\n按团队规范确认是否需补（/test-review 精确判断）。`;

process.stdout.write(JSON.stringify({ systemMessage: msg }) + "\n");
process.exit(0);