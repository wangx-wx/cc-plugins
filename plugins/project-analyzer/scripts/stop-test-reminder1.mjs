#!/usr/bin/env node
// H2 / Stop 软提醒：本轮若改了 src/main 的 .java 但缺对应测试，提示（不阻断，仅 systemMessage）。
// 规范见 plugin 内 references/testing-rules.md。判断故意做"粗"，精确分层判断交给 /test-review。

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ---- 豁免判断 ----

const EXEMPT_SUFFIXES = [
  "DTO",
  "VO",
  "Entity",
  "Config",
  "Configuration",
  "Constant",
  "Constants",
  "Enum",
  "Properties",
];

// 补充 @interface（Java 注解类型），避免注解类误报。
const TYPE_KEYWORD_RE = /^\s*(public\s+)?(@interface|abstract\s+class|interface|enum)\b/m;
const EXEMPT_MARKER_RE = /(?:test-reminder|unit-test|单元测试|单测)\s*[:：]\s*(?:ignore|skip|exempt|豁免|跳过|无需)/i;
const EXEMPT_ANNOTATION_RE = /^\s*@(SpringBootApplication|ConfigurationProperties)\b/m;
const LOW_RISK_CONSTANT_NAME_RE =
  /(?:LOG|LOGGER|TAG|LABEL|TITLE|TEXT|MESSAGE|MSG|DESC|DESCRIPTION|DISPLAY|PLACEHOLDER|PROMPT|HINT|HEADER|FOOTER|COLUMN|FORMAT)$/i;
const HIGH_RISK_CONSTANT_NAME_RE =
  /(?:AMOUNT|BALANCE|PRICE|FEE|RATE|RATIO|LIMIT|THRESHOLD|TIMEOUT|RETRY|COUNT|SIZE|STATUS|STATE|TYPE|CODE|ROLE|PERMISSION|AUTH|URL|URI|ENDPOINT|HOST|PORT|TOPIC|QUEUE|CACHE|KEY|PATTERN|REGEX|SQL|QUERY|TOKEN|SECRET|PASSWORD|TTL|EXPIRE|EXPIRATION|INTERVAL|PERIOD|DURATION|DAY|DAYS|HOUR|HOURS|MINUTE|MINUTES|SECOND|SECONDS|MILLI|LEVEL|PRIORITY|SCORE)$/i;
const STRING_CONSTANT_RE =
  /^(?:(?:public|protected|private)\s+)?(?:static\s+final|final\s+static)\s+(?:String|char|Character)\s+([A-Za-z_][\w]*)\s*=\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])')\s*;\s*(?:\/\/.*)?$/;

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function getExemptionReason(baseName, content) {
  const suffix = EXEMPT_SUFFIXES.find((s) => baseName.endsWith(s));
  if (suffix) return `后缀 ${suffix}`;

  if (EXEMPT_MARKER_RE.test(content)) return "显式豁免标记";
  if (TYPE_KEYWORD_RE.test(content)) return "类型声明豁免";
  if (EXEMPT_ANNOTATION_RE.test(content)) return "框架启动/配置类豁免";

  return "";
}

function isCommentOrImportLine(line) {
  const trimmed = line.trim();
  return (
    trimmed === "" ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("*/") ||
    trimmed.startsWith("import ") ||
    trimmed.startsWith("import static ")
  );
}

function isLowRiskConstantLine(line) {
  const match = line.trim().match(STRING_CONSTANT_RE);
  if (!match) return false;

  const name = match[1];
  return LOW_RISK_CONSTANT_NAME_RE.test(name) && !HIGH_RISK_CONSTANT_NAME_RE.test(name);
}

function changedDiffLines(filePath) {
  const diffs = [
    gitText(["diff", "--unified=0", "--no-ext-diff", "--diff-filter=ACMR", "--", filePath]),
    gitText(["diff", "--cached", "--unified=0", "--no-ext-diff", "--diff-filter=ACMR", "--", filePath]),
  ];
  const changedLines = [];

  for (const diff of diffs) {
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
      if (line.startsWith("+") || line.startsWith("-")) changedLines.push(line.slice(1));
    }
  }

  return changedLines;
}

function getDiffExemptionReason(filePath) {
  const lines = changedDiffLines(filePath);
  if (lines.length === 0) return "";
  if (lines.every(isCommentOrImportLine)) return "仅注释/import 变更";
  if (lines.every((line) => isCommentOrImportLine(line) || isLowRiskConstantLine(line))) {
    return "仅低风险常量变更";
  }

  return "";
}

// ---- 查找测试文件 ----

const TEST_SOURCE_DIRS = ["src/test/java", "src/test/kotlin", "src/test/groovy"];
const TEST_SUFFIXES = ["Test", "Tests", "IT", "ITCase", "Spec"];
const TEST_EXTENSIONS = ["java", "kt", "groovy"];
const TEST_CASE_RE = /(?:^|[^\w])@(?:[\w.]+\.)?(Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/m;
const SPOCK_FEATURE_RE = /extends\s+Specification\b[\s\S]*\bdef\s+["'][^"']+["']\s*\(/m;
const testFilesByRoot = new Map();

function splitMainJavaPath(filePath) {
  const rootMarker = "src/main/java/";
  const moduleMarker = "/src/main/java/";
  const idx = filePath.indexOf(moduleMarker);
  const moduleRoot = idx === -1 ? "" : filePath.slice(0, idx);
  const sourcePath = idx === -1 ? filePath.slice(rootMarker.length) : filePath.slice(idx + moduleMarker.length);

  if (idx === -1 && !filePath.startsWith(rootMarker)) return null;

  const sourceDir = path.posix.dirname(sourcePath);

  return {
    moduleRoot,
    sourceDir: sourceDir === "." ? "" : sourceDir,
  };
}

function declaredPackageDir(content) {
  const match = content.match(/^\s*package\s+([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\s*;/m);
  return match ? match[1].replaceAll(".", "/") : "";
}

function testFileNames(baseName) {
  const names = [];
  for (const suffix of TEST_SUFFIXES) {
    for (const ext of TEST_EXTENSIONS) {
      names.push(`${baseName}${suffix}.${ext}`);
    }
  }
  return names;
}

function testRoots(moduleRoot) {
  return TEST_SOURCE_DIRS.map((dir) => path.posix.join(moduleRoot, dir));
}

function listFiles(root) {
  if (testFilesByRoot.has(root)) return testFilesByRoot.get(root);
  if (!existsSync(root)) {
    testFilesByRoot.set(root, []);
    return [];
  }

  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.posix.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }

  testFilesByRoot.set(root, files);
  return files;
}

function hasTestCaseContent(testFile) {
  const content = readText(testFile);
  return TEST_CASE_RE.test(content) || SPOCK_FEATURE_RE.test(content);
}

function hasTestFile(filePath, baseName, content) {
  const mainInfo = splitMainJavaPath(filePath);
  if (!mainInfo) return false;

  const candidateNames = new Set(testFileNames(baseName));
  const packageDirs = [...new Set([mainInfo.sourceDir, declaredPackageDir(content)])];

  for (const root of testRoots(mainInfo.moduleRoot)) {
    for (const packageDir of packageDirs) {
      for (const candidateName of candidateNames) {
        const candidatePath = path.posix.join(root, packageDir, candidateName);
        if (existsSync(candidatePath) && hasTestCaseContent(candidatePath)) return true;
      }
    }
  }

  // 同包精确匹配优先；若测试被放在同模块其他包下，也视为已有测试，避免过度提醒。
  for (const root of testRoots(mainInfo.moduleRoot)) {
    for (const testFile of listFiles(root)) {
      if (candidateNames.has(path.posix.basename(testFile)) && hasTestCaseContent(testFile)) return true;
    }
  }

  return false;
}

// ---- 变更文件收集 ----

function gitLines(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function gitText(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

// ---- 主逻辑 ----

// 兼容根模块和多模块项目中的 src/main/java 路径。
const MAIN_JAVA_RE = /(?:^|\/)src\/main\/java\/.*\.java$/;
const changed = [
  ...gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
  ...gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
  ...gitLines(["ls-files", "--others", "--exclude-standard"]),
];
const changedMainFiles = [...new Set(changed.filter((f) => MAIN_JAVA_RE.test(f) && existsSync(f)))];

if (changedMainFiles.length === 0) process.exit(0);

const missing = [];
for (const f of changedMainFiles) {
  const base = path.posix.basename(f, ".java");
  const content = readText(f);
  if (getExemptionReason(base, content)) continue;
  if (getDiffExemptionReason(f)) continue;

  if (!hasTestFile(f, base, content)) {
    missing.push(`  - ${f}  (缺同模块有效测试：${base}Test / ${base}Tests / ${base}IT / ${base}ITCase / ${base}Spec)`);
  }
}

if (missing.length === 0) process.exit(0);

const listed = missing.slice(0, 2).join("\n");
const more = missing.length > 2 ? `\n  ...等共 ${missing.length} 个文件` : "";
const msg = `测试提醒：以下 src/main 改动疑似缺对应测试，请按团队规范确认是否需补，或运行 /test-review 精确判断：\n${listed}${more}`;

process.stdout.write(JSON.stringify({ systemMessage: msg }) + "\n");
process.exit(0);
