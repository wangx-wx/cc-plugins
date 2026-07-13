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
