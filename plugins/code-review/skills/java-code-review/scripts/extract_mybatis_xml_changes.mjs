import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseMapperXml, resolveIncludes, normalizeXmlSql } from "./lib/mybatis-xml.mjs";
import { loadProjectMapping, resolveMapperDataSource, resolveServiceDataSource, resolveDataSource } from "./lib/datasource.mjs";
import { resolveDiff, readSourceAtRevision } from "./lib/git-diff.mjs";

export function parseArguments(argv) {
  const o = {};
  const map = { "--repo-path": "repoPath", "--source": "source", "--target": "target",
    "--project": "project", "--project-mapping": "projectMappingPath", "--output": "output" };
  for (let i = 0; i < argv.length; i++) {
    const key = map[argv[i]];
    if (key && i + 1 < argv.length) o[key] = argv[++i];
  }
  o.output = o.output || ".codex/sql-extraction/sql-extraction-result.json";
  return o;
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

export function buildItems({ changed, repo, source, context }) {
  const items = [];
  let cachedJavaFiles = null; // collectJavaFiles 结果只依赖 (repo, source)，整次运行不变
  for (const { file, changedLines } of changed) {
    const xml = readSourceAtRevision(repo, source, file);
    const parsed = parseMapperXml(xml);
    const mapperJava = tryReadMapperInterface(repo, source, parsed.namespace);
    for (const stmt of statementsForChanges(parsed, changedLines)) {
      const resolvedNode = resolveIncludes(stmt.node, parsed.sqlFragments);
      const templateSql = normalizeXmlSql(resolvedNode);
      if (!templateSql) continue; // 边界不确定则跳过

      const candidates = [];
      if (mapperJava) candidates.push(...resolveMapperDataSource(mapperJava, stmt.id)); // method/interface 候选数组
      // 仅多数据源、且 mapper 级未取到有效候选时，尝试 Service 层
      const mapperHit = candidates.find((c) => c && context.dataSources.includes(c.name));
      if (!mapperHit && context.dataSources.length > 1) {
        if (!cachedJavaFiles) cachedJavaFiles = collectJavaFiles(repo, source); // 懒缓存：首次需要时才扫
        const simpleName = parsed.namespace.split(".").pop();
        candidates.push(resolveServiceDataSource(cachedJavaFiles, simpleName, stmt.id));
      }
      const { dataSource, evidence } = resolveDataSource(candidates, context);
      const item = { dataSource, file: `${file}:${stmt.startLine}`, templateSql, evidence };
      const aliasIdx = context.dataSources.indexOf(dataSource);
      if (aliasIdx >= 0 && context.dataSourcesAlias && context.dataSourcesAlias[aliasIdx]) {
        item.dataSourcesAlia = context.dataSourcesAlias[aliasIdx];
      }
      items.push(item);
    }
  }
  return items;
}

function tryReadMapperInterface(repo, source, namespace) {
  if (!namespace) return null;
  const rel = namespace.replace(/\./g, "/") + ".java";
  for (const base of ["src/main/java/", ""]) {
    try { return readSourceAtRevision(repo, source, base + rel); } catch { /* try next */ }
  }
  return null;
}

function collectJavaFiles(repo, source) {
  let list = [];
  try {
    list = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", source], { maxBuffer: 50 * 1024 * 1024 })
      .toString("utf-8").split("\n").filter((p) => p.endsWith(".java"));
  } catch { return []; }
  const files = [];
  for (const p of list) {
    try { files.push({ path: p, content: readSourceAtRevision(repo, source, p) }); } catch { /* skip */ }
  }
  return files;
}

export function main(argv) {
  const opts = parseArguments(argv);
  const outAbs = isAbsolute(opts.output) ? opts.output : resolve(opts.repoPath, opts.output);
  try {
    const context = loadProjectMapping(readFileSync(opts.projectMappingPath, "utf-8"), opts.repoPath);
    const changed = resolveDiff(opts.repoPath, opts.source, opts.target);
    const withEvidence = buildItems({ changed, repo: opts.repoPath, source: opts.source, context });
    mkdirSync(dirname(outAbs), { recursive: true });
    const finalJson = {
      project: context.project,
      gitlabUrl: context.gitlabUrl,
      items: withEvidence.map(({ evidence, ...rest }) => rest),
    };
    writeFileSync(outAbs, JSON.stringify(finalJson, null, 2));
    writeFileSync(join(dirname(outAbs), ".debug-candidates.json"),
      JSON.stringify({ project: context.project, gitlabUrl: context.gitlabUrl, items: withEvidence }, null, 2));
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
