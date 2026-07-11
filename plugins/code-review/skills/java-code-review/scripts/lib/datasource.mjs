import { execFileSync } from "node:child_process";

function normalizeUrl(u) {
  return u.trim().toLowerCase().replace(/\.git$/, "");
}

export function loadProjectMapping(jsonText, repoPath) {
  let arr;
  try { arr = JSON.parse(jsonText); }
  catch (e) { throw new Error(`项目映射文件不是合法 JSON: ${e.message}`); }
  if (!Array.isArray(arr)) throw new Error("项目映射必须是数组");
  for (const [i, e] of arr.entries()) {
    if (!e || typeof e.gitlabUrl !== "string" || e.gitlabUrl.trim() === "") {
      throw new Error(`项目映射第 ${i} 条缺少非空 gitlabUrl`);
    }
  }
  let repoRemote;
  try {
    repoRemote = execFileSync("git", ["-C", repoPath, "ls-remote", "--get-url"], { stdio: ["pipe", "pipe", "pipe"] })
      .toString("utf-8").trim();
  } catch (e) {
    throw new Error(`无法读取仓库 ${repoPath} 的 remote url: ${e.stderr?.toString().trim() || e.message}`);
  }
  const normalizedRemote = normalizeUrl(repoRemote);
  const matched = arr.find((e) => normalizeUrl(e.gitlabUrl) === normalizedRemote);
  if (!matched) throw new Error(`仓库 remote url ${repoRemote} 未在项目映射中找到`);
  if (typeof matched.project !== "string" || matched.project.trim() === "") {
    throw new Error("匹配条目的 project 为空");
  }
  if (!Array.isArray(matched.dataSources) || matched.dataSources.length === 0) {
    throw new Error("匹配条目的 dataSources 为空或缺失");
  }
  const alias = matched.dataSourcesAlias;
  if (!Array.isArray(alias) || alias.length !== matched.dataSources.length) {
    throw new Error("匹配条目的 dataSourcesAlias 长度与 dataSources 不一致");
  }
  return {
    project: matched.project,
    dataSources: matched.dataSources,
    dataSourcesAlias: alias,
    gitlabUrl: matched.gitlabUrl,
    defaultDataSource: matched.dataSources[0],
  };
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
  return { dataSource: context.defaultDataSource, evidence: "default-first" };
}
