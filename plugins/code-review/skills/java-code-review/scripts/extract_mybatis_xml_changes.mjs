import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { parseMapperXml, resolveIncludes, normalizeXmlSql } from "./lib/mybatis-xml.mjs";
import { loadProjectMapping } from "./lib/datasource.mjs";
import { extractTables } from "./lib/tables.mjs";
import { resolveDiff, readSourceAtRevision } from "./lib/git-diff.mjs";

export function parseArguments(argv) {
  const o = {};
  const map = { "--repo-path": "repoPath", "--source": "source", "--target": "target",
    "--project": "project", "--project-mapping": "projectMappingPath", "--output": "output" };
  for (let i = 0; i < argv.length; i++) {
    const key = map[argv[i]];
    if (key && i + 1 < argv.length) o[key] = argv[++i];
  }
  o.output = o.output || ".code-review/sql-extraction/sql-extraction-result.json";
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

export function buildItems({ changed, repo, source }) {
  const items = [];
  for (const { file, changedLines } of changed) {
    const xml = readSourceAtRevision(repo, source, file);
    const parsed = parseMapperXml(xml);
    for (const stmt of statementsForChanges(parsed, changedLines)) {
      const resolvedNode = resolveIncludes(stmt.node, parsed.sqlFragments);
      const templateSql = normalizeXmlSql(resolvedNode);
      if (!templateSql) continue; // 边界不确定则跳过
      items.push({
        tables: extractTables(templateSql),
        file: `${file}:${stmt.startLine}`,
        templateSql,
      });
    }
  }
  return items;
}

export function main(argv) {
  const opts = parseArguments(argv);
  const outAbs = isAbsolute(opts.output) ? opts.output : resolve(opts.repoPath, opts.output);
  try {
    const context = loadProjectMapping(readFileSync(opts.projectMappingPath, "utf-8"), opts.repoPath);
    const changed = resolveDiff(opts.repoPath, opts.source, opts.target);
    const items = buildItems({ changed, repo: opts.repoPath, source: opts.source });
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
