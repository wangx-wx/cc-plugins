// lib/tables.mjs — SQL 表名提取
// 覆盖 FROM / JOIN / UPDATE / INSERT INTO / DELETE FROM 后的表名。
// 归一化：去 alias（取首个 token）、去引号/反引号/[...]；
//         大小写保留原样；去重、保持首次出现顺序。
// CTE 名（WITH name AS ... 的临时视图名）不算实表，过滤掉。

const IDENTIFIER = '"(?:[^"]+)"|`[^`]+`|\\[[^\\]]+\\]|[A-Za-z_]\\w*';
const TABLE_RE = new RegExp(
  `\\b(?:FROM|JOIN|UPDATE|INTO|DELETE\\s+FROM)\\s+((?:${IDENTIFIER})(?:\\s*\\.\\s*(?:${IDENTIFIER}))*)`,
  "gi",
);
const DYNAMIC_FROM_RE = /\bFROM\s*<choose\b[^>]*>([\s\S]*?)<\/choose>/gi;
const DYNAMIC_BRANCH_RE = new RegExp(
  `<(?:when|otherwise)\\b[^>]*>\\s*((?:${IDENTIFIER})(?:\\s*\\.\\s*(?:${IDENTIFIER}))*)`,
  "gi",
);

// CTE 名：name AS ( —— 不限定前面是 WITH/,，因为 MyBatis 动态标签 <if>/<choose> 可能插在 CTE 列表中间，
// 导致 CTE 名前是标签而非逗号。AS ( 在 SQL 里几乎只出现在 CTE 定义，故该模式足够精准。
const CTE_RE = /([A-Za-z_]\w*)\s+AS\s*\(/gi;

function normalizeTableName(name) {
  return name.trim()
    .replace(/"([^"]+)"|`([^`]+)`|\[([^\]]+)\]/g, (_, quoted, backticked, bracketed) =>
      quoted ?? backticked ?? bracketed)
    .replace(/\s*\.\s*/g, ".");
}

function maskSqlLiteralsAndComments(sql) {
  let masked = "";
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      const comment = sql.slice(i, end === -1 ? sql.length : end);
      masked += comment.replace(/./g, " ");
      i += comment.length;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      const comment = sql.slice(i, end === -1 ? sql.length : end + 2);
      masked += comment.replace(/[^\n]/g, " ");
      i += comment.length;
    } else if (sql[i] === "'") {
      masked += " ";
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          masked += "  ";
          i += 2;
        } else if (sql[i] === "'") {
          masked += " ";
          i++;
          break;
        } else {
          masked += sql[i] === "\n" ? "\n" : " ";
          i++;
        }
      }
    } else {
      masked += sql[i++];
    }
  }
  return masked;
}

function collectCteNames(sql) {
  const names = new Set();
  let m;
  CTE_RE.lastIndex = 0;
  while ((m = CTE_RE.exec(sql)) !== null) names.add(m[1].toLowerCase());
  return names;
}

export function extractTables(sql) {
  const sqlWithoutLiteralsAndComments = maskSqlLiteralsAndComments(sql);
  const cteNames = collectCteNames(sqlWithoutLiteralsAndComments);
  const seen = new Map(); // name → true（保留首次插入顺序）
  const addTable = (rawName) => {
    const name = normalizeTableName(rawName).split(/\s+/)[0];
    if (name && !cteNames.has(name.toLowerCase()) && !seen.has(name)) seen.set(name, true);
  };
  let m;
  TABLE_RE.lastIndex = 0;
  while ((m = TABLE_RE.exec(sqlWithoutLiteralsAndComments)) !== null) {
    addTable(m[1]);
  }
  DYNAMIC_FROM_RE.lastIndex = 0;
  while ((m = DYNAMIC_FROM_RE.exec(sqlWithoutLiteralsAndComments)) !== null) {
    DYNAMIC_BRANCH_RE.lastIndex = 0;
    let branch;
    while ((branch = DYNAMIC_BRANCH_RE.exec(m[1])) !== null) addTable(branch[1]);
  }
  return [...seen.keys()];
}
