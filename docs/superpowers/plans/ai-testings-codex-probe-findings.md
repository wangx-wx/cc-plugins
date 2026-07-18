# ai-testings Codex 探测结论

> 日期：2026-07-18  环境：codex-cli 0.144.5, model gpt-5.6-sol
> 方式：`codex exec` 非交互 + 根级 `hooks.json` marker 探针

## 结论汇总

| 探测点 | 结论 | 证据 |
|---|---|---|
| skill discovery | ✅ 支持 | `codex exec` 能识别并准确描述 `ai-testings:test-review` |
| 插件 hooks（HOOK_PATH / PRETOOLUSE / PLUGIN_ROOT_VAR） | ❌ **不支持** | `codex features list` → `plugin_hooks = removed/false`；根级 `hooks.json` marker 未触发（连无 matcher 的 Stop 都没命中）；`--enable plugin_hooks` 强开无效 |
| 命名子 agent（AGENTS_DECL / AGENT_META） | ❌ 不支持从插件 `agents/` 注册命名 agent | `codex exec` 回答不认识 `test-writer` 子 agent |

## 对方案的影响

1. **hooks（Task 4 需改向）**：Codex 当前不加载插件自带 hooks（`plugin_hooks` 已移除）。ai-testings 的提交关口提醒（`Stop`）与提交前测试检查（`PreToolUse:Bash`）**在 Codex 侧无法通过插件提供**。Claude 侧 `hooks/hooks.json` 保持不变。官方 figma/replayio 的 `hooks.json` 在当前 Codex 亦为历史遗留、不生效。→ Task 4 的「分支 A/B 双端适配」前提不成立，改为「记录限制 + 保留 Claude 侧」。

2. **test-writer（Task 5 需改向）**：Codex 不把插件 `agents/test-writer.md` 注册为可点名调用的命名子 agent。其 `multi_agent` 是通用 spawn（`spawn_agent`/`wait_agent`），角色由 prompt 描述。→ test-writer 能力在 Codex 侧应通过 **test-review skill 内联引用 test-writer 规范** 实现（SKILL.md 已中性化为「不支持子 agent 时内联执行」），不靠命名调用。

## 未决 / 可选后续

- Codex 用户级 `hooks`（feature `hooks = stable/true`）是另一套机制（用户/项目配置，非插件打包）；如需 Codex 侧提交提醒，可后续在用户 codex 配置探索，不属本插件 POC。
- 是否加 `agents/openai.yaml` 能让 Codex 识别命名 agent 未深入验证；当前证据倾向 Codex 无「插件命名 agent」机制。
