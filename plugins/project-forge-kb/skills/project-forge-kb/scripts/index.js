#!/usr/bin/env node

// src/index.js
import { readFile as readFile2, rename, writeFile } from "node:fs/promises";
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
function printHelp(argv, help) {
  if (!argv.includes("--help") && !argv.includes("-h")) return false;
  process.stdout.write(`${help.trim()}
`);
  return true;
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
var HELP = `Usage: index.js [--repo-root <path>] [--kb-root <path>]

Rebuild only the generated index section in docs/kb/L0.md.
Run from the target repository root unless --repo-root is provided.`;
function cell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replace(/\r?\n/g, " ");
}
function link(label, target) {
  return `[${cell(label)}](${target})`;
}
function table(headers, rows) {
  if (rows.length === 0) return "_\u65E0_";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}
function renderIndex(kbRoot, l1Items) {
  return [
    "## \u9886\u57DF\u77E5\u8BC6\u7D22\u5F15",
    "",
    table(["kind", "domain_id", "\u9886\u57DF", "\u8BF4\u660E", "\u72B6\u6001"], l1Items.filter((item) => isCurrentStatus(item.data.status)).sort((a, b) => String(a.data.domain_id).localeCompare(String(b.data.domain_id))).map((item) => [
      "l1",
      cell(item.data.domain_id),
      link(item.data.title || item.data.domain_id, path2.relative(kbRoot, item.file).split(path2.sep).join("/")),
      cell(item.data.description),
      cell(item.data.status)
    ]))
  ].join("\n");
}
function markerPosition(markdown, marker, label) {
  const first = markdown.indexOf(marker);
  if (first < 0) throw new Error(`L0.md \u7F3A\u5C11 ${label} \u6807\u8BB0`);
  if (markdown.indexOf(marker, first + marker.length) >= 0) throw new Error(`L0.md \u5305\u542B\u91CD\u590D\u7684 ${label} \u6807\u8BB0`);
  return first;
}
function destinationPaths(markdown) {
  return [...String(markdown).matchAll(/!?(?:\[[^\]]*\])\(([^)]+)\)/g)].map((match) => match[1].trim().split(/\s+/)[0].replace(/^<|>$/g, "").split("#")[0].split("?")[0]).filter((value) => value && !value.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(value));
}
function relativePath(repoRoot, file) {
  return path2.relative(repoRoot, file).split(path2.sep).join("/");
}
async function buildKnowledgeBase(repoRoot, kbRoot, l0, l1Items) {
  const nodes = [];
  const pathToId = /* @__PURE__ */ new Map();
  const addNode = (node, file) => {
    nodes.push({ ...node, path: relativePath(repoRoot, file) });
    pathToId.set(path2.resolve(file), node.doc_id || node.domain_id || node.id);
  };
  addNode({ id: l0.data.id, kind: "l0", title: l0.data.title, status: l0.data.status || null }, l0.file);
  for (const item of l1Items) addNode({ domain_id: item.data.domain_id, kind: "l1", title: item.data.title, status: item.data.status }, item.file);
  const adrFiles = await listFiles(path2.join(kbRoot, "L1"), (file) => path2.basename(path2.dirname(file)) === "adr" && file.endsWith(".md"));
  for (const file of adrFiles) {
    const item = await readMarkdownFrontmatter(file);
    addNode({ doc_id: item.data.doc_id, kind: "adr", title: item.data.title, domain_id: item.data.domain || null }, file);
  }
  const summaryFiles = await listFiles(path2.join(kbRoot, "archive"), (file) => path2.basename(file) === "summary.md");
  for (const file of summaryFiles) {
    const item = await readMarkdownFrontmatter(file);
    const archiveDocId = item.data.doc_id || item.data.docId;
    addNode({ doc_id: archiveDocId, kind: "archive", title: item.data.title, status: item.data.status, source_type: item.data.source_type, source_doc_id: item.data.source_doc_id || null }, file);
    const chunkFiles = await listFiles(path2.join(path2.dirname(file), "chunks"), (chunk) => chunk.endsWith(".md"));
    for (const chunk of chunkFiles) {
      const chunkItem = await readMarkdownFrontmatter(chunk);
      const index = Number.isInteger(chunkItem.data.index) ? chunkItem.data.index : Number.parseInt(path2.basename(chunk, ".md"), 10);
      addNode({ doc_id: chunkItem.data.doc_id || chunkItem.data.docId || `chunk-${String(index).padStart(2, "0")}-${archiveDocId}`, kind: "chunk", title: chunkItem.data.title, parent_doc_id: archiveDocId, index }, chunk);
    }
  }
  const edges = [];
  const edgeKeys = /* @__PURE__ */ new Set();
  const addEdge = (edge) => {
    const key = `${edge.from}\0${edge.to}\0${edge.type}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push(edge);
    }
  };
  for (const item of [...l1Items, l0]) {
    const from = pathToId.get(path2.resolve(item.file));
    for (const destination of destinationPaths(item.markdown)) {
      const target = path2.resolve(path2.dirname(item.file), destination);
      const to = pathToId.get(target) || pathToId.get(`${target}.md`);
      if (from && to) {
        const targetNode = nodes.find((node) => (node.doc_id || node.domain_id || node.id) === to);
        addEdge({ from, to, type: targetNode?.kind === "archive" ? "evidence" : "references" });
      }
    }
  }
  for (const node of nodes.filter((item) => item.kind === "chunk")) addEdge({ from: node.parent_doc_id, to: node.doc_id, type: "contains" });
  const domainMetaFiles = await listFiles(path2.join(kbRoot, ".meta", "domains"), (file) => file.endsWith(".json"));
  for (const file of domainMetaFiles) {
    let meta;
    try {
      meta = JSON.parse(await readFile2(file, "utf8"));
    } catch {
      continue;
    }
    const l1Id = meta.domain_id;
    for (const document of meta.documents || []) {
      const archiveId = document.archive_id || document.doc_id;
      if (l1Id && archiveId && pathToId.has(path2.resolve(path2.join(kbRoot, "archive", archiveId, "summary.md")))) {
        addEdge({ from: l1Id, to: archiveId, type: "evidence" });
      }
    }
  }
  for (const node of nodes.filter((item) => item.kind === "adr" && item.domain_id)) {
    addEdge({ from: node.domain_id, to: node.doc_id, type: "references" });
  }
  const catalog = { schema_version: 1, generated_at: (/* @__PURE__ */ new Date()).toISOString(), nodes, edges };
  const catalogPath = path2.join(kbRoot, ".meta", "knowledge-base.json");
  const temporary = `${catalogPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}
`, "utf8");
  await rename(temporary, catalogPath);
  return { catalogPath, nodeCount: nodes.length, edgeCount: edges.length };
}
async function main() {
  const argv = process.argv.slice(2);
  if (printHelp(argv, HELP)) return;
  const args = parseArgs(argv);
  const repoRoot = path2.resolve(args.repoRoot || process.cwd());
  const kbRoot = path2.resolve(repoRoot, args.kbRoot || "docs/kb");
  const l0Path = path2.join(kbRoot, "L0.md");
  let markdown;
  try {
    markdown = await readFile2(l0Path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("L0.md \u4E0D\u5B58\u5728\uFF1B\u5148\u4F7F\u7528 assets/L0.md \u521B\u5EFA\u5E76\u586B\u5199\u670D\u52A1\u8EAB\u4EFD");
    throw error;
  }
  const start = markerPosition(markdown, START, "\u5F00\u59CB");
  const end = markerPosition(markdown, END, "\u7ED3\u675F");
  if (end < start) throw new Error("L0.md \u7684 kb-index \u6807\u8BB0\u987A\u5E8F\u9519\u8BEF");
  const domainsRoot = path2.join(kbRoot, "L1");
  const l1Items = await Promise.all((await listFiles(domainsRoot, (file) => path2.basename(file) === "README.md" && path2.relative(domainsRoot, file).split(path2.sep).length === 2)).map(readMarkdownFrontmatter));
  const generated = renderIndex(kbRoot, l1Items);
  const updated = `${markdown.slice(0, start + START.length)}
${generated}
${markdown.slice(end)}`;
  const temporary = `${l0Path}.${process.pid}.tmp`;
  await writeFile(temporary, updated, "utf8");
  await rename(temporary, l0Path);
  const catalog = await buildKnowledgeBase(repoRoot, kbRoot, { file: l0Path, data: parseFrontmatter(updated).data, markdown: updated }, l1Items);
  printJson({
    action: "indexed",
    path: path2.relative(repoRoot, l0Path).split(path2.sep).join("/"),
    l1_count: l1Items.filter((item) => isCurrentStatus(item.data.status)).length,
    knowledge_base: relativePath(repoRoot, catalog.catalogPath),
    knowledge_base_node_count: catalog.nodeCount,
    knowledge_base_edge_count: catalog.edgeCount
  });
}
main().catch((error) => {
  process.stderr.write(`[index] ${error.message}
`);
  process.exitCode = 1;
});
