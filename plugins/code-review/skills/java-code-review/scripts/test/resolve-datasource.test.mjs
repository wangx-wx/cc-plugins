import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDataSource } from "../lib/datasource.mjs";

const CTX = { project: "advert", defaultDataSource: "m", dataSources: ["m", "r"] };

test("按顺序取第一个合法候选", () => {
  const out = resolveDataSource([{ name: "r", evidence: "method-@DS" }, { name: "m", evidence: "interface-@DS" }], CTX);
  assert.deepEqual(out, { dataSource: "r", evidence: "method-@DS" });
});

test("跳过 null 与不在 dataSources 的候选", () => {
  const out = resolveDataSource([null, { name: "unknown", evidence: "service-@DS" }, { name: "r", evidence: "interface-@DS" }], CTX);
  assert.deepEqual(out, { dataSource: "r", evidence: "interface-@DS" });
});

test("多数据源无有效候选 -> default-fallback", () => {
  assert.deepEqual(resolveDataSource([null], CTX), { dataSource: "m", evidence: "default-fallback" });
});

test("单数据源无候选 -> single-ds", () => {
  const ctx1 = { project: "p", defaultDataSource: "only", dataSources: ["only"] };
  assert.deepEqual(resolveDataSource([null], ctx1), { dataSource: "only", evidence: "single-ds" });
});
