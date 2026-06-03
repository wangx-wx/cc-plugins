# tdd-skills

Java 后端测试规范助手（Claude Code plugin）。把团队《Java 后端测试规范》变成可执行的**审查 → 生成 → 提醒**能力。

技术栈基线：MyBatis-Plus + PostgreSQL，JDK8 / JDK17 双栈；配置走 Apollo。

## 组成

| 组件 | 类型 | 作用 |
|---|---|---|
| `references/testing-rules.md` | 规范（skill/agent 执行依据） | 判断矩阵、红线、数据源护栏、真/mock/关、目录与命名。skill/agent 引用这份精简规则，不含决策过程 |
| `test-review` | skill | 审查 `git diff`，判定每处变更该不该测 / 测哪种 / 能否复用现有测试 / 旧测试是否需更新，输出清单 |
| `test-writer` | agent | 按规范生成单测 / 集成测试并 `mvn` 验证；集成测试连 dev + 三护栏 + 事务回滚 |
| `scripts/stop-test-reminder.sh` | hook（Stop） | 轮末软提醒：改了 `src/main` 缺测试就提示（`systemMessage`，不阻断） |
| `scripts/pre-commit-test-check.sh` | hook（PreToolUse/Bash） | `git commit` 前软提醒：暂存改动缺测试就提示（不阻断） |
| `java-testing-design.md` | 设计记录 | 决策过程、候选方案对比，仅供人参考，不被 skill/agent 引用 |

## 核心约定（摘要，详见 `references/testing-rules.md`）

- **集成测试数据源**：连 Apollo DEV 共享库，复用运行时配置，**仅本地、不进 CI**。
- **三护栏**：环境校验（`APOLLO_ENV=DEV`）/ 真实数据提醒 / `@Transactional` 回滚不留数据。
- **真 / mock / 关**：DB 用真；外部 HTTP/RPC/LLM、MQ 发送 → mock；MQ 消费 → 直接调 listener；Eureka/xxljob → 关闭。
- **目录与命名**：`src/test/java` 镜像包；`*Test`（单测）/ `*IT`（集成）；方法名 `方法_条件_预期` + `@DisplayName` 中文。
- **复用优先**：不是所有变更都新写——已有测试覆盖则跑验证，未覆盖补用例，完全没有才新写。

## 目录结构

```
tdd-skills/
├── .claude-plugin/plugin.json
├── java-testing-design.md           # 设计记录（决策过程，给人看）
├── references/testing-rules.md      # 规范（skill/agent 执行依据）
├── skills/test-review/SKILL.md
├── agents/test-writer.md
├── hooks/hooks.json
└── scripts/
    ├── stop-test-reminder.sh
    └── pre-commit-test-check.sh
```
