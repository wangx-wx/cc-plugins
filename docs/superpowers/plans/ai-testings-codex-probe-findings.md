# ai-testings Codex 探测结论（修正版）

> 日期：2026-07-19  环境：codex-cli 0.144.5, model gpt-5.6-sol
> ⚠️ 重要修正：初版误判「插件 hooks 不支持」；实测证明 Codex **支持**插件 hooks，误判源于漏了 hook trust 机制。

## 结论汇总

| 探测点 | 结论 | 证据 |
|---|---|---|
| skill discovery | ✅ 支持 | `codex exec` 识别并描述 `ai-testings:test-review` |
| 插件 hooks | ✅ **支持**（需 manifest 声明 + hook trust） | `codex exec` 输出 `hook: PreToolUse Completed` / `hook: Stop Completed`；关键 flag `--dangerously-bypass-hook-trust` |
| 命名子 agent | ❌ 不支持从插件 `agents/` 注册 | `codex exec` 不识别 `test-writer` 子 agent |

## 插件 hooks 的正确机制（修正核心）

- **不是**靠自动发现 `hooks.json`（feature `plugin_hooks` 已 `removed`）。
- **是**在 `.codex-plugin/plugin.json` 的 `hooks` 字段**显式声明**（内联对象；事件名 `PreToolUse`/`Stop` 与 Claude 同构）。
- hooks 需 **hook trust**：
  - 自动化：`codex exec --dangerously-bypass-hook-trust`（实测生效）；
  - 正式使用：需持久化信任（首次交互授权，具体方式待确认）。
  - **初版误判正因 `codex exec` 无信任 → hook 被静默跳过。**

## 待 Task 4 落地验证的细节

1. hook 在**受限沙箱**运行：探针脚本写 `/tmp` 与 workdir 均未见输出 → ai-testings 真实 hook（`node ${...}/scripts/*.mjs` 输出提醒）能否正常执行、其 stdout 能否被 codex 采纳，需用真实脚本专门验证。
2. `${CLAUDE_PLUGIN_ROOT}` 在 hook 命令里是否解析：未确认（marker 未写成，读不到变量）。插件快照到 `~/.codex/plugins/cache/wx-cc-plugins/ai-testings/0.1.0`，hook 命令定位脚本的方式待解决。
3. 正式（非 bypass）的 hook trust 建立方式待确认。

## test-writer（命名 agent）

Codex 不把插件 `agents/test-writer.md` 注册为可点名调用的命名子 agent（`multi_agent` 是通用 spawn，角色由 prompt 描述）。test-writer 能力在 Codex 侧靠 **test-review skill 内联执行其规范**实现（SKILL.md 已中性化为「不支持子 agent 时内联执行」）。

## 对 POC 的净影响

- Codex 可行范围（修正后）：**skills ✅ + 插件 hooks ✅（有条件）**；命名 agent ❌（降级内联）。
- 比初版乐观：hooks 不是死路，Task 4 重新纳入为「manifest 声明 hooks + trust + 真实脚本验证」。
