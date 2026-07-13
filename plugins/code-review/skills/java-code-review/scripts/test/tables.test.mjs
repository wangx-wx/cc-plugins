import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTables } from "../lib/tables.mjs";

test("1. 单 FROM", () => {
  assert.deepEqual(extractTables("SELECT * FROM user"), ["user"]);
});

test("2. 多 FROM（JOIN）+ alias", () => {
  assert.deepEqual(
    extractTables("SELECT * FROM user u JOIN order o ON u.id = o.user_id"),
    ["user", "order"],
  );
});

test("3. UPDATE", () => {
  assert.deepEqual(
    extractTables("UPDATE account SET name = ? WHERE id = ?"),
    ["account"],
  );
});

test("4. INSERT INTO", () => {
  assert.deepEqual(
    extractTables("INSERT INTO log(id, msg) VALUES (?, ?)"),
    ["log"],
  );
});

test("5. DELETE FROM", () => {
  assert.deepEqual(
    extractTables("DELETE FROM session WHERE id = ?"),
    ["session"],
  );
});

test("6. 大小写保留原样", () => {
  assert.deepEqual(
    extractTables("SELECT * FROM User JOIN Order o"),
    ["User", "Order"],
  );
});

test("7. 去引号（双引号 + 反引号）", () => {
  assert.deepEqual(
    extractTables('SELECT * FROM "user" JOIN `order`'),
    ["user", "order"],
  );
});

test("8. 方括号（SQL Server）", () => {
  assert.deepEqual(extractTables("SELECT * FROM [user]"), ["user"]);
});

test("9. 去重（同一表多次出现）", () => {
  assert.deepEqual(
    extractTables(
      "SELECT * FROM user u JOIN order o ON u.id = (SELECT id FROM user WHERE ...)",
    ),
    ["user", "order"],
  );
});

test("10. CTE：CTE 名不算表，CTE 内部实表算", () => {
  const sql = `
WITH user_today AS (
  SELECT COUNT(*) AS cnt FROM ai_customer_operation_log WHERE user_id = ?
)
SELECT * FROM user_today
`;
  // user_today 是 CTE 名（临时视图），不算表；ai_customer_operation_log 是实表
  assert.deepEqual(extractTables(sql), ["ai_customer_operation_log"]);
});

test("10b. 多个 CTE：所有 CTE 名都过滤，实表保留去重", () => {
  const sql = `
WITH user_today AS (
  SELECT COUNT(*) AS cnt FROM ai_customer_operation_log WHERE user_id = ?
), user_30days AS (
  SELECT COUNT(*) AS cnt FROM ai_customer_operation_log WHERE user_id = ?
), merchant_today AS (
  SELECT COUNT(*) AS cnt FROM merchant WHERE id = ?
)
SELECT * FROM user_today, user_30days, merchant_today
`;
  // 三个 CTE 名都过滤；ai_customer_operation_log 去重；merchant 保留
  assert.deepEqual(extractTables(sql), ["ai_customer_operation_log", "merchant"]);
});

test("10c. CTE 列表中间插 MyBatis 动态标签（<if> 包裹 CTE）", () => {
  // 真实场景：动态标签插在 CTE 列表中间，CTE 名前是 <if>/</if> 而非逗号；
  // 且每个 CTE 名各自出现在 FROM cte_name 子查询里（被 TABLE_RE 提取）
  const sql = `WITH a AS (SELECT * FROM t1), <if> b AS (SELECT * FROM t2), </if> c AS (SELECT * FROM t3) SELECT (SELECT * FROM a), (SELECT * FROM b), (SELECT * FROM c)`;
  // a/b/c 都是 CTE 名（即使被 <if> 包裹），全过滤；t1/t2/t3 是实表
  assert.deepEqual(extractTables(sql), ["t1", "t2", "t3"]);
});

test("11. 标识符含数字/下划线", () => {
  assert.deepEqual(
    extractTables("SELECT * FROM user_profile_2"),
    ["user_profile_2"],
  );
});

test("12. 不匹配 WHERE 等无关关键字", () => {
  assert.deepEqual(
    extractTables("SELECT id FROM user WHERE status = ?"),
    ["user"],
  );
});

test("13. 空 SQL", () => {
  assert.deepEqual(extractTables(""), []);
});

test("14. 无表 SQL（如 SELECT 1）", () => {
  assert.deepEqual(extractTables("SELECT 1"), []);
});
