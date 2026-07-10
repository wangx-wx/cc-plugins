import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMapperDataSource } from "../lib/datasource.mjs";

const IFACE = `package cn.demo;
import com.baomidou.dynamic.datasource.annotation.DS;
@DS("advert-read")
public interface ReportMapper {
  @DS("advert-master")
  int save(Report r);
  List<Report> list();
}`;

test("方法级 + 接口级 @DS 同时存在时返回有序候选数组", () => {
  assert.deepEqual(resolveMapperDataSource(IFACE, "save"), [
    { name: "advert-master", evidence: "method-@DS" },
    { name: "advert-read", evidence: "interface-@DS" },
  ]);
});

test("方法无 @DS 时候选数组只含接口级", () => {
  assert.deepEqual(resolveMapperDataSource(IFACE, "list"), [
    { name: "advert-read", evidence: "interface-@DS" },
  ]);
});

test("全限定名 @DS 也识别", () => {
  const src = `public interface M { @com.baomidou.dynamic.datasource.annotation.DS("x") int a(); }`;
  assert.deepEqual(resolveMapperDataSource(src, "a"), [
    { name: "x", evidence: "method-@DS" },
  ]);
});

test("无任何 @DS 返回空数组", () => {
  assert.deepEqual(resolveMapperDataSource(`public interface M { int a(); }`, "a"), []);
});

test("非字符串字面量参数视为无", () => {
  const src = `public interface M { @DS(DsConst.READ) int a(); }`;
  assert.deepEqual(resolveMapperDataSource(src, "a"), []);
});
