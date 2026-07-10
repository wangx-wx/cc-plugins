import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDataSourceContext } from "../lib/datasource.mjs";

test("接受合法上下文", () => {
  const ctx = loadDataSourceContext(
    JSON.stringify({ project: "advert", defaultDataSource: "m", dataSources: ["m", "r"] })
  );
  assert.equal(ctx.project, "advert");
  assert.deepEqual(ctx.dataSources, ["m", "r"]);
});

test("project 为空则抛错", () => {
  assert.throws(
    () => loadDataSourceContext(JSON.stringify({ project: "", defaultDataSource: "m", dataSources: ["m"] })),
    /project/
  );
});

test("defaultDataSource 不在 dataSources 内则抛错", () => {
  assert.throws(
    () => loadDataSourceContext(JSON.stringify({ project: "advert", defaultDataSource: "x", dataSources: ["m"] })),
    /defaultDataSource/
  );
});
