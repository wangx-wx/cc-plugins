import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveServiceDataSource } from "../lib/datasource.mjs";

const SINGLE = [{
  path: "OrderService.java",
  content: `class OrderService {
  private ReportMapper reportMapper;
  @DS("advert-master")
  public void doIt() { reportMapper.list(); }
}`,
}];

test("唯一调用方 + 方法 @DS 采用 service-@DS", () => {
  assert.deepEqual(resolveServiceDataSource(SINGLE, "ReportMapper", "list"),
    { name: "advert-master", evidence: "service-@DS" });
});

test("多个不同 @DS 调用方 -> 多义 -> null", () => {
  const files = [
    { path: "A.java", content: `class A { ReportMapper m; @DS("x") void f(){ m.list(); } }` },
    { path: "B.java", content: `class B { ReportMapper m; @DS("y") void g(){ m.list(); } }` },
  ];
  assert.equal(resolveServiceDataSource(files, "ReportMapper", "list"), null);
});

test("找不到该 Mapper 类型字段 -> null（复杂注入降级）", () => {
  const files = [{ path: "C.java", content: `class C { @DS("x") void f(){ someOther.list(); } }` }];
  assert.equal(resolveServiceDataSource(files, "ReportMapper", "list"), null);
});

test("调用点所在方法无 @DS 但类级有 @DS -> 采用类级", () => {
  const files = [{ path: "D.java", content: `@DS("clazz") class D { ReportMapper m; void f(){ m.list(); } }` }];
  assert.deepEqual(resolveServiceDataSource(files, "ReportMapper", "list"),
    { name: "clazz", evidence: "service-@DS" });
});
