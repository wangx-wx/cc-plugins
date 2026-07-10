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
  const candidates = [];
  const method = findMethodDs(javaSource, methodName);
  if (method) candidates.push({ name: method, evidence: "method-@DS" });
  const iface = findTypeDs(javaSource);
  if (iface) candidates.push({ name: iface, evidence: "interface-@DS" });
  return candidates; // 可能为 []；∈ dataSources 校验交给 resolveDataSource 按序处理
}

// 从调用点位置向上回溯，找最近的方法头上的 @DS；无则找类级 @DS。近似实现，复杂写法返回 null。
function dsAtCallSite(content, callIndex) {
  const before = content.slice(0, callIndex);
  // 最近方法头：向前找上一个 '{'（方法体起点）之前的方法签名片段
  const braceIdx = before.lastIndexOf("{");
  if (braceIdx >= 0) {
    const sigCut = Math.max(before.lastIndexOf(";", braceIdx), before.lastIndexOf("}", braceIdx));
    const methodHead = before.slice(sigCut + 1, braceIdx);
    const dm = methodHead.match(DS_LITERAL);
    if (dm) return dm[1];
  }
  // 类级：整文件第一个 class/interface 前的 @DS
  const decl = content.search(/\b(?:public\s+)?(?:interface|class)\s+\w+/);
  if (decl >= 0) {
    const dm = content.slice(0, decl).match(DS_LITERAL);
    if (dm) return dm[1];
  }
  return null;
}

export function resolveServiceDataSource(javaFiles, mapperSimpleName, methodName) {
  const fieldDecl = new RegExp(`\\b${mapperSimpleName}\\s+(\\w+)\\s*[;=]`);
  const found = new Set();
  for (const f of javaFiles) {
    const fm = f.content.match(fieldDecl);
    if (!fm) continue; // 该文件未显式声明此 Mapper 类型字段 -> 跳过（保守）
    const fieldName = fm[1];
    const callRe = new RegExp(`\\b${fieldName}\\s*\\.\\s*${methodName}\\s*\\(`, "g");
    let cm;
    while ((cm = callRe.exec(f.content)) !== null) {
      const ds = dsAtCallSite(f.content, cm.index);
      if (ds) found.add(ds);
    }
  }
  if (found.size === 1) return { name: [...found][0], evidence: "service-@DS" };
  return null; // 0（无）或 >1（多义）都降级
}

export function resolveDataSource(orderedCandidates, context) {
  for (const c of orderedCandidates) {
    if (c && context.dataSources.includes(c.name)) {
      return { dataSource: c.name, evidence: c.evidence };
    }
  }
  const evidence = context.dataSources.length === 1 ? "single-ds" : "default-fallback";
  return { dataSource: context.defaultDataSource, evidence };
}
