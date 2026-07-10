import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDataSource, resolveMapperDataSource } from "../lib/datasource.mjs";

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

test("I2: 方法级 @DS 无效时沿链采用接口级 @DS", () => {
  // 方法级 "ghost-ds" 不在 dataSources（陈旧名），接口级 "r" 有效
  const src = `@DS("r")
public interface M {
  @DS("ghost-ds") int a();
}`;
  const ctx = { project: "p", defaultDataSource: "m", dataSources: ["m", "r"] };
  const candidates = resolveMapperDataSource(src, "a");
  // 候选数组：方法级在前，接口级在后
  assert.deepEqual(candidates, [
    { name: "ghost-ds", evidence: "method-@DS" },
    { name: "r", evidence: "interface-@DS" },
  ]);
  const out = resolveDataSource(candidates, ctx);
  assert.deepEqual(out, { dataSource: "r", evidence: "interface-@DS" });
});
