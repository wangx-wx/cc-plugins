# 审查报告
## 审查范围
**Source:** feature/xxx → **Target:** origin/master

## 统计
| 级别 | 数量 |
|------|------|
| Blocker | 0 |
| Critical | 1 |
| Major | 1 |
| Minor | 0 |

## 优势
- 变更聚焦在单一模块，修改范围可控

## 问题

### Blocker
无

### Critical
1. **SQL 更新缺少 WHERE 条件**
   - 规则：JCR-00010 DML 无 WHERE 条件
   - 位置：db/migration/V20260101__update_user.sql:12
   - 证据：
     ```sql
     UPDATE user_profile SET status = 'INACTIVE';
     ```
   - 影响：可能更新全表数据，造成不可逆的业务影响
   - 修复建议：补充 WHERE 条件并评估影响范围

### Major
1. **查询SQL中存在SELECT \***
   - 规则：SQL-00001 SELECT *
   - 位置：mapper/history.xml:45
   - 证据：
     ```xml
     <select id="findAll">
       SELECT * FROM history
     </select>
     ```
   - 影响：字段变化导致不稳定与性能浪费
   - 修复建议：显式列出所需字段

### Minor
无

## 清单覆盖情况
| 维度 | 状态 | 说明 |
|------|------|------|
| P3C 静态分析 | 已覆盖 | 无违规 |
| 基础规范 | 已覆盖 | 检查命名与异常处理 |
| 配置文件 | 已覆盖 | 配置变更可回滚 |
| 数据库 XML | 已覆盖 | 发现 SQL 问题 |

## 修复建议
- 建议为关键 SQL 变更补充回滚脚本

## 评估结论
是否可合并： 否

**理由：**
1. 存在 Critical 级问题（SQL 无 WHERE），需修复后再合并以避免数据风险。
