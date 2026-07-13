// lib/tables.mjs — SQL 表名提取
// 覆盖 FROM / JOIN / UPDATE / INSERT INTO / DELETE FROM 后的表名。
// 归一化：去 alias（取首个 token）、去引号/反引号/[...]；
//         大小写保留原样；去重、保持首次出现顺序。

const TABLE_RE =
  /\b(?:FROM|JOIN|UPDATE|INTO|DELETE\s+FROM)\s+("(?:[^"]+)"|`[^`]+`|\[[^\]]+\]|[A-Za-z_]\w*)/gi;

function stripQuotes(name) {
  // 去掉首尾的 " ` [ ]
  return name.replace(/^["`\[]|["`\]]$/g, "");
}

export function extractTables(sql) {
  const seen = new Map(); // name → true（保留首次插入顺序）
  let m;
  TABLE_RE.lastIndex = 0;
  while ((m = TABLE_RE.exec(sql)) !== null) {
    let name = stripQuotes(m[1]);
    // 取首个 token（去 alias：user u → user）
    name = name.split(/\s+/)[0];
    if (name && !seen.has(name)) seen.set(name, true);
  }
  return [...seen.keys()];
}
