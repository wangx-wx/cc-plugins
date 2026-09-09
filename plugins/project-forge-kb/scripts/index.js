#!/usr/bin/env node

// src/index.js
import { readFile as readFile2, readdir as readdir2, rename, writeFile } from "node:fs/promises";
import path2 from "node:path";

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

// src/artifacts.js
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
var INACTIVE_STATUSES = /* @__PURE__ */ new Set(["candidate", "stale", "retired"]);
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
function isCurrentStatus(status) {
  return !INACTIVE_STATUSES.has(String(status || "").trim().toLowerCase());
}

// src/index.js
var START = "<!-- kb-index:start -->";
var END = "<!-- kb-index:end -->";
function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}
function link(label, target) {
  return `[${cell(label)}](${target})`;
}
async function markdownFiles(directory) {
  try {
    return (await readdir2(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => path2.join(directory, entry.name)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function archiveSummaries(directory) {
  try {
    const entries = await readdir2(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path2.join(directory, entry.name, "summary.md")).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
function table(headers, rows) {
  if (rows.length === 0) return "_\u65E0_";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}
function renderIndex(l1Items, archiveItems, adrItems) {
  const groups = /* @__PURE__ */ new Map();
  for (const item of archiveItems) {
    const key = `${item.data.source_type}\0${item.data.source_ref}`;
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }
  const currentArchives = [];
  const historicalArchives = [];
  for (const group of groups.values()) {
    group.sort((a, b) => String(b.data.archived_at || "").localeCompare(String(a.data.archived_at || "")));
    if (group[0] && isCurrentStatus(group[0].data.status)) currentArchives.push(group[0]);
    historicalArchives.push(...group.slice(1).filter((item) => isCurrentStatus(item.data.status)));
  }
  const archiveRow = (item) => [
    cell(item.data.source_type),
    link(item.data.title || item.data.docId, `archive/${path2.basename(path2.dirname(item.file))}/summary.md`),
    cell(item.data.source_ref),
    cell(item.data.archived_at)
  ];
  return [
    "## \u9886\u57DF\u77E5\u8BC6\u7D22\u5F15",
    "",
    table(["\u9886\u57DF", "\u8BF4\u660E", "\u8D1F\u8D23\u4EBA", "\u72B6\u6001"], l1Items.filter((item) => isCurrentStatus(item.data.status)).sort((a, b) => String(a.data.id).localeCompare(String(b.data.id))).map((item) => [
      link(item.data.title || item.data.id, `L1/${path2.basename(item.file)}`),
      cell(item.data.description),
      cell(item.data.owner),
      cell(item.data.status)
    ])),
    "",
    "## \u8BBE\u8BA1\u51B3\u7B56\u7D22\u5F15",
    "",
    table(["\u9886\u57DF", "\u51B3\u7B56", "\u65E5\u671F"], adrItems.sort((a, b) => String(a.data.id).localeCompare(String(b.data.id))).map((item) => [
      cell(item.data.domain),
      link(item.data.title || item.data.id, path2.relative(path2.join(path2.dirname(item.file), "..", ".."), item.file).split(path2.sep).join("/")),
      cell(item.data.date)
    ])),
    "",
    "## \u73B0\u884C\u5F52\u6863\u7D22\u5F15",
    "",
    table(["\u6765\u6E90", "\u6587\u6863", "\u6765\u6E90\u5730\u5740", "\u5F52\u6863\u65F6\u95F4"], currentArchives.sort((a, b) => String(a.data.source_ref).localeCompare(String(b.data.source_ref))).map(archiveRow)),
    "",
    "## \u5386\u53F2\u5F52\u6863\u7D22\u5F15",
    "",
    table(["\u6765\u6E90", "\u6587\u6863", "\u6765\u6E90\u5730\u5740", "\u5F52\u6863\u65F6\u95F4"], historicalArchives.sort((a, b) => String(b.data.archived_at).localeCompare(String(a.data.archived_at))).map(archiveRow))
  ].join("\n");
}
function markerPosition(markdown, marker, label) {
  const first = markdown.indexOf(marker);
  if (first < 0) throw new Error(`L0-MAP.md \u7F3A\u5C11 ${label} \u6807\u8BB0`);
  if (markdown.indexOf(marker, first + marker.length) >= 0) throw new Error(`L0-MAP.md \u5305\u542B\u91CD\u590D\u7684 ${label} \u6807\u8BB0`);
  return first;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path2.resolve(args.repoRoot || process.cwd());
  const kbRoot = path2.resolve(repoRoot, args.kbRoot || "docs/kb");
  const l0Path = path2.join(kbRoot, "L0-MAP.md");
  let markdown;
  try {
    markdown = await readFile2(l0Path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("L0-MAP.md \u4E0D\u5B58\u5728\uFF1B\u5148\u4F7F\u7528 assets/L0-MAP.md \u521B\u5EFA\u5E76\u586B\u5199\u670D\u52A1\u8EAB\u4EFD\u548C\u7CFB\u7EDF\u8FB9\u754C");
    throw error;
  }
  const start = markerPosition(markdown, START, "\u5F00\u59CB");
  const end = markerPosition(markdown, END, "\u7ED3\u675F");
  if (end < start) throw new Error("L0-MAP.md \u7684 kb-index \u6807\u8BB0\u987A\u5E8F\u9519\u8BEF");
  const l1Items = await Promise.all((await markdownFiles(path2.join(kbRoot, "L1"))).map(readMarkdownFrontmatter));
  const archiveItems = await Promise.all((await archiveSummaries(path2.join(kbRoot, "archive"))).map(readMarkdownFrontmatter));
  const adrItems = await Promise.all((await listFiles(path2.join(kbRoot, "adr"), (file) => file.endsWith(".md"))).map(readMarkdownFrontmatter));
  const generated = renderIndex(l1Items, archiveItems, adrItems);
  const updated = `${markdown.slice(0, start + START.length)}
${generated}
${markdown.slice(end)}`;
  const temporary = `${l0Path}.${process.pid}.tmp`;
  await writeFile(temporary, updated, "utf8");
  await rename(temporary, l0Path);
  printJson({
    action: "indexed",
    path: path2.relative(repoRoot, l0Path).split(path2.sep).join("/"),
    l1_count: l1Items.filter((item) => isCurrentStatus(item.data.status)).length,
    adr_count: adrItems.length,
    archive_count: archiveItems.length
  });
}
main().catch((error) => {
  process.stderr.write(`[index] ${error.message}
`);
  process.exitCode = 1;
});
