---
name: test-review
description: 审查当前代码变更(git diff)，依据团队《Java 后端测试规范》判定每处变更「是否需要测试 / 哪种测试 / 能否复用现有测试 / 旧测试是否需更新」，输出审查清单。当用户要做提交前测试检查、审查测试覆盖、或提到「测试审查 / test-review」时使用。
---

# test-review：变更测试需求审查

依据团队规范（`${CLAUDE_PLUGIN_ROOT}/references/testing-rules.md`）审查本次变更，判断每处该不该测、测哪种、能不能复用现有测试。

## 步骤

1. **取变更**：`git diff --name-only HEAD` 与 `git diff HEAD`；无 git 则取本轮会话改动的文件。
2. **逐个 `src/main` 变更文件分层判断**（判断矩阵见规范 §1.1）：
   - Service / 领域逻辑、Util / 纯函数 → 单测**必需**
   - Mapper / 自定义 SQL → 集成测试**必需**（连 dev，见 §4）
   - Controller → 有逻辑才单测；接口契约推荐 `@WebMvcTest`
   - DTO / VO / Entity / Config / 常量 → 豁免（须注明原因）
3. **复用优先**（规范 §1.1，**不是所有变更都要新写**）：
   - 先按命名约定（§7：`XxxTest` / `XxxIT`）查是否已有对应测试；
   - 已覆盖本次改动 → 结论「**跑现有测试验证**」，必要时只更新断言；
   - 有测试但未覆盖 → 「**补用例**」；
   - 完全没有且按矩阵需要 → 才「**新写**」。
4. **红线检查**（规范 §3）：旧测试若有 `System.out` / `Thread.sleep` / 硬编码密钥 / 纯逻辑用 `@SpringBootTest` 等，一并标出待整改。
5. **输出审查清单**：

   | 文件 | 分层 | 变更性质 | 建议测试 | 现有测试 | 结论(复用/补/新写/豁免) |
   |---|---|---|---|---|---|

6. 询问是否调用 `test-writer` agent 生成 / 更新测试。

## 规则来源

判断矩阵、红线、数据源护栏（§3 连 dev 三护栏）、真/mock/关（§5）、目录与命名（§7）**一律以 `${CLAUDE_PLUGIN_ROOT}/references/testing-rules.md` 为准**，本文件不重复维护，只做流程编排。
