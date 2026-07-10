export function loadDataSourceContext(jsonText) {
  let ctx;
  try {
    ctx = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`数据源上下文不是合法 JSON: ${e.message}`);
  }
  if (!ctx || typeof ctx.project !== "string" || ctx.project.trim() === "") {
    throw new Error("数据源上下文缺少非空 project");
  }
  if (!Array.isArray(ctx.dataSources) || ctx.dataSources.length === 0) {
    throw new Error("数据源上下文缺少非空 dataSources");
  }
  if (!ctx.dataSources.includes(ctx.defaultDataSource)) {
    throw new Error("defaultDataSource 必须在 dataSources 列表内");
  }
  return { project: ctx.project, defaultDataSource: ctx.defaultDataSource, dataSources: ctx.dataSources };
}

// 匹配 @DS("literal") 或 @...DS("literal")，仅字符串字面量
const DS_LITERAL = /@(?:[\w.]*\.)?DS\s*\(\s*"([^"]+)"\s*\)/;

// 找方法声明前紧邻的 @DS。策略：定位 `methodName(`，向前截取到上一个 `;`、`}` 或 `{` 之后的片段作为“方法头”，在其中找 @DS。
function findMethodDs(javaSource, methodName) {
  const re = new RegExp(`\\b${methodName}\\s*\\(`, "g");
  let m;
  while ((m = re.exec(javaSource)) !== null) {
    const head = javaSource.slice(0, m.index);
    const cut = Math.max(head.lastIndexOf(";"), head.lastIndexOf("{"), head.lastIndexOf("}"));
    const methodHead = javaSource.slice(cut + 1, m.index);
    const dm = methodHead.match(DS_LITERAL);
    if (dm) return dm[1];
  }
  return null;
}

// 接口级：取 interface/class 声明关键字之前的 @DS
function findTypeDs(javaSource) {
  const decl = javaSource.search(/\b(?:public\s+)?(?:interface|class)\s+\w+/);
  if (decl < 0) return null;
  const dm = javaSource.slice(0, decl).match(DS_LITERAL);
  return dm ? dm[1] : null;
}

export function resolveMapperDataSource(javaSource, methodName) {
  const method = findMethodDs(javaSource, methodName);
  if (method) return { name: method, evidence: "method-@DS" };
  const iface = findTypeDs(javaSource);
  if (iface) return { name: iface, evidence: "interface-@DS" };
  return null;
}
