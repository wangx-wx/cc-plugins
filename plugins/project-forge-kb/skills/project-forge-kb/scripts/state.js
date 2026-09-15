#!/usr/bin/env node

// src/state.js
import { execFile } from "node:child_process";
import { mkdir, readFile as readFile2, rename, writeFile } from "node:fs/promises";
import path2 from "node:path";
import { promisify } from "node:util";

// src/args.js
function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`\u672A\u77E5\u53C2\u6570: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      values[key] = true;
    } else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}
function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}
`);
}
function printHelp(argv, help) {
  if (!argv.includes("--help") && !argv.includes("-h")) return false;
  process.stdout.write(`${help.trim()}
`);
  return true;
}

// src/artifacts.js
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

// src/frontmatter.js
function parseFrontmatter(markdown) {
  const match = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, content: String(markdown) };
  return { data: parseSimpleYaml(match[1]), content: match[2] };
}
function parseSimpleYaml(yaml) {
  const data = {};
  let listKey = null;
  for (const rawLine of yaml.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const listItem = rawLine.match(/^\s*-\s+(.*)$/);
    if (listItem && listKey) {
      data[listKey].push(unquote(listItem[1].trim()));
      continue;
    }
    const pair = rawLine.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    const value = rawValue.trim();
    listKey = null;
    if (value === "") {
      data[key] = [];
      listKey = key;
    } else if (value === "null" || value === "~") {
      data[key] = null;
    } else if (value === "true" || value === "false") {
      data[key] = value === "true";
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      data[key] = Number(value);
    } else if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner ? inner.split(",").map((item) => unquote(item.trim())) : [];
    } else {
      data[key] = unquote(value);
    }
  }
  return data;
}
function unquote(value) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

// src/artifacts.js
function sha256Value(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}
async function hashFile(file) {
  return sha256Value(await readFile(file));
}
async function listFiles(root, predicate = () => true) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(entryPath, predicate));
    else if (entry.isFile() && predicate(entryPath)) files.push(entryPath);
  }
  return files;
}
async function readMarkdownFrontmatter(file) {
  const markdown = await readFile(file, "utf8");
  return { file, markdown, ...parseFrontmatter(markdown) };
}
function relativePosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

// src/state.js
var execFileAsync = promisify(execFile);
var HELP = `Usage: state.js [--repo-root <path>] [--kb-root <path>]

Write docs/kb/.meta/source-state.json for the current repository state.
Run from the target repository root unless --repo-root is provided.`;
async function git(repoRoot, args) {
  return (await execFileAsync("git", args, { cwd: repoRoot })).stdout.trim();
}
async function dirtyFiles(repoRoot) {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: repoRoot });
  const records = stdout.split("\0").filter(Boolean);
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    files.push(record.slice(3));
    if ([record[0], record[1]].some((status) => ["R", "C"].includes(status))) files.push(records[++index]);
  }
  return files;
}
async function ensureCleanForIncremental(repoRoot, baselinePath, kbRoot) {
  try {
    await readFile2(baselinePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const changedFiles = await dirtyFiles(repoRoot);
  if (changedFiles.length === 0) return;
  let run = null;
  try {
    run = JSON.parse(await readFile2(path2.join(kbRoot, ".meta", "workflow-run.json"), "utf8"));
  } catch {
  }
  const kbRelative = path2.relative(repoRoot, kbRoot).split(path2.sep).join("/");
  if (run?.status === "active" && run.mode === "incremental" && changedFiles.every((file) => file === kbRelative || file.startsWith(`${kbRelative}/`))) return;
  throw new Error("\u589E\u91CF\u66F4\u65B0\u8981\u6C42\u4ECE\u5E72\u51C0\u5DE5\u4F5C\u533A\u5F00\u59CB\uFF0C\u8FD0\u884C\u671F\u95F4\u4E5F\u4E0D\u80FD\u4FEE\u6539\u77E5\u8BC6\u5E93\u76EE\u5F55\u4EE5\u5916\u7684\u6587\u4EF6");
}
function packageMatches(file, packageName) {
  const packagePath = packageName.replaceAll(".", "/");
  return file.startsWith(`${packagePath}/`) || file.includes(`/${packagePath}/`);
}
function filesForModule(files, module) {
  const included = files.filter((file) => (module.include_files || []).includes(file) || (module.include_packages || []).some((packageName) => packageMatches(file, packageName)));
  return included.filter((file) => !(module.exclude_files || []).includes(file) && !(module.exclude_packages || []).some((packageName) => packageMatches(file, packageName)));
}
async function main() {
  const argv = process.argv.slice(2);
  if (printHelp(argv, HELP)) return;
  const args = parseArgs(argv);
  const repoRoot = path2.resolve(args.repoRoot || process.cwd());
  const kbRoot = path2.resolve(repoRoot, args.kbRoot || "docs/kb");
  const scopePath = path2.join(kbRoot, "module-scope.yaml");
  const resolvedPath = path2.join(kbRoot, ".meta", "scope-resolved.json");
  const output = path2.join(kbRoot, ".meta", "source-state.json");
  await ensureCleanForIncremental(repoRoot, output, kbRoot);
  const resolved = JSON.parse(await readFile2(resolvedPath, "utf8"));
  if (!Array.isArray(resolved.modules)) throw new Error("scope-resolved.json \u7F3A\u5C11 modules");
  const moduleMetaRoot = path2.join(kbRoot, ".meta", "modules");
  const moduleMetaFiles = await listFiles(moduleMetaRoot, (file) => file.endsWith(".json"));
  const moduleMeta = await Promise.all(moduleMetaFiles.map(async (file) => ({
    module_id: path2.basename(file, ".json"),
    path: relativePosix(repoRoot, file),
    hash: await hashFile(file)
  })));
  const adrFiles = await listFiles(path2.join(kbRoot, "L1"), (file) => path2.basename(path2.dirname(file)) === "adr" && file.endsWith(".md"));
  const adrs = await Promise.all(adrFiles.map(async (file) => {
    const item = await readMarkdownFrontmatter(file);
    return {
      doc_id: item.data.doc_id,
      module: item.data.module,
      path: relativePosix(repoRoot, file),
      hash: await hashFile(file)
    };
  }));
  const summaryFiles = await listFiles(path2.join(kbRoot, "archive"), (file) => path2.basename(file) === "summary.md");
  const archiveItems = await Promise.all(summaryFiles.map(readMarkdownFrontmatter));
  const archives = archiveItems.map((item) => ({
    archive_id: path2.basename(path2.dirname(item.file)),
    source_type: item.data.source_type,
    source_ref: item.data.source_ref,
    doc_id: item.data.doc_id ?? null,
    source_commit: item.data.source_commit ?? null,
    source_updated_at: item.data.source_updated_at ?? null,
    source_hash: item.data.source_hash,
    archived_at: item.data.archived_at,
    status: item.data.status
  }));
  const tracked = (await git(repoRoot, ["ls-files"])).split(/\r?\n/).filter(Boolean);
  const codeFiles = [];
  for (const module of resolved.modules) {
    for (const file of filesForModule(tracked, module).sort()) {
      codeFiles.push({
        module_id: module.id,
        path: file,
        hash: await hashFile(path2.join(repoRoot, file))
      });
    }
  }
  const state = {
    schema_version: 1,
    scanned_at: (/* @__PURE__ */ new Date()).toISOString(),
    source_commit: await git(repoRoot, ["rev-parse", "HEAD"]),
    inputs: {
      module_scope: { path: relativePosix(repoRoot, scopePath), hash: await hashFile(scopePath) },
      scope_resolved: { path: relativePosix(repoRoot, resolvedPath), hash: await hashFile(resolvedPath) }
    },
    module_meta: moduleMeta,
    adrs,
    archives,
    code_files: codeFiles
  };
  await mkdir(path2.dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}
`, "utf8");
  await rename(temporary, output);
  printJson({
    action: "baseline_written",
    path: relativePosix(repoRoot, output),
    source_commit: state.source_commit,
    module_meta_count: moduleMeta.length,
    adr_count: adrs.length,
    archive_count: archives.length,
    code_file_count: codeFiles.length
  });
}
main().catch((error) => {
  process.stderr.write(`[state] ${error.message}
`);
  process.exitCode = 1;
});
