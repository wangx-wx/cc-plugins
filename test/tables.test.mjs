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

test("10. CTE：内部实表 + 外层 CTE 名（首次出现顺序）", () => {
  const sql = `
WITH user_today AS (
  SELECT COUNT(*) AS cnt FROM ai_customer_operation_log WHERE user_id = ?
)
SELECT * FROM user_today
`;
  assert.deepEqual(extractTables(sql), [
    "ai_customer_operation_log",
    "user_today",
  ]);
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
