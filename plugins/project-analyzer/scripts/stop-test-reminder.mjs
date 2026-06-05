#!/usr/bin/env node
// H2 / Stop 软提醒：方法级静态覆盖检查（参考 jacoco 思路，仅静态分析、不跑测试、不阻断）。
// 升级点：从"类有没有 XxxTest 文件"下沉到"本轮变更的 public 方法是否被测试引用且有断言"，
//        并对多分支方法提示 happy+异常用例（jacoco 的 missed / partial 方法的静态近似）。
//        精确分层判断仍交给 /test-review；判断故意从宽（软提醒，低误报优先）。
// 规范见 plugin 内 references/testing-rules.md。

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// ============================================================
// 通用工具
// ============================================================

function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

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

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================
// 文件级豁免（沿用旧逻辑，整文件命中则不进入方法级分析）
// ============================================================

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

// ============================================================
// Java 源码静态解析：中和注释/字符串 → 括号配平 → 提取方法
// ============================================================

// 把注释、字符串、字符、文本块整体替换为等长空白（换行保留），
// 避免其中的 { } ( ) " 干扰括号配平与方法识别；行号与原文严格一致。
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    // 行注释
    if (c === "/" && c2 === "/") {
      out += "  ";
      i += 2;
      while (i < n && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    // 块注释
    if (c === "/" && c2 === "*") {
      out += "  ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "  ";
        i += 2;
      }
      continue;
    }
    // 文本块 """ ... """（JDK15+）
    if (c === '"' && c2 === '"' && src[i + 2] === '"') {
      out += "   ";
      i += 3;
      while (i < n && !(src[i] === '"' && src[i + 1] === '"' && src[i + 2] === '"')) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += "   ";
        i += 3;
      }
      continue;
    }
    // 字符串字面量
    if (c === '"') {
      out += " ";
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === "\\") {
          if (i + 1 < n) {
            out += "  ";
            i += 2;
          } else {
            out += " ";
            i++;
          }
        } else {
          out += src[i] === "\n" ? "\n" : " ";
          i++;
        }
      }
      if (i < n) {
        out += " ";
        i++;
      }
      continue;
    }
    // 字符字面量
    if (c === "'") {
      out += " ";
      i++;
      while (i < n && src[i] !== "'") {
        if (src[i] === "\\") {
          if (i + 1 < n) {
            out += "  ";
            i += 2;
          } else {
            out += " ";
            i++;
          }
        } else {
          out += " ";
          i++;
        }
      }
      if (i < n) {
        out += " ";
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function buildLineStarts(s) {
  const arr = [0];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") arr.push(i + 1);
  }
  return arr;
}

function offsetToLine(lineStarts, off) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= off) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans + 1; // 1-based
}

// depths[i] = 索引 i 之前的 { } 嵌套深度。顶层类成员在 depth===1。
function computeBraceDepths(s) {
  const d = new Int32Array(s.length + 1);
  let cur = 0;
  for (let i = 0; i < s.length; i++) {
    d[i] = cur;
    if (s[i] === "{") cur++;
    else if (s[i] === "}") cur--;
  }
  d[s.length] = cur;
  return d;
}

function matchParen(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") d++;
    else if (s[i] === ")") {
      d--;
      if (d === 0) return i;
    }
  }
  return -1;
}

function matchBrace(s, open) {
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "{") d++;
    else if (s[i] === "}") {
      d--;
      if (d === 0) return i;
    }
  }
  return -1;
}

// 控制流 / 非方法关键字：其后的 ( 不是方法声明。
const CONTROL_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "synchronized", "return", "new",
  "do", "else", "try", "throw", "throws", "instanceof", "assert", "case",
  "super", "this", "yield",
]);
// 前一个词是类型声明关键字 → name( 是类型头而非方法。
const TYPE_DECL_WORDS = new Set(["class", "enum", "interface", "record"]);
const TEST_ANNOTATION_RE = /@(?:[\w.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/;

// 提取顶层类的方法定义（含构造器）。只认带方法体（{...}）的定义，
// 抽象/接口方法（; 结尾，且其所在文件已被文件级豁免）一律不处理。
function parseJavaMethods(rawContent) {
  const neutral = stripCommentsAndStrings(rawContent);
  const lineStarts = buildLineStarts(neutral);
  const depths = computeBraceDepths(neutral);
  const methods = [];
  const re = /([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(neutral)) !== null) {
    const name = m[1];
    const nameStart = m.index;
    const parenOpen = m.index + m[0].length - 1;
    if (CONTROL_KEYWORDS.has(name)) continue;
    // 仅顶层类及其内部类型的方法（排除匿名类/lambda/块语句/方法体内的调用）。
    const mDepth = depths[nameStart];
    if (mDepth < 1 || mDepth > 2) continue;
    if (mDepth === 2) {
      // 验证外层 { 属于内部类型声明（class/interface/enum/record），而非匿名类/lambda/块语句
      let bc = 0, innerBrace = -1;
      for (let j = nameStart - 1; j >= 0; j--) {
        if (neutral[j] === "}") bc--;
        else if (neutral[j] === "{") { bc++; if (bc === 1) { innerBrace = j; break; } }
      }
      if (innerBrace < 0) continue;
      let ds = innerBrace - 1;
      while (ds >= 0 && neutral[ds] !== ";" && neutral[ds] !== "}" && neutral[ds] !== "{") ds--;
      if (!/\b(?:class|interface|enum|record)\b/.test(neutral.slice(ds + 1, innerBrace))) continue;
    }
    // 前一个非空白字符 / 前一个单词：排除方法调用 a.foo(、new Foo(、类型声明 class Foo(
    let p = nameStart - 1;
    while (p >= 0 && /\s/.test(neutral[p])) p--;
    if (p >= 0) {
      // 跳过泛型类型参数 <...>，如 Collections.<String>emptyList() 中 > 前的泛型参数
      if (neutral[p] === ">") {
        let gDepth = 1;
        p--;
        while (p >= 0 && gDepth > 0) {
          if (neutral[p] === ">") gDepth++;
          else if (neutral[p] === "<") gDepth--;
          p--;
        }
        while (p >= 0 && /\s/.test(neutral[p])) p--;
      }
      if (p >= 0) {
        if (neutral[p] === ".") continue;
        let q = p;
        while (q >= 0 && /[\w$]/.test(neutral[q])) q--;
        const prevWord = neutral.slice(q + 1, p + 1);
        if (prevWord === "new" || TYPE_DECL_WORDS.has(prevWord)) continue;
      }
    }
    const parenClose = matchParen(neutral, parenOpen);
    if (parenClose === -1) continue;
    // ) 之后跳过 throws 列表，必须紧跟 { 才是方法体定义
    let k = parenClose + 1;
    while (k < neutral.length && /[\sA-Za-z0-9_$.,<>[\]?@&]/.test(neutral[k])) k++;
    if (neutral[k] !== "{") continue;
    const bodyOpen = k;
    const bodyClose = matchBrace(neutral, bodyOpen);
    if (bodyClose === -1) continue;
    // 签名前缀：回溯到上一个 ; { } 之后，天然包含本方法的注解 + 修饰符 + 返回类型
    let s = nameStart - 1;
    while (s >= 0 && neutral[s] !== ";" && neutral[s] !== "{" && neutral[s] !== "}") s--;
    const prefix = neutral.slice(s + 1, nameStart);
    let firstNon = s + 1;
    while (firstNon < nameStart && /\s/.test(neutral[firstNon])) firstNon++;
    methods.push({
      name,
      isPublic: /\bpublic\b/.test(prefix),
      isTest: TEST_ANNOTATION_RE.test(prefix),
      startLine: offsetToLine(lineStarts, firstNon),
      endLine: offsetToLine(lineStarts, bodyClose),
      bodyText: neutral.slice(bodyOpen, bodyClose + 1),
    });
  }
  return methods;
}

// ============================================================
// 变更行定位：只检查本轮 diff 真正触及的方法
// ============================================================

// 返回本轮变更落在新文件侧的行号集合；untracked / 无 diff 返回 null（视为全文件新增，全部方法触及）。
function changedNewLineNumbers(filePath) {
  const diffs = [
    gitText(["diff", "--unified=0", "--no-ext-diff", "--diff-filter=ACMR", "--", filePath]),
    gitText(["diff", "--cached", "--unified=0", "--no-ext-diff", "--diff-filter=ACMR", "--", filePath]),
  ];
  const set = new Set();
  let any = false;
  const re = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
  for (const diff of diffs) {
    if (!diff) continue;
    for (const line of diff.split(/\r?\n/)) {
      const mm = re.exec(line);
      if (!mm) continue;
      any = true;
      const start = Number(mm[1]);
      const cnt = mm[2] === undefined ? 1 : Number(mm[2]);
      const span = Math.max(cnt, 1);
      for (let l = start; l < start + span; l++) set.add(l);
    }
  }
  return any ? set : null;
}

function rangeIntersects(method, lineSet) {
  for (const l of lineSet) {
    if (l >= method.startLine && l <= method.endLine) return true;
  }
  return false;
}

// ============================================================
// 方法级豁免 + 分支计数
// ============================================================

function countBranches(bodyText) {
  let n = 0;
  n += (bodyText.match(/\bif\s*\(/g) || []).length;
  n += (bodyText.match(/\bcase\b/g) || []).length;
  n += (bodyText.match(/\bcatch\s*\(/g) || []).length;
  n += (bodyText.match(/\bfor\s*\(/g) || []).length;
  n += (bodyText.match(/\bwhile\s*\(/g) || []).length;
  // && 和 ||：中性化后文本中不可能出现在泛型参数内（泛型参数只含类型名/通配符/extends/super）
  n += (bodyText.match(/&&|\|\|/g) || []).length;
  // 三目运算符 ?（排除泛型通配符 ? extends/super/? super 和 ?.）
  const ternaryRe = /\?/g;
  let tm;
  while ((tm = ternaryRe.exec(bodyText)) !== null) {
    const after = bodyText.slice(tm.index + 1).trimStart();
    if (after.startsWith("extends ") || after.startsWith("super ") || after.startsWith(">") || after.startsWith(",")) continue;
    n++;
  }
  return n;
}

// 无逻辑或非业务方法豁免：构造器、简单 getter/setter/is、Object 方法、main。
function isExemptMethod(method, className) {
  const name = method.name;
  if (name === className) return true; // 构造器
  if (name === "toString" || name === "hashCode" || name === "equals" || name === "main") return true;
  if (/^(?:get|set|is)[A-Z0-9_]/.test(name)) {
    const inner = method.bodyText.replace(/^\{/, "").replace(/\}$/, "");
    const stmts = (inner.match(/;/g) || []).length;
    if (countBranches(method.bodyText) === 0 && stmts <= 1) return true; // 纯访问器
  }
  return false;
}

// ============================================================
// 查找测试文件 + 测试方法块 + 覆盖判定
// ============================================================

const TEST_SOURCE_DIRS = ["src/test/java", "src/test/kotlin", "src/test/groovy"];
const TEST_SUFFIXES = ["Test", "Tests", "IT", "ITCase", "Spec"];
const TEST_EXTENSIONS = ["java", "kt", "groovy"];
const TEST_CASE_RE = /(?:^|[^\w])@(?:[\w.]+\.)?(Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate)\b/m;
const SPOCK_FEATURE_RE = /extends\s+Specification\b[\s\S]*\bdef\s+["'][^"']+["']\s*\(/m;
// 断言信号：JUnit assert*、Mockito verify、AssertJ assertThat().isXxx()、Spock then:/expect:。
const ASSERT_RE =
  /\b(?:assert[A-Za-z]*|verify(?:NoInteractions|NoMoreInteractions)?|fail|expectThrows|inOrder)\s*\(|\bassertThat\b|\bMockito\s*\.\s*verify\b|\b(?:then|expect)\s*:|\.\s*(?:isEqualTo|isNotEqualTo|isNotNull|isNull|isTrue|isFalse|contains|containsExactly|containsOnly|hasSize|isInstanceOf|isEqualByComparingTo|isGreaterThan|isLessThan|isPresent|isEmpty|isNotEmpty|isSameAs|hasMessage|hasMessageContaining)\s*\(/;

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

// 返回与被测类对应、且确有测试用例内容的测试文件路径（去重）；空数组表示整类缺测试文件。
function findTestFiles(filePath, baseName, content) {
  const mainInfo = splitMainJavaPath(filePath);
  if (!mainInfo) return [];

  const candidateNames = new Set(testFileNames(baseName));
  const packageDirs = [...new Set([mainInfo.sourceDir, declaredPackageDir(content)])];
  const found = new Set();

  for (const root of testRoots(mainInfo.moduleRoot)) {
    for (const packageDir of packageDirs) {
      for (const candidateName of candidateNames) {
        const candidatePath = path.posix.join(root, packageDir, candidateName);
        if (existsSync(candidatePath) && hasTestCaseContent(candidatePath)) found.add(candidatePath);
      }
    }
  }

  // 同包精确匹配优先；若测试被放在同模块其他包下，也视为已有测试，避免过度提醒。
  for (const root of testRoots(mainInfo.moduleRoot)) {
    for (const testFile of listFiles(root)) {
      if (candidateNames.has(path.posix.basename(testFile)) && hasTestCaseContent(testFile)) {
        found.add(testFile);
      }
    }
  }

  return [...found];
}

const testBlocksCache = new Map();

// 把测试文件切成"测试方法块"（含 @Test 等注解的方法体，中和内容）。
// 解析不到（Spock def "字符串名"、或非常规写法）则整文件回退为单一块。
function parseTestBlocks(testFile) {
  if (testBlocksCache.has(testFile)) return testBlocksCache.get(testFile);
  const content = readText(testFile);
  const testMethods = parseJavaMethods(content).filter((x) => x.isTest);
  let blocks;
  if (testMethods.length > 0) {
    blocks = testMethods.map((x) => x.bodyText);
  } else {
    blocks = [stripCommentsAndStrings(content)];
  }
  testBlocksCache.set(testFile, blocks);
  return blocks;
}

// 在测试文件集合中判断方法是否"被引用 + 同块含断言"。
// 返回 covered（是否覆盖）与 refBlocks（引用它的测试块数，用于分支提示）。
function coverageOf(methodName, testFiles) {
  const refRe = new RegExp("\\b" + escapeRegExp(methodName) + "\\s*\\(");
  let covered = false;
  let refBlocks = 0;
  for (const tf of testFiles) {
    for (const block of parseTestBlocks(tf)) {
      if (refRe.test(block)) {
        refBlocks++;
        if (ASSERT_RE.test(block)) covered = true;
      }
    }
  }
  return { covered, refBlocks };
}

// ============================================================
// 主逻辑
// ============================================================

// 兼容根模块和多模块项目中的 src/main/java 路径。
const MAIN_JAVA_RE = /(?:^|\/)src\/main\/java\/.*\.java$/;
const changed = [
  ...gitLines(["diff", "--name-only", "--diff-filter=ACMR", "HEAD"]),
  ...gitLines(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]),
  ...gitLines(["ls-files", "--others", "--exclude-standard"]),
];
const changedMainFiles = [...new Set(changed.filter((f) => MAIN_JAVA_RE.test(f) && existsSync(f)))];

if (changedMainFiles.length === 0) process.exit(0);

const reports = [];
for (const f of changedMainFiles) {
  const base = path.posix.basename(f, ".java");
  const content = readText(f);
  if (getExemptionReason(base, content)) continue;
  if (getDiffExemptionReason(f)) continue;

  const publicMethods = parseJavaMethods(content).filter((m) => m.isPublic && !isExemptMethod(m, base));
  if (publicMethods.length === 0) continue;

  const changedLines = changedNewLineNumbers(f);
  const touched = changedLines === null ? publicMethods : publicMethods.filter((m) => rangeIntersects(m, changedLines));
  if (touched.length === 0) continue;

  const testFiles = findTestFiles(f, base, content);

  if (testFiles.length === 0) {
    reports.push({ kind: "noTest", file: f, base, methods: [...new Set(touched.map((m) => m.name))] });
    continue;
  }

  const missed = [];
  const partial = [];
  for (const m of touched) {
    const cov = coverageOf(m.name, testFiles);
    if (!cov.covered) {
      missed.push(m.name);
    } else {
      const branches = countBranches(m.bodyText);
      if (branches >= 2 && cov.refBlocks <= 1) partial.push(`${m.name}(${branches}分支)`);
    }
  }
  const missedU = [...new Set(missed)];
  const partialU = [...new Set(partial)];
  if (missedU.length > 0 || partialU.length > 0) {
    reports.push({ kind: "gap", file: f, base, missed: missedU, partial: partialU });
  }
}

if (reports.length === 0) process.exit(0);

const blocks = [];
for (const r of reports.slice(0, 3)) {
  if (r.kind === "noTest") {
    const ms = r.methods.slice(0, 4).join(", ") + (r.methods.length > 4 ? ` 等${r.methods.length}个` : "");
    blocks.push(`  - ${r.file}\n      缺测试类：${r.base}Test / ${r.base}IT（涉及方法：${ms}）`);
  } else {
    const lines = [`  - ${r.file}（已有测试类）`];
    if (r.missed.length > 0) {
      const x = r.missed.slice(0, 6).join(", ") + (r.missed.length > 6 ? ` 等${r.missed.length}个` : "");
      lines.push(`      未覆盖方法：${x}（测试未引用或缺断言）`);
    }
    if (r.partial.length > 0) {
      const x = r.partial.slice(0, 4).join(", ");
      lines.push(`      用例可能不足：${x}（建议补 happy + 异常路径）`);
    }
    blocks.push(lines.join("\n"));
  }
}

const more = reports.length > 3 ? `\n  ...等共 ${reports.length} 个文件` : "";
const msg = `测试提醒：以下 src/main 改动疑似缺对应测试，请按团队规范确认是否需补，或运行 /test-review 精确判断：\n${blocks.join("\n")}${more}`;

process.stdout.write(JSON.stringify({ systemMessage: msg }) + "\n");
process.exit(0);
