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
