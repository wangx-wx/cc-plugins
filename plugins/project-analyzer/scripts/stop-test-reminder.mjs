#!/usr/bin/env node
// H2 / Stop 软提醒：本轮若改了 src/main 的 .java 但缺对应测试，提示（不阻断，仅 systemMessage）。
// 规范见 plugin 内 references/testing-rules.md。判断故意做"粗"，精确分层判断交给 /test-review。

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

// ---- 豁免判断 ----

const EXEMPT_SUFFIXES = ["DTO", "VO", "Entity", "Config", "Constant", "Constants", "Enum", "Properties"];

// FIX 3: 补充 @interface（Java 注解类型），避免注解类误报
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

// ---- 查找测试文件 ----

// FIX 1: 用 find 替代 git ls-files + **glob
// git ls-files 的 ** 在大多数 Git 版本里是字面量，无法匹配多层级目录。
// find 的 -name 通配符行为可靠，且覆盖单模块和多模块项目。
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

// FIX 4: 拆成两次独立调用，分别 try/catch
// 原来合并在一条 shell 命令里，初始仓库（HEAD 不存在）时整体 catch，导致 staged 文件也丢失。
let rawDiff = "";
try {
  rawDiff += execSync("git diff --name-only HEAD", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });
} catch {
  // HEAD 不存在（初始仓库）时正常忽略，不影响 staged 文件收集
}
try {
  rawDiff += execSync("git diff --cached --name-only", {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"],
  });
} catch {
  // staged 区读取失败时忽略
}

// FIX 2: 正则从 ^src/main 改为 (?:^|\/)src/main，兼容多模块项目路径
// 多模块项目中路径形如 module-a/src/main/java/...，原正则完全匹配不到。
const MAIN_JAVA_RE = /(?:^|\/)src\/main\/java\/.*\.java$/;
const changed = [...new Set(rawDiff.split("\n").filter((f) => MAIN_JAVA_RE.test(f)))];

if (changed.length === 0) process.exit(0);

const missing = [];
for (const f of changed) {
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
const msg = `测试提醒（仅提示，不阻断）：以下 src/main 改动疑似缺对应测试，请按团队规范确认是否需补，或输入使用 testkit-gen 生成单元测试 精确判断：\n${listed}${more}`;

process.stdout.write(JSON.stringify({ systemMessage: msg }) + "\n");
process.exit(0);