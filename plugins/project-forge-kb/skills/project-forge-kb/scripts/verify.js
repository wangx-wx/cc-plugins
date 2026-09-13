#!/usr/bin/env node

// src/verify.js
import { readFile as readFile2 } from "node:fs/promises";
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
var L1_STATUSES = /* @__PURE__ */ new Set(["candidate", "draft", "confirmed", "review_required", "stale", "retired"]);
var TEMPLATE_PLACEHOLDER_TOKENS = /* @__PURE__ */ new Set([
  "domain_id",
  "capability_id",
  "symbol",
  "number",
  "name",
  "slug",
  "archive_id",
  "domain",
  "repo/yuque",
  "YYYY-MM-DD"
]);
function findContentPlaceholders(markdown) {
  const found = /* @__PURE__ */ new Set();
  for (const match of String(markdown).matchAll(/<(?!\!)[^<>\n]{1,120}>/g)) {
    const inner = match[0].slice(1, -1);
    if (inner !== inner.trim()) continue;
    if (/[\u4e00-\u9fa5]/.test(inner) || TEMPLATE_PLACEHOLDER_TOKENS.has(inner)) found.add(match[0]);
  }
  return [...found];
}
async function pathExists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
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

// src/verify.js
var L0_REQUIRED = ["id", "layer", "title", "description"];
var L1_REQUIRED = ["domain_id", "layer", "title", "description", "status"];
var ADR_REQUIRED = ["doc_id", "layer", "domain", "title", "date"];
var ARCHIVE_REQUIRED = ["type", "title", "keyTopics", "source_type", "source_ref", "source_hash", "archived_at", "status"];
var HELP = `Usage: verify.js [--repo-root <path>] [--kb-root <path>]

Validate L0, L1, ADR, archive, metadata, and relative links.
Run from the target repository root unless --repo-root is provided.`;
function finding(code, file, message) {
  return { code, path: file, message };
}
function missing(data, fields) {
  return fields.filter((field) => data[field] === void 0 || data[field] === null || data[field] === "" || Array.isArray(data[field]) && data[field].length === 0);
}
function validDomainMeta(value) {
  return value && typeof value === "object" && !Array.isArray(value) && value.schema_version === 1 && typeof value.domain_id === "string" && value.domain_id.length > 0 && typeof value.source_commit === "string" && value.source_commit.length > 0 && value.scope && typeof value.scope === "object" && !Array.isArray(value.scope) && value.observed && typeof value.observed === "object" && !Array.isArray(value.observed) && Array.isArray(value.documents) && Array.isArray(value.candidates);
}
function markdownDestinations(markdown) {
  const destinations = [];
  const expression = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(expression)) {
    let value = match[1].trim();
    if (value.startsWith("<")) value = value.slice(1, value.indexOf(">"));
    else value = value.split(/\s+/)[0];
    if (!value || value.startsWith("#") || value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue;
    value = value.split("#")[0].split("?")[0];
    try {
      value = decodeURIComponent(value);
    } catch {
    }
    if (value) destinations.push(value);
  }
  return destinations;
}
async function main() {
  const argv = process.argv.slice(2);
  if (printHelp(argv, HELP)) return;
  const args = parseArgs(argv);
  const repoRoot = path2.resolve(args.repoRoot || process.cwd());
  const kbRoot = path2.resolve(repoRoot, args.kbRoot || "docs/kb");
  const errors = [];
  const warnings = [];
  const l0Path = path2.join(kbRoot, "L0.md");
  let l0 = "";
  try {
    l0 = await readFile2(l0Path, "utf8");
  } catch {
  }
  if ((l0.match(/<!-- kb-index:start -->/g) || []).length !== 1 || (l0.match(/<!-- kb-index:end -->/g) || []).length !== 1 || l0.indexOf("<!-- kb-index:start -->") > l0.indexOf("<!-- kb-index:end -->")) {
    errors.push(finding("L0_INDEX_MARKERS_INVALID", relativePosix(repoRoot, l0Path), "L0 \u5FC5\u987B\u5305\u542B\u4E00\u7EC4\u987A\u5E8F\u6B63\u786E\u7684 kb-index \u6807\u8BB0"));
  }
  if (l0) {
    const l0Item = await readMarkdownFrontmatter(l0Path);
    const absent = missing(l0Item.data, L0_REQUIRED);
    if (absent.length) errors.push(finding("L0_FRONTMATTER_REQUIRED", relativePosix(repoRoot, l0Path), `\u7F3A\u5C11\u5B57\u6BB5: ${absent.join(", ")}`));
    if (l0Item.data.layer !== void 0 && l0Item.data.layer !== "L0") {
      errors.push(finding("L0_LAYER_INVALID", relativePosix(repoRoot, l0Path), "layer \u5FC5\u987B\u4E3A L0"));
    }
    const l0Placeholders = findContentPlaceholders(l0Item.markdown);
    if (l0Placeholders.length > 0) {
      errors.push(finding("L0_PLACEHOLDER_REMAINS", relativePosix(repoRoot, l0Path), `\u4ECD\u6709\u672A\u66FF\u6362\u7684\u6A21\u677F\u5360\u4F4D\u7B26: ${l0Placeholders.join("\u3001")}`));
    }
  }
  const domainsRoot = path2.join(kbRoot, "L1");
  const l1Files = await listFiles(domainsRoot, (file) => path2.basename(file) === "README.md" && path2.relative(domainsRoot, file).split(path2.sep).length === 2);
  const l1Items = await Promise.all(l1Files.map(readMarkdownFrontmatter));
  const ids = /* @__PURE__ */ new Map();
  for (const item of l1Items) {
    const relative = relativePosix(repoRoot, item.file);
    const fileId = path2.basename(path2.dirname(item.file));
    const absent = missing(item.data, L1_REQUIRED);
    if (absent.length) errors.push(finding("L1_FRONTMATTER_REQUIRED", relative, `\u7F3A\u5C11\u5B57\u6BB5: ${absent.join(", ")}`));
    if (item.data.layer !== void 0 && item.data.layer !== "L1") errors.push(finding("L1_LAYER_INVALID", relative, "layer \u5FC5\u987B\u4E3A L1"));
    if (item.data.domain_id && item.data.domain_id !== fileId) errors.push(finding("L1_DOMAIN_ID_MISMATCH", relative, `\u9886\u57DF\u76EE\u5F55 ${fileId} \u4E0E Markdown domain_id ${item.data.domain_id} \u4E0D\u4E00\u81F4`));
    if (item.data.status !== void 0 && !L1_STATUSES.has(String(item.data.status).toLowerCase())) {
      errors.push(finding("L1_STATUS_INVALID", relative, `status \u5FC5\u987B\u662F ${[...L1_STATUSES].join("\u3001")}`));
    }
    const placeholders = findContentPlaceholders(item.markdown);
    if (placeholders.length > 0) {
      errors.push(finding("L1_PLACEHOLDER_REMAINS", relative, `\u4ECD\u6709\u672A\u66FF\u6362\u7684\u6A21\u677F\u5360\u4F4D\u7B26: ${placeholders.join("\u3001")}`));
    }
    if (item.data.domain_id) {
      const previous = ids.get(item.data.domain_id);
      if (previous) errors.push(finding("L1_DOMAIN_ID_DUPLICATE", relative, `domain_id ${item.data.domain_id} \u5DF2\u5728 ${previous} \u4F7F\u7528`));
      else ids.set(item.data.domain_id, relative);
    }
  }
  const adrFiles = await listFiles(domainsRoot, (file) => path2.basename(path2.dirname(file)) === "adr" && file.endsWith(".md"));
  const adrItems = await Promise.all(adrFiles.map(readMarkdownFrontmatter));
  const adrIds = /* @__PURE__ */ new Map();
  for (const item of adrItems) {
    const relative = relativePosix(repoRoot, item.file);
    const relativeAdr = path2.relative(domainsRoot, item.file);
    const segments = relativeAdr.split(path2.sep);
    const directoryDomain = segments.length === 3 && segments[1] === "adr" ? segments[0] : "";
    const filename = path2.basename(item.file, ".md");
    const absent = missing(item.data, ADR_REQUIRED);
    if (absent.length) errors.push(finding("ADR_FRONTMATTER_REQUIRED", relative, `\u7F3A\u5C11\u5B57\u6BB5: ${absent.join(", ")}`));
    if (item.data.layer !== void 0 && item.data.layer !== "ADR") errors.push(finding("ADR_LAYER_INVALID", relative, "layer \u5FC5\u987B\u4E3A ADR"));
    if (Object.hasOwn(item.data, "status")) errors.push(finding("ADR_STATUS_NOT_ALLOWED", relative, "ADR \u4E0D\u5141\u8BB8\u8BBE\u7F6E status"));
    const filenameMatch = filename.match(/^(\d{4})-.+/);
    if (!filenameMatch) errors.push(finding("ADR_FILENAME_INVALID", relative, "ADR \u6587\u4EF6\u540D\u5FC5\u987B\u4F7F\u7528\u56DB\u4F4D\u7F16\u53F7\u548C\u63CF\u8FF0\uFF0C\u4F8B\u5982 0001-use-snapshot.md"));
    if (!directoryDomain || item.data.domain !== directoryDomain) {
      errors.push(finding("ADR_DOMAIN_MISMATCH", relative, `ADR \u5FC5\u987B\u4F4D\u4E8E L1/<domain>/adr/ \u4E14 domain \u4E0E\u76EE\u5F55\u4E00\u81F4`));
    }
    if (filenameMatch && directoryDomain && item.data.doc_id && item.data.doc_id !== `ADR-${directoryDomain}-${filenameMatch[1]}`) {
      errors.push(finding("ADR_ID_MISMATCH", relative, `ADR doc_id \u5FC5\u987B\u4E3A ADR-${directoryDomain}-${filenameMatch[1]}`));
    }
    if (item.data.doc_id) {
      const previous = adrIds.get(item.data.doc_id);
      if (previous) errors.push(finding("ADR_ID_DUPLICATE", relative, `doc_id ${item.data.doc_id} \u5DF2\u5728 ${previous} \u4F7F\u7528`));
      else adrIds.set(item.data.doc_id, relative);
    }
  }
  const jsonFiles = await listFiles(path2.join(kbRoot, ".meta"), (file) => file.endsWith(".json"));
  const jsonValues = /* @__PURE__ */ new Map();
  for (const file of jsonFiles) {
    const relative = relativePosix(repoRoot, file);
    try {
      jsonValues.set(file, JSON.parse(await readFile2(file, "utf8")));
    } catch (error) {
      errors.push(finding("META_JSON_INVALID", relative, error.message));
    }
  }
  const catalogPath = path2.join(kbRoot, ".meta", "knowledge-base.json");
  const catalog = jsonValues.get(catalogPath);
  if (catalog !== void 0) {
    const catalogRelative = relativePosix(repoRoot, catalogPath);
    if (!catalog || typeof catalog !== "object" || Array.isArray(catalog) || catalog.schema_version !== 1 || !Array.isArray(catalog.nodes) || !Array.isArray(catalog.edges)) {
      errors.push(finding("KNOWLEDGE_BASE_SCHEMA_INVALID", catalogRelative, "knowledge-base.json \u5FC5\u987B\u5305\u542B schema_version=1\u3001nodes \u548C edges"));
    } else {
      const nodeIds = /* @__PURE__ */ new Set();
      for (const node of catalog.nodes) {
        const nodeId = node?.doc_id || node?.domain_id || node?.id;
        if (!node || typeof node !== "object" || !node.kind || !nodeId) {
          errors.push(finding("KNOWLEDGE_BASE_NODE_INVALID", catalogRelative, "catalog \u8282\u70B9\u5FC5\u987B\u5305\u542B kind \u548C\u552F\u4E00\u6807\u8BC6\u5B57\u6BB5"));
          continue;
        }
        if (nodeIds.has(nodeId)) errors.push(finding("KNOWLEDGE_BASE_NODE_DUPLICATE", catalogRelative, `catalog \u8282\u70B9\u6807\u8BC6\u91CD\u590D: ${nodeId}`));
        nodeIds.add(nodeId);
      }
      for (const edge of catalog.edges) {
        if (!edge || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
          errors.push(finding("KNOWLEDGE_BASE_EDGE_TARGET_MISSING", catalogRelative, "catalog \u8FB9\u7684 from \u548C to \u5FC5\u987B\u6307\u5411\u5DF2\u5B58\u5728\u8282\u70B9"));
        }
      }
    }
  }
  const metaRoot = path2.join(kbRoot, ".meta", "domains");
  const metaFiles = jsonFiles.filter((file) => path2.dirname(file) === metaRoot);
  for (const file of metaFiles) {
    const relative = relativePosix(repoRoot, file);
    const value = jsonValues.get(file);
    if (!value) continue;
    if (!validDomainMeta(value)) {
      errors.push(finding("DOMAIN_META_SCHEMA_INVALID", relative, "\u5FC5\u987B\u5305\u542B schema_version=1\u3001domain_id\u3001source_commit\u3001scope\u3001observed\u3001documents \u548C candidates"));
      continue;
    }
    const fileId = path2.basename(file, ".json");
    if (value.domain_id !== fileId) errors.push(finding("DOMAIN_ID_MISMATCH", relative, `\u6587\u4EF6\u540D ${fileId} \u4E0E domain_id ${value.domain_id} \u4E0D\u4E00\u81F4`));
    const markdown = l1Items.find((item) => path2.basename(path2.dirname(item.file)) === path2.basename(file, ".json"));
    if (markdown && markdown.data.domain_id !== value.domain_id) {
      errors.push(finding("DOMAIN_ID_MISMATCH", relative, `Markdown domain_id ${markdown.data.domain_id || "(\u7F3A\u5931)"} \u4E0E domain_id ${value.domain_id} \u4E0D\u4E00\u81F4`));
    }
    for (const document of value.documents) {
      if (!document || typeof document.path !== "string" || !document.path) {
        errors.push(finding("DOMAIN_ARCHIVE_REFERENCE_INVALID", relative, "documents \u4E2D\u7684\u5F52\u6863\u5FC5\u987B\u5305\u542B path"));
        continue;
      }
      const archiveDirectory = path2.resolve(repoRoot, document.path);
      const archiveRelative = path2.relative(path2.join(kbRoot, "archive"), archiveDirectory);
      const summaryPath = path2.join(archiveDirectory, "summary.md");
      if (!archiveRelative || archiveRelative.startsWith("..") || path2.isAbsolute(archiveRelative) || !await pathExists(summaryPath)) {
        errors.push(finding("DOMAIN_ARCHIVE_MISSING", relative, `\u9886\u57DF\u5F52\u6863\u4E0D\u5B58\u5728: ${document.path}`));
        continue;
      }
    }
  }
  const summaryFiles = await listFiles(path2.join(kbRoot, "archive"), (file) => path2.basename(file) === "summary.md");
  const summaryItems = await Promise.all(summaryFiles.map(readMarkdownFrontmatter));
  for (const item of summaryItems) {
    const relative = relativePosix(repoRoot, item.file);
    const absent = missing(item.data, ARCHIVE_REQUIRED);
    if (!item.data.doc_id && !item.data.docId) absent.push("doc_id");
    if (item.data.source_type === "repo" && !item.data.source_commit) absent.push("source_commit");
    if (item.data.source_type === "yuque" && !item.data.source_updated_at) absent.push("source_updated_at");
    if (absent.length) errors.push(finding("ARCHIVE_FRONTMATTER_REQUIRED", relative, `\u7F3A\u5C11\u5B57\u6BB5: ${[...new Set(absent)].join(", ")}`));
    const archiveDocId = item.data.doc_id || item.data.docId;
    const chunkFiles = await listFiles(path2.join(path2.dirname(item.file), "chunks"), (file) => file.endsWith(".md"));
    for (const chunkFile of chunkFiles) {
      const chunk = await readMarkdownFrontmatter(chunkFile);
      const index = Number.isInteger(chunk.data.index) ? chunk.data.index : Number.parseInt(path2.basename(chunkFile, ".md"), 10);
      const expected = `chunk-${String(index).padStart(2, "0")}-${archiveDocId}`;
      if (chunk.data.doc_id !== expected) {
        errors.push(finding("CHUNK_DOC_ID_INVALID", relativePosix(repoRoot, chunkFile), `chunk doc_id \u5FC5\u987B\u4E3A ${expected}`));
      }
    }
  }
  const scopePath = path2.join(kbRoot, ".meta", "scope-resolved.json");
  const scope = jsonValues.get(scopePath);
  if (scope && Array.isArray(scope.domains)) {
    const domainIds = new Set(scope.domains.map((domain) => domain.id));
    for (const domain of scope.domains) {
      const metaPath = path2.join(metaRoot, `${domain.id}.json`);
      if (!await pathExists(metaPath)) warnings.push(finding("DOMAIN_META_MISSING", relativePosix(repoRoot, metaPath), `\u9886\u57DF ${domain.id} \u7F3A\u5C11 domain meta`));
    }
    for (const item of adrItems) {
      if (item.data.domain && !domainIds.has(item.data.domain)) {
        errors.push(finding("ADR_DOMAIN_UNKNOWN", relativePosix(repoRoot, item.file), `ADR \u5F15\u7528\u4E86\u4E0D\u5B58\u5728\u7684\u9886\u57DF: ${item.data.domain}`));
      }
    }
  }
  const linkedMarkdown = [...l1Items, ...adrItems, ...await Promise.all((await listFiles(path2.join(kbRoot, "archive"), (file) => file.endsWith(".md"))).map(readMarkdownFrontmatter))];
  const statusCache = new Map(linkedMarkdown.map((item) => [path2.resolve(item.file), item.data.status]));
  for (const item of linkedMarkdown) {
    for (const destination of markdownDestinations(item.markdown)) {
      const target = path2.resolve(path2.dirname(item.file), destination);
      const relative = relativePosix(repoRoot, item.file);
      if (!await pathExists(target)) {
        warnings.push(finding("RELATIVE_LINK_BROKEN", relative, `\u76F8\u5BF9\u94FE\u63A5\u4E0D\u5B58\u5728: ${destination}`));
        continue;
      }
      const targetStatus = statusCache.get(target);
      if (targetStatus && INACTIVE_STATUSES.has(String(targetStatus).toLowerCase()) && !INACTIVE_STATUSES.has(String(item.data.status || "").toLowerCase())) {
        warnings.push(finding("FORMAL_LINKS_INACTIVE", relative, `\u6B63\u5F0F\u77E5\u8BC6\u5F15\u7528\u4E86 ${targetStatus} \u5BF9\u8C61: ${destination}`));
      }
    }
  }
  printJson({
    action: errors.length ? "invalid" : "verified",
    errors,
    warnings,
    summary: { error_count: errors.length, warning_count: warnings.length }
  });
  if (errors.length) process.exitCode = 1;
}
main().catch((error) => {
  printJson({ action: "invalid", errors: [finding("VERIFY_FAILED", "", error.message)], warnings: [], summary: { error_count: 1, warning_count: 0 } });
  process.exitCode = 1;
});
