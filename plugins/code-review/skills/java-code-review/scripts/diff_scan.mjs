/**
 * Git 分支差异扫描 + P3C 代码审查合并脚本
 *
 * 功能:
 * - 获取两个分支之间的变更文件
 * - 对变更文件执行 P3C 检查
 * - 转换输出格式为简化数组
 * - 支持优先级过滤（默认 2 级）
 *
 * 用法:
 *   node diff_scan.mjs <repo> --source <branch> [--target <branch>] [--priority <1-5>] [-v]
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCRIPT_DIR = __dirname;
const LIB_DIR = join(SCRIPT_DIR, "lib");

let VERBOSE = false;

function log(msg) {
  if (VERBOSE) console.error(`DEBUG: ${msg}`);
}
function warn(msg) {
  console.error(`WARNING: ${msg}`);
}
function fatal(msg) {
  console.error(msg);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const P3C_RULESETS = [
  "rulesets/java/ali-comment.xml",
  "rulesets/java/ali-concurrent.xml",
  "rulesets/java/ali-constant.xml",
  "rulesets/java/ali-exception.xml",
  "rulesets/java/ali-flowcontrol.xml",
  "rulesets/java/ali-naming.xml",
  "rulesets/java/ali-oop.xml",
  "rulesets/java/ali-orm.xml",
  "rulesets/java/ali-other.xml",
  "rulesets/java/ali-set.xml",
];

// Priority 到 BlockLevel 的映射
const PRIORITY_TO_BLOCK_LEVEL = {
  1: "Critical",
  2: "Major",
  3: "Major",
  4: "Minor",
  5: "Info",
};

// ---------------------------------------------------------------------------
// 参数解析
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let repo = null;
  let source = null;
  let target = "origin/master";
  let priority = 1;
  let verbose = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source" && i + 1 < argv.length) {
      source = argv[++i];
    } else if (arg === "--target" && i + 1 < argv.length) {
      target = argv[++i];
    } else if (arg === "--priority" && i + 1 < argv.length) {
      priority = parseInt(argv[++i], 10);
      if (isNaN(priority) || priority < 1 || priority > 5) {
        fatal("--priority 必须为 1-5 之间的整数");
      }
    } else if (arg === "--verbose" || arg === "-v") {
      verbose = true;
    } else if (!arg.startsWith("--") && !repo) {
      repo = arg;
    }
  }

  if (!repo) fatal("错误: 缺少必需参数 <repo>");
  if (!source) fatal("错误: 缺少必需参数 --source");

  return { repo, source, target, priority, verbose };
}

// ---------------------------------------------------------------------------
// 执行子进程的辅助函数
// ---------------------------------------------------------------------------

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    maxBuffer: 50 * 1024 * 1024,
    ...options,
  });
  return result;
}

// ---------------------------------------------------------------------------
// 环境前置检查
// ---------------------------------------------------------------------------

function validateJavaAvailable() {
  const result = spawnSync("java", ["-version"], { stdio: "pipe" });
  if (result.error) {
    fatal("java 命令未找到，请确认已安装 JDK/JRE 并加入 PATH");
  }
  if (result.status !== 0) {
    fatal("java -version 返回非零退出码，请检查 Java 安装");
  }
}

// ---------------------------------------------------------------------------
// Git 仓库验证
// ---------------------------------------------------------------------------

function validateGitRepo(repoPath) {
  const absPath = isAbsolute(repoPath) ? repoPath : resolve(repoPath);
  try {
    const stat = statSync(absPath);
    if (!stat.isDirectory()) fatal(`路径不是目录: ${absPath}`);
  } catch {
    fatal(`路径不存在: ${absPath}`);
  }

  const result = runGit(["-C", absPath, "rev-parse", "--git-dir"], {
    stdio: "pipe",
  });
  if (result.status !== 0) {
    fatal(`不是有效的 Git 仓库: ${absPath}`);
  }
  return absPath;
}

function validateBranchExists(repoPath, branch) {
  const result = runGit(
    ["-C", repoPath, "rev-parse", "--verify", branch],
    { stdio: "pipe" }
  );
  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString().trim() : "";
    fatal(`分支不存在: ${branch}\n  ${stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Git diff 执行
// ---------------------------------------------------------------------------

function getDiffFileStatuses(repoPath, source, target) {
  const result = runGit(
    ["-C", repoPath, "diff", "--name-status", `${target}...${source}`],
    { stdio: "pipe" }
  );

  const stderr = result.stderr ? result.stderr.toString().trim() : "";
  if (result.status !== 0) fatal(`git diff 执行失败:\n  ${stderr}`);
  if (stderr) {
    for (const line of stderr.split("\n").slice(0, 5)) {
      warn(`git diff stderr: ${line}`);
    }
  }

  const stdout = result.stdout ? result.stdout.toString("utf-8") : "";
  const results = [];
  for (const line of stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length === 3) {
      // R(ename) / C(opy): status\told_path\tnew_path → 取新路径
      results.push([parts[0].trim(), parts[2].trim()]);
    } else if (parts.length === 2) {
      results.push([parts[0].trim(), parts[1].trim()]);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 变更行范围提取
// ---------------------------------------------------------------------------

function getChangedLineRanges(repoPath, source, target) {
  const result = runGit(
    ["-C", repoPath, "diff", "-U0", `${target}...${source}`],
    { stdio: "pipe" }
  );

  if (result.status !== 0) {
    const stderr = result.stderr ? result.stderr.toString().trim() : "";
    fatal(`git diff -U0 执行失败:\n  ${stderr}`);
  }

  const stdout = result.stdout ? result.stdout.toString("utf-8") : "";
  const changedRanges = {};
  let currentFile = null;

  for (const line of stdout.split("\n")) {
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
    } else if (line.startsWith("@@") && currentFile) {
      const match = line.match(/\+(\d+)(?:,(\d+))?/);
      if (match) {
        const start = parseInt(match[1], 10);
        const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        if (count > 0) {
          if (!changedRanges[currentFile]) changedRanges[currentFile] = [];
          changedRanges[currentFile].push([start, start + count - 1]);
        }
      }
    }
  }

  return changedRanges;
}

// ---------------------------------------------------------------------------
// 文件过滤与路径解析
// ---------------------------------------------------------------------------

function filterChangedFiles(fileStatuses) {
  return fileStatuses
    .filter(([status]) => !status.startsWith("D"))
    .map(([, path]) => path);
}

function isTestFile(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.includes("/src/test/") || normalized.startsWith("src/test/");
}

function getCurrentBranch(repoPath) {
  const result = runGit(
    ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"],
    { stdio: "pipe" }
  );
  if (result.status !== 0) return "";
  const branch = result.stdout.toString("utf-8").trim();
  return branch === "HEAD" ? "" : branch;
}

function resolveWorkingTreePaths(repoPath, relativePaths) {
  const absolutePaths = [];
  for (const relPath of relativePaths) {
    const absPath = normalize(join(repoPath, relPath));
    try {
      const stat = statSync(absPath);
      if (stat.isFile()) {
        absolutePaths.push(absPath);
      } else {
        warn(`不是文件: ${relPath}`);
      }
    } catch {
      warn(`文件在工作区中不存在: ${relPath}`);
    }
  }
  return absolutePaths;
}

function extractFilesFromBranch(repoPath, branch, relativePaths, destDir) {
  const extracted = [];
  for (const relPath of relativePaths) {
    const destPath = join(destDir, relPath);
    mkdirSync(dirname(destPath), { recursive: true });

    const result = runGit(
      ["-C", repoPath, "show", `${branch}:${relPath}`],
      { stdio: "pipe" }
    );

    if (result.status !== 0) {
      warn(`无法从分支 ${branch} 提取文件: ${relPath}`);
      continue;
    }

    writeFileSync(destPath, result.stdout);
    extracted.push(destPath);
  }
  return extracted;
}

// ---------------------------------------------------------------------------
// classpath
// ---------------------------------------------------------------------------

function buildClasspath() {
  if (!existsSync(LIB_DIR)) {
    fatal(`lib 目录不存在: ${LIB_DIR}`);
  }
  const jars = readdirSync(LIB_DIR)
    .filter((f) => f.endsWith(".jar"))
    .map((f) => join(LIB_DIR, f));

  if (jars.length === 0) {
    fatal(`lib 目录下未找到 jar 文件: ${LIB_DIR}`);
  }
  return jars.join(sep === "\\" ? ";" : ":");
}

// ---------------------------------------------------------------------------
// PMD 执行
// ---------------------------------------------------------------------------

function runP3cCheck(sourcePaths, classpath) {
  const args = [
    "-Dfile.encoding=UTF-8",
    "-cp",
    classpath,
    "net.sourceforge.pmd.PMD",
    "-d",
    sourcePaths.join(","),
    "-R",
    P3C_RULESETS.join(","),
    "-f",
    "json",
    "--encoding",
    "UTF-8",
  ];

  const result = spawnSync("java", args, {
    stdio: "pipe",
    maxBuffer: 50 * 1024 * 1024,
  });

  const stdout = result.stdout ? result.stdout.toString("utf-8") : "";
  const stderr = result.stderr ? result.stderr.toString("utf-8") : "";

  if (stderr) {
    for (const line of stderr.trim().split("\n").slice(0, 5)) {
      warn(`PMD stderr: ${line}`);
    }
  }

  // PMD 退出码约定: 0=无违规, 4=有违规, 其他=执行错误
  if (result.status !== 0 && result.status !== 4) {
    fatal(
      `PMD 执行失败 (exit code ${result.status}):\n  ${stderr.slice(0, 500)}`
    );
  }

  return stdout;
}

// ---------------------------------------------------------------------------
// 优先级过滤
// ---------------------------------------------------------------------------

function filterByPriority(data, maxPriority = 2) {
  const filteredFiles = [];
  for (const fileEntry of data.files || []) {
    const violations = (fileEntry.violations || []).filter(
      (v) => (v.priority ?? 5) <= maxPriority
    );
    if (violations.length > 0) {
      filteredFiles.push({ filename: fileEntry.filename || "", violations });
    }
  }
  return { files: filteredFiles };
}

// ---------------------------------------------------------------------------
// 格式转换
// ---------------------------------------------------------------------------

function transformToOutputFormat(data, repoPath) {
  const results = [];
  for (const fileEntry of data.files || []) {
    const filename = fileEntry.filename || "";
    let relPath;
    try {
      relPath = relative(repoPath, filename);
    } catch {
      relPath = filename;
    }

    for (const v of fileEntry.violations || []) {
      const priority = v.priority ?? 5;
      results.push({
        fileName: relPath,
        beginline: v.beginline ?? 0,
        begincolumn: v.begincolumn ?? 0,
        endline: v.endline ?? 0,
        endcolumn: v.endcolumn ?? 0,
        suggestion: v.description ?? "",
        ruleId: v.rule ?? "",
        blockLevel: PRIORITY_TO_BLOCK_LEVEL[priority] || "Info",
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 变更行过滤
// ---------------------------------------------------------------------------

function filterByChangedLines(results, changedRanges) {
  const filtered = [];
  for (const item of results) {
    const fileName = item.fileName.replace(/\\/g, "/");
    const ranges = changedRanges[fileName];
    if (!ranges) continue;

    const begin = item.beginline || 0;
    for (const [rStart, rEnd] of ranges) {
      if (rStart <= begin && begin <= rEnd) {
        filtered.push(item);
        break;
      }
    }
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function diffScan(repoPath, source, target, maxPriority = 2) {
  // 1. 环境与仓库验证
  validateJavaAvailable();
  const repoAbsPath = validateGitRepo(repoPath);
  validateBranchExists(repoAbsPath, source);
  validateBranchExists(repoAbsPath, target);

  // 2. 获取变更文件与变更行范围
  const fileStatuses = getDiffFileStatuses(repoAbsPath, source, target);
  const changedRanges = getChangedLineRanges(repoAbsPath, source, target);
  let changedFiles = filterChangedFiles(fileStatuses);
  changedFiles = changedFiles.filter(
    (f) => f.endsWith(".java") && !isTestFile(f)
  );

  if (changedFiles.length === 0) return [];

  // 3. 获取文件并扫描
  const classpath = buildClasspath();
  const currentBranch = getCurrentBranch(repoAbsPath);
  const useWorktree = currentBranch === source;

  let jsonContent;
  let basePath;

  if (useWorktree) {
    // source 就是当前分支，直接读工作区文件
    const absolutePaths = resolveWorkingTreePaths(repoAbsPath, changedFiles);
    if (absolutePaths.length === 0) return [];
    log(`共 ${absolutePaths.length} 个文件待扫描（工作区）`);
    jsonContent = runP3cCheck(absolutePaths, classpath);
    basePath = repoAbsPath;
  } else {
    // source 非当前分支，提取到临时目录
    const tmpDir = mkdtempSync(join(tmpdir(), "p3c_scan_"));
    try {
      const absolutePaths = extractFilesFromBranch(
        repoAbsPath,
        source,
        changedFiles,
        tmpDir
      );
      if (absolutePaths.length === 0) return [];
      log(`共 ${absolutePaths.length} 个文件待扫描（临时目录）`);
      jsonContent = runP3cCheck(absolutePaths, classpath);
      basePath = tmpDir;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  // 4. 解析并过滤报告
  let reportData;
  try {
    reportData = jsonContent.trim() ? JSON.parse(jsonContent) : { files: [] };
  } catch {
    warn("PMD 输出无法解析为 JSON");
    reportData = { files: [] };
  }

  const filteredData = filterByPriority(reportData, maxPriority);

  // 5. 转换输出格式并过滤到变更行范围
  const results = transformToOutputFormat(filteredData, basePath);
  return filterByChangedLines(results, changedRanges);
}

// ---------------------------------------------------------------------------
// CLI 入口
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));
VERBOSE = args.verbose;

const results = diffScan(args.repo, args.source, args.target, args.priority);

console.log(JSON.stringify(results, null, 2));
log(`总违规数：${results.length}`);
