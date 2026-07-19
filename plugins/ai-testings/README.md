# tdd-skills

Java 后端测试规范助手（Claude Code plugin）。把团队《Java 后端测试规范》变成可执行的**审查 → 生成 → 提醒**能力。

技术栈基线：MyBatis-Plus + PostgreSQL，JDK8 / JDK17 双栈；配置走 Apollo。

## 组成

| 组件 | 类型 | 作用 |
|---|---|---|
| `references/testing-rules.md` | 规范（skill/agent 执行依据） | 判断矩阵、红线、数据源护栏、真/mock/关、目录与命名。skill/agent 引用这份精简规则，不含决策过程 |
| `test-review` | skill | 审查 `git diff`，判定每处变更该不该测 / 测哪种 / 能否复用现有测试 / 旧测试是否需更新，输出清单后询问用户是否启动 test-writer |
| `test-writer` | agent | 按规范生成单测 / 集成测试并 `mvn` 验证；优先读取项目级测试规则（`.claude/rules/generated/*testing-rules.md`）和项目 `CLAUDE.md`/`AGENTS.md`，团队通用规范兜底 |
| `scripts/stop-test-reminder.mjs` | hook（Stop） | 轮末软提醒：改了 `src/main` 缺测试就提示（`systemMessage`，不阻断） |
| `scripts/pre-commit-test-check.mjs` | hook（PreToolUse/Bash） | `git commit` 前软提醒：暂存改动缺测试就提示（不阻断） |

## 核心约定（摘要，详见 `references/testing-rules.md`）

- **集成测试数据源**：连 Apollo DEV 共享库，复用运行时配置，**仅本地、不进 CI**。
- **三护栏**：环境校验（`APOLLO_ENV=DEV`）/ 真实数据提醒 / `@Transactional` 回滚不留数据。
- **真 / mock / 关**：DB 用真；外部 HTTP/RPC/LLM、MQ 发送 → mock；MQ 消费 → 直接调 listener；Eureka/xxljob → 关闭。
- **目录与命名**：`src/test/java` 镜像包；`*Test`（单测）/ `*IT`（集成）；方法名 `test方法_条件_预期` + `@DisplayName` 中文。
- **覆盖要求**：每个 public 方法至少覆盖正常路径（happy path）+ 主要异常路径。
- **复用优先**：不是所有变更都新写——已有测试覆盖则跑验证，未覆盖补用例，完全没有才新写。
- **豁免**：DTO/VO/Entity/Config/常量、抽象类/接口/枚举/`@interface` 无需测试。

## 规范优先级（test-writer 读取顺序）

1. 项目级测试规则 `.claude/rules/generated/*testing-rules.md`（项目特有约定）
2. 项目 `CLAUDE.md` / `AGENTS.md` 中的测试相关段落
3. 团队通用规范 `references/testing-rules.md`（兜底）

> 文件不存在或无测试相关内容则跳过；三条都没有时用 JUnit 5 + Mockito + AssertJ 通用规范。

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
    ├── stop-test-reminder.mjs       # hook 脚本（运行中）
    ├── stop-test-reminder.sh        # bash 版本（参考）
    ├── pre-commit-test-check.mjs    # hook 脚本（运行中）
    └── pre-commit-test-check.sh     # bash 版本（参考）
```

## 在 Codex 中使用（双宿主）

本插件同时兼容 Codex（`.codex-plugin/plugin.json`）。安装：

```bash
# 注册本仓库 marketplace（一次）
codex plugin marketplace add /path/to/wx-cc-plugins
# 安装
codex plugin add ai-testings --marketplace wx-cc-plugins
```

Codex 侧能力与差异（探测于 codex-cli 0.144.5，详见 `docs/superpowers/plans/ai-testings-codex-probe-findings.md`）：

| 能力 | Claude Code | Codex |
|---|---|---|
| `test-review` skill | ✅ 原生 | ✅ 原生发现并触发（`ai-testings:test-review`） |
| `test-writer` | 命名子 agent | **内联执行**其规范（Codex 不注册插件命名 agent） |
| hooks（Stop / PreToolUse 提醒） | ✅ 自动发现 `hooks/hooks.json` | ⚠️ 声明就绪、事件能触发（manifest `hooks` + hook trust），但 `codex exec` 下 systemMessage 输出未见效，**实效待交互会话/官方契约确认** |

> Codex 的插件 hooks 由 `.codex-plugin/plugin.json` 的 `hooks` 字段声明（`plugin_hooks` 自动发现已移除）；实测 `codex exec` 下 hook 触发但输出/副作用不可见（详见 `docs/superpowers/plans/ai-testings-codex-probe-findings.md`）。Claude 侧 hook 不受影响、完全可用。
