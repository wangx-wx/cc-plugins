import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { parseMapperXml, resolveIncludes, normalizeXmlSql } from "./lib/mybatis-xml.mjs";
import { loadProjectMapping } from "./lib/datasource.mjs";
import { extractTables } from "./lib/tables.mjs";
import {
  isMapperXml,
  listXmlFilesAtRevision,
  readSourceAtRevision,
  resolveDiffContext,
} from "./lib/git-diff.mjs";

export function parseArguments(argv) {
  const o = {};
  const map = { "--repo-path": "repoPath", "--source": "source", "--target": "target",
    "--project": "project", "--project-mapping": "projectMappingPath", "--output": "output" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--help" || argv[i] === "-h") return { help: true };
    const key = map[argv[i]];
    if (!key) continue;
    const value = argv[i + 1];
    if (!value || map[value]) throw new Error(`参数 ${argv[i]} 缺少值`);
    o[key] = value;
    i++;
  }
  o.output = o.output || ".code-review/sql-extraction/sql-extraction-result.json";
  return o;
}

function usage() {
  return "用法: node extract_mybatis_xml_changes.mjs --repo-path <repo> --source <src> --target <tgt> --project-mapping <mapping.json> [--output <out.json>]";
}

// 找到包含任一 changedLine 的 statement；同一 statement 只取一次
function statementsForChanges(parsed, changedLines) {
  const hits = new Map();
  for (const stmt of parsed.statements) {
    const endLine = stmt.node._endLine || stmt.startLine; // Task 3 onclosetag 已记录
    if (changedLines.some((ln) => ln >= stmt.startLine && ln <= endLine)) {
      hits.set(stmt.startLine, stmt);
    }
  }
  return [...hits.values()];
}

function itemForStatement(file, stmt, fragments, namespace) {
  const resolvedNode = resolveIncludes(stmt.node, fragments, new Set(), namespace);
  const templateSql = normalizeXmlSql(resolvedNode);
  if (!templateSql) return null;
  return {
    tables: extractTables(templateSql),
    file: `${file}:${stmt.startLine}`,
    templateSql,
  };
}

function qualifiedRefid(refid, namespace) {
  return refid.includes(".") || !namespace ? refid : `${namespace}.${refid}`;
}

function collectIncludeRefs(node, namespace, refs = new Set()) {
  if (node.kind !== "element") return refs;
  if (node.name === "include" && node.attributes.refid) {
    refs.add(qualifiedRefid(node.attributes.refid, namespace));
  }
  for (const child of node.children) collectIncludeRefs(child, namespace, refs);
  return refs;
}

function fingerprint(node) {
  if (!node) return null;
  if (node.kind === "text") return ["text", node.text];
  return [
    "element",
    node.name,
    Object.entries(node.attributes).sort(([a], [b]) => a.localeCompare(b)),
    node.children.map(fingerprint),
  ];
}

function parseMapperAtRevision(repo, revision, file) {
  if (!file) return null;
  const xml = readSourceAtRevision(repo, revision, file);
  return isMapperXml(xml) ? parseMapperXml(xml) : null;
}

function fragmentMap(parsed) {
  const fragments = new Map();
  if (!parsed) return fragments;
  for (const [id, node] of Object.entries(parsed.sqlFragments)) {
    fragments.set(qualifiedRefid(id, parsed.namespace), node);
  }
  return fragments;
}

function changedFragmentIds(repo, base, source, fileChanges) {
  const changed = new Set();
  for (const { oldFile, file } of fileChanges) {
    const before = fragmentMap(parseMapperAtRevision(repo, base, oldFile));
    const after = fragmentMap(parseMapperAtRevision(repo, source, file));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      if (JSON.stringify(fingerprint(before.get(id))) !== JSON.stringify(fingerprint(after.get(id)))) {
        changed.add(id);
      }
    }
  }
  return changed;
}

function loadProjectMappers(repo, source) {
  const mappers = [];
  for (const file of listXmlFilesAtRevision(repo, source)) {
    const parsed = parseMapperAtRevision(repo, source, file);
    if (parsed) mappers.push({ file, parsed });
  }
  return mappers;
}

function projectFragments(mappers) {
  const fragments = new Map();
  for (const { parsed } of mappers) {
    for (const [id, node] of Object.entries(parsed.sqlFragments)) {
      fragments.set(qualifiedRefid(id, parsed.namespace), { node, namespace: parsed.namespace });
    }
  }
  return fragments;
}

function affectedFragments(fragments, changed) {
  const reverseDependencies = new Map();
  for (const [id, fragment] of fragments) {
    for (const dependency of collectIncludeRefs(fragment.node, fragment.namespace)) {
      if (!reverseDependencies.has(dependency)) reverseDependencies.set(dependency, new Set());
      reverseDependencies.get(dependency).add(id);
    }
  }
  const affected = new Set(changed);
  const queue = [...changed];
  for (let i = 0; i < queue.length; i++) {
    for (const parent of reverseDependencies.get(queue[i]) || []) {
      if (!affected.has(parent)) {
        affected.add(parent);
        queue.push(parent);
      }
    }
  }
  return affected;
}

function statementMap(parsed) {
  const statements = new Map();
  if (!parsed) return statements;
  const counts = new Map();
  for (const stmt of parsed.statements) {
    const baseId = `${stmt.type}:${stmt.id}`;
    const occurrence = (counts.get(baseId) || 0) + 1;
    counts.set(baseId, occurrence);
    statements.set(`${baseId}:${occurrence}`, stmt);
  }
  return statements;
}

function changedStatementLocations(repo, base, source, fileChanges) {
  const changed = new Set();
  for (const { oldFile, file } of fileChanges) {
    const before = statementMap(parseMapperAtRevision(repo, base, oldFile));
    const after = statementMap(parseMapperAtRevision(repo, source, file));
    for (const [id, stmt] of after) {
      if (JSON.stringify(fingerprint(before.get(id)?.node)) !== JSON.stringify(fingerprint(stmt.node))) {
        changed.add(`${file}:${stmt.startLine}`);
      }
    }
  }
  return changed;
}

function buildProjectItems({ changed, fileChanges, base, repo, source }) {
  const mappers = loadProjectMappers(repo, source);
  const fragments = projectFragments(mappers);
  const affected = affectedFragments(fragments, changedFragmentIds(repo, base, source, fileChanges));
  const directlyChanged = changedStatementLocations(repo, base, source, fileChanges);
  const items = [];
  for (const { file, parsed } of mappers) {
    for (const stmt of parsed.statements) {
      const statementChanged = directlyChanged.has(`${file}:${stmt.startLine}`);
      const dependsOnChangedFragment = [...collectIncludeRefs(stmt.node, parsed.namespace)]
        .some((refid) => affected.has(refid));
      if (!statementChanged && !dependsOnChangedFragment) continue;
      const item = itemForStatement(file, stmt, fragments, parsed.namespace);
      if (item) items.push(item);
    }
  }
  return items;
}

export function buildItems({ changed, fileChanges, base, repo, source }) {
  if (base && fileChanges) return buildProjectItems({ changed, fileChanges, base, repo, source });
  const items = [];
  for (const { file, changedLines } of changed) {
    const xml = readSourceAtRevision(repo, source, file);
    const parsed = parseMapperXml(xml);
    for (const stmt of statementsForChanges(parsed, changedLines)) {
      const item = itemForStatement(file, stmt, parsed.sqlFragments, parsed.namespace);
      if (item) items.push(item);
    }
  }
  return items;
}

export function main(argv) {
  const opts = parseArguments(argv);
  if (opts.help) {
    console.log(usage());
    return null;
  }
  for (const key of ["repoPath", "source", "target", "projectMappingPath"]) {
    if (!opts[key]) throw new Error(`缺少必填参数 --${{
      repoPath: "repo-path", source: "source", target: "target", projectMappingPath: "project-mapping",
    }[key]}`);
  }
  const outAbs = isAbsolute(opts.output) ? opts.output : resolve(opts.repoPath, opts.output);
  try {
    const context = loadProjectMapping(readFileSync(opts.projectMappingPath, "utf-8"), opts.repoPath);
    const diff = resolveDiffContext(opts.repoPath, opts.source, opts.target);
    const items = buildItems({ ...diff, repo: opts.repoPath, source: opts.source });
    mkdirSync(dirname(outAbs), { recursive: true });
    const finalJson = {
      project: context.project,
      dataSources: context.dataSources,
      dataSourcesAlias: context.dataSourcesAlias,
      gitlabUrl: context.gitlabUrl,
      items,
    };
    writeFileSync(outAbs, JSON.stringify(finalJson, null, 2));
    console.log(JSON.stringify(finalJson));
    return finalJson;
  } catch (e) {
    try {
      mkdirSync(dirname(outAbs), { recursive: true });
      const ts = new Date().toISOString();
      appendFileSync(join(dirname(outAbs), "error.log"), `[${ts}] ${e.message}\n`);
    } catch (logErr) {
      // 连 error.log 都写不了，只能打到 stderr
      console.error(`无法写入 error.log: ${logErr.message}`);
    }
    throw e;
  }
}

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(e.message); process.exit(1); }
}
