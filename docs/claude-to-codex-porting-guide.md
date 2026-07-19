# Claude Code 插件 → Codex 双宿主移植指南

> 基于 **ai-testings POC** 实测整理（`codex-cli 0.144.5`, `model gpt-5.6-sol`, 2026-07）。
> 本指南是可操作的 playbook：拿一个现成的 Claude Code 插件，照着把它变成 Claude Code + Codex 双宿主。
> 一手证据与单次记录见：`docs/claude-code-codex-plugin-compatibility.md`（前期调研）、`docs/superpowers/specs/`、`docs/superpowers/plans/`（POC 设计/计划/探测结论）。

---

## 0. 核心思想

```
一套能力核心（唯一真源）：skills/ · agents/ · scripts/ · references/
        ├── Claude 适配：.claude-plugin/plugin.json · allowed-tools · hooks/hooks.json（自动发现）
        └── Codex  适配：.codex-plugin/plugin.json · skills/*/agents/openai.yaml · manifest 声明 hooks
```

三条不变量（来自 superpowers，POC 验证成立）：
1. **skills 是唯一能力源**，宿主中立——SKILL.md 描述「动作」，不写具体宿主的工具名。
2. **每个宿主一个薄 manifest**，不共用一份 manifest。
3. **不做 bootstrap 注入**——Claude Code 与 Codex 都有原生 skill discovery，bootstrap 是 superpowers 为「无原生发现的 harness」准备的，两者都用不上（superpowers 官方 Codex 版也不带）。

---

## 1. Codex 能力矩阵（实测）

| 能力 | Claude Code | Codex（实测结论） | 移植处理 |
|---|---|---|---|
| **skill 发现/触发** | ✅ 原生 | ✅ **原生**（读 manifest `skills` + 各 skill `agents/openai.yaml`） | 共享 SKILL.md + 每 skill 加 `openai.yaml` |
| **SKILL.md frontmatter** | `name` / `description` | ✅ 同构 | 直接共享，不用改 |
| **宿主工具**（`AskUserQuestion` 等） | 原生 | ❌ 无同名工具 | **中性化**：正文描述动作，不点名工具 |
| **命名子 agent**（`agents/*.md`） | ✅ 可点名派发 | ❌ **不把插件 agents/ 注册为命名 agent** | **内联降级**：SKILL.md 写「支持子 agent 则派发，否则内联执行其规范」 |
| **多 agent** | ✅ | ✅ 通用 spawn（`--enable multi_agent`），角色由 prompt 描述 | 靠 prompt 传角色，不靠名字 |
| **插件 hooks** | ✅ 自动发现 `hooks/hooks.json` | ⚠️ **需 manifest 声明 `hooks` + hook trust**；`plugin_hooks`（自动发现）已 `removed`；`codex exec` 下 systemMessage/副作用**不可见，实效待定** | manifest 声明 + trust；实效需交互会话确认 |
| **MCP** | `mcp__plugin_<plugin>_<server>__<tool>` | `mcp__<server>__<tool>`（本 POC 未实测，见调研文档） | 用直接 server map `.mcp.json`；skill 不硬编码完整工具名 |
| **marketplace** | `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json`（顶层 `{name, interface, plugins[]}`） | 各维护一份 |
| **commands** | `commands/*.md` slash 命令 | ❌ 无同构用户入口 | 新能力优先做 skill；command 只作 Claude 薄入口 |
| **插件根变量** | `${CLAUDE_PLUGIN_ROOT}` | hook 命令内**疑不解析**（实测 marker 未写成） | hook 里勿依赖该变量；待确认 |

**一句话**：Codex 稳吃 **skills**（+ MCP + apps）；**hooks** 机制在但实效待定；**命名 agent 不支持**，降级内联。

---

## 2. 移植步骤（可操作 checklist）

对每个要移植的插件 `plugins/<name>/`：

- [ ] **1. 加 Codex manifest** `plugins/<name>/.codex-plugin/plugin.json`（模板见 §3.1）。
      注意：Claude 的 `skills` 常写数组 `["./skills/xxx"]`，**Codex 用目录** `"skills": "./skills/"`。
- [ ] **2. 每个 skill 加元数据** `plugins/<name>/skills/<skill>/agents/openai.yaml`（模板见 §3.2）。这是 Codex 原生发现 skill 的载体。
- [ ] **3. 中性化 SKILL.md**：把 `AskUserQuestion`/`Agent` 等 Claude 工具名改成「动作描述」；命名 agent 调用改成「支持子 agent 则派发，否则内联执行其规范」。`allowed-tools` frontmatter **保留**（Codex 忽略未知字段，零风险）。
- [ ] **4. 仓库级 Codex marketplace** `.agents/plugins/marketplace.json`（模板见 §3.3，首次建立，之后每插件加一条）。
- [ ] **5. hooks（若插件有）**：manifest 加 `"hooks": "./hooks/hooks.json"`。⚠️ 见 §5「hook 实效待定」——Claude 侧保持不变即可，Codex 侧实效需交互会话验证。
- [ ] **6. 装载验证**（本地命令，不依赖服务）：`codex plugin marketplace add` → `codex plugin add` → `codex plugin list` 应为 `installed, enabled`。
- [ ] **7. 真机验证**（`codex exec`，见 §4）：skill 触发、agent 内联降级、hook（若适用）。

---

## 3. 关键文件模板

### 3.1 `.codex-plugin/plugin.json`
```json
{
  "name": "<plugin-name>",
  "version": "0.1.0",
  "description": "<一句话>",
  "author": { "name": "wangx" },
  "keywords": ["..."],
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "interface": {
    "displayName": "<展示名>",
    "shortDescription": "<短描述>",
    "longDescription": "<长描述>",
    "developerName": "wangx",
    "category": "Developer Tools",
    "capabilities": ["Interactive", "Read", "Write"],
    "defaultPrompt": ["<默认提示1>", "<默认提示2>"]
  }
}
```
> 无 hooks 的插件删掉 `"hooks"` 行。`interface` 块是 Codex 需要、Claude 不需要的。

### 3.2 `skills/<skill>/agents/openai.yaml`
```yaml
interface:
  display_name: "<Skill 展示名>"
  short_description: "<一句话，Codex 据此发现/呈现该 skill>"
```

### 3.3 `.agents/plugins/marketplace.json`（仓库级）
```json
{
  "name": "wx-cc-plugins",
  "interface": {
    "displayName": "wx-cc-plugins",
    "shortDescription": "wangx 的 Claude Code / Codex 双宿主插件集合"
  },
  "plugins": [
    {
      "name": "<plugin-name>",
      "source": { "source": "local", "path": "./plugins/<plugin-name>" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

---

## 4. codex CLI 命令速查

```bash
# 注册本仓库为本地 marketplace（一次；SOURCE 是含 .agents/plugins/marketplace.json 的仓库根）
codex plugin marketplace add /path/to/wx-cc-plugins
codex plugin marketplace list

# 安装 / 列出 / 卸载插件（改文件后必须 remove+add 重装刷新 cache，同版本号也要）
codex plugin add  <plugin> --marketplace wx-cc-plugins
codex plugin list | grep <plugin>            # 期望 installed, enabled
codex plugin remove <plugin> --marketplace wx-cc-plugins

# 非交互跑（自动化验证 skill/agent/hook 的利器）
codex exec "<prompt>"
codex exec --enable multi_agent "<prompt>"              # 开子 agent 通用 spawn
codex exec --dangerously-bypass-hook-trust "<prompt>"    # 跳过 hook 信任（自动化）
codex exec -c mcp_servers.<name>.enabled=false "<prompt>" # 临时禁用某个 MCP（见 §5）

# feature 开关（确认能力）
codex features list | grep -iE "hook|plugin|multi_agent"
```

---

## 5. 踩坑与排查（血泪，务必先读）

1. **hook 声明了却不触发** —— 两个原因叠加：
   - `plugin_hooks`（自动发现 `hooks.json`）已 `removed`，**必须在 `.codex-plugin/plugin.json` 用 `hooks` 字段声明**（路径或内联）。
   - hooks 需 **hook trust**：自动化加 `--dangerously-bypass-hook-trust`；正式用需交互会话授信任。**没信任时 hook 被静默跳过**（这是本 POC 一度误判「Codex 不支持 hooks」的根因）。
2. **hook 实效待定** —— 即便触发（`hook: X Completed`），`codex exec` 下 hook 的 `systemMessage` 输出与文件副作用**都不可见**；`${CLAUDE_PLUGIN_ROOT}` 疑不解析；hook 疑在受限沙箱运行。所以依赖 hook 输出提醒的功能（如 ai-testings 的软提醒）在 `codex exec` 下无可见效果。交互会话下是否可见未确认（Codex 官方 hook 契约文档为 SPA + 网络受限，未抓到）。
3. **改了插件文件 Codex 没更新** —— Codex 把插件快照到 `~/.codex/plugins/cache/<mkt>/<plugin>/<version>/`。改任何文件后要 **`codex plugin add` 重装**（同版本号也生效刷新）；保险用 `remove` + `add`。
4. **`codex exec` 报 `high demand`** —— 服务端间歇高负载，**重试**即可（非代码问题）。
5. **连不上的 MCP server 拖慢/刷屏** —— 某些配置在 `~/.codex/config.toml` 的 MCP（如内网 Jenkins）会重连 5 次。用 `-c mcp_servers.<name>.enabled=false` 临时禁用。
6. **中性化别过头** —— SKILL.md 只把「宿主专属工具名」换成动作描述；业务逻辑、`${CLAUDE_PLUGIN_ROOT}`（skill 正文里 Codex 有兼容）、`allowed-tools` frontmatter 都保留，避免破坏 Claude 侧行为。
7. **`git push` 偶发 SSL_ERROR** —— 瞬时抖动，重试即通。
8. **别被 openai/plugins 官方仓库的根级 `hooks.json` 误导** —— 那是 `plugin_hooks`（已 removed）的旧机制；当前须走 manifest 声明。

---

## 6. 真机验证怎么做（codex exec）

```bash
# skill 发现
codex exec "只回答：你能用的 skill 里有没有 <plugin>:<skill>？有就说用途。"
# skill 执行
codex exec "触发 <plugin>:<skill>，对当前变更给出结论。"
# 命名 agent 降级（确认内联而非报错找不到 agent）
codex exec "触发 <skill>；若需要 <agent> 能力，内联执行其规范并说明你是内联还是调用了独立子 agent。"
# hook（需 trust bypass）
codex exec --dangerously-bypass-hook-trust "运行一次 shell 命令后结束。"   # 看 hook: X Completed
```

无传统测试套件的插件仓库，「测试通过」= **配置 JSON/YAML 合法 + `codex plugin list` enabled + 上述 codex exec 真机通过**。

---

## 7. 推广到其余插件的适用性评估

| 插件 | 构成 | 难度 | 注意点 |
|---|---|---|---|
| perfect-plugin | 3 纯 skill | 低 | manifest + openai.yaml + 中性化即可 |
| office-plugin | 4 纯 skill | 低 | 注意部分 skill **许可证**限制（可能禁止提取/分发） |
| adp-plugin | 1 skill + 脚本 + 凭证 | 低-中 | 脚本路径/凭证在 Codex 沙箱的可用性需验证 |
| lyy-dev-plugin | 4 skill + MCP | 中 | MCP 双端（本 POC 未实测 MCP，参考调研文档 §3-5） |
| map-plugin | 1 skill + MCP + agents + commands | 中 | 先修已知 bug（mcp path、server key）；command 仅 Claude 入口 |
| code-review | 2 skill + agents + commands | 中-高 | 命名 agent 降级内联 |
| project-analyzer | 1 skill + agents + commands + hooks + 多 agent 调度 | **最高** | 重度依赖命名 agent + hooks，Codex 都要降级；产物路径（`.claude/rules`）需与宿主解耦（Codex 侧输出 `AGENTS.md` 等） |

**通用建议**：先做纯 skill 插件（perfect/office）快速铺开，再处理带 MCP 的，最后啃 project-analyzer 这类重度依赖 hooks/命名 agent 的。

---

## 8. 参考

- 本仓库：`docs/claude-code-codex-plugin-compatibility.md`（前期调研）、`docs/superpowers/`（POC spec/plan/findings）
- OpenAI 官方插件仓库：`https://github.com/openai/plugins`（真实 manifest/openai.yaml/hooks 示例）
- superpowers 多宿主：`https://github.com/obra/superpowers`（`docs/porting-to-a-new-harness.md`）
