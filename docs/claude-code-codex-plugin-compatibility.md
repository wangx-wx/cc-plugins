# Claude Code 与 Codex 插件兼容性调研

> 调研日期：2026-07-17
>
> 目标：让同一个插件仓库同时支持 Claude Code 与 Codex，并尽可能共享 Skills、MCP、Hooks、脚本和参考资料。

## 1. 核心结论

推荐采用：

```text
共享能力核心
+ Claude Code 薄适配层
+ Codex 薄适配层
+ 每个市场独立验证与发布
```

可以共享：

- `skills/<skill-name>/SKILL.md`
- `scripts/`
- `references/`
- `assets/`
- 使用直接 server map 的 `.mcp.json`
- 满足两端共同事件和输入输出协议的 Hook 脚本

通常需要分别维护：

- `.claude-plugin/plugin.json`
- `.codex-plugin/plugin.json`
- 宿主工具名映射
- Claude Code 的 `allowed-tools`
- Codex 的 MCP 工具审批策略
- 依赖特定生命周期或返回协议的 Hook 配置
- 正式发布时的 marketplace 元数据和发布制品

不要以“同一份 manifest 被两个产品原样读取”为目标。更合理的目标是：同一个插件目录、同一套能力实现、两个很薄的宿主入口。

## 2. 兼容性矩阵

| 能力 | Claude Code | Codex | 建议 |
|---|---|---|---|
| 插件 manifest | `.claude-plugin/plugin.json` | `.codex-plugin/plugin.json` | 分别维护 |
| Marketplace | `.claude-plugin/marketplace.json` | `.agents/plugins/marketplace.json` | 开发期可使用兼容入口，正式发布建议分别维护 |
| Skills | `skills/*/SKILL.md` | `skills/*/SKILL.md` | 作为主要共享层 |
| MCP 配置 | 根目录 `.mcp.json`，推荐直接 server map | `.mcp.json` 支持直接 server map 或 `mcp_servers` 包装 | 优先共享直接 server map |
| MCP 完整工具名 | 自动加入 `plugin_<plugin>_` namespace | 通常为 `mcp__<server>__<tool>` | 不在共享 Skill 中硬编码宿主完整名 |
| 工具权限 | `allowed-tools` | 插件级 MCP server/tool 审批配置 | 分别适配 |
| Hooks | 默认 `hooks/hooks.json` | 默认 `hooks/hooks.json`，也可在 manifest 中指定 | 脚本可共享，事件行为需验证 |
| 插件根变量 | `${CLAUDE_PLUGIN_ROOT}` | `PLUGIN_ROOT`，并提供 `CLAUDE_PLUGIN_ROOT` 兼容变量 | 现有 Claude 脚本有机会直接复用 |
| Commands | `commands/*.md` | 无完全同构的用户入口 | 新能力优先做 Skill，Command 只做 Claude 薄入口 |
| Agents | `agents/*.md` | 不使用同一套 Agent 注册格式 | 共享 prompt template，调度分别适配 |
| LSP | 支持 `.lsp.json` | 当前插件规范无完全同构入口 | 暂按 Claude 专属处理 |
| Apps/Connectors | 无完全同构格式 | 支持 `.app.json` | Codex 专属适配 |

## 3. MCP 完整工具名差异

假设：

```text
plugin name = map-plugin
server name = amap-server
tool name   = maps_weather
```

### 3.1 Claude Code

Claude Code 插件提供的 MCP 工具会自动增加插件 namespace：

```text
mcp__plugin_<plugin-name>_<server-name>__<tool-name>
```

对应示例：

```text
mcp__plugin_map-plugin_amap-server__maps_weather
```

Claude 官方 plugin-dev 文档也使用该格式：

```text
mcp__plugin_asana_asana__asana_create_task
```

### 3.2 Codex

Codex 官方插件中的 MCP 工具通常以以下形式暴露：

```text
mcp__<server-namespace>__<tool-name>
```

对应示例：

```text
mcp__amap-server__maps_weather
```

OpenAI 官方 `ios-debugger-agent` Skill 使用的实际名称包括：

```text
mcp__XcodeBuildMCP__list_sims
mcp__XcodeBuildMCP__build_run_sim
mcp__XcodeBuildMCP__describe_ui
```

最终 namespace 应以当前会话实际暴露的工具列表为准，不能仅根据配置 key 猜测大小写或规范化结果。

### 3.3 共享 Skill 的推荐写法

不要在共享 Skill 正文中固定某个宿主生成的完整名。共享契约应稳定在以下层级：

```markdown
## MCP 依赖

- 逻辑服务：高德地图 MCP
- 需要的原始工具：
  - `maps_weather`
  - `maps_geo`
  - `maps_text_search`

从当前宿主实际暴露的工具中解析完整工具名。
找不到对应服务或工具时，报告 MCP 依赖未安装或未启用；不要猜测工具名。
```

不建议为了字面一致，把 Codex server key 人工命名成 `plugin_map-plugin_amap-server`。这会让 Codex 配置耦合到 Claude Code 的命名规则，并在插件改名时产生大范围变更。

## 4. MCP 配置文件可以共享

Claude Code 官方推荐的 `.mcp.json` 是直接 server map：

```json
{
  "amap-server": {
    "type": "http",
    "url": "https://mcp.amap.com/mcp?key=${AMAP_KEY}"
  }
}
```

Codex 当前在线文档明确说明，插件 `.mcp.json` 支持：

1. 直接 server map；
2. 使用 `mcp_servers` 包装的 server map。

因此双端兼容时，优先采用直接 server map：

```text
plugins/map-plugin/
├── .claude-plugin/plugin.json
├── .codex-plugin/plugin.json
├── .mcp.json
└── skills/
```

Codex manifest 可以显式声明：

```json
{
  "mcpServers": "./.mcp.json"
}
```

Claude Code 可以通过根目录约定发现 `.mcp.json`，也可以在 Claude manifest 中显式引用。

只有以下情况才建议维护两份 MCP 配置：

- 两端必须使用不同 server key；
- 认证方式不同；
- transport 不同；
- 某个宿主不支持目标配置字段；
- 需要完全不同的启动命令或环境变量。

## 5. MCP 工具权限差异

### 5.1 Claude Code

Claude Code 可以在 Skill、Command 或 Agent frontmatter 中预授权完整工具名：

```yaml
allowed-tools:
  - mcp__plugin_map-plugin_amap-server__maps_weather
  - mcp__plugin_map-plugin_amap-server__maps_geo
```

### 5.2 Codex

Codex 不使用 Claude Code 的 `allowed-tools` 作为原生插件权限模型。Codex 在线文档提供插件级 MCP server/tool 策略：

```toml
[plugins."map-plugin".mcp_servers."amap-server"]
enabled = true
default_tools_approval_mode = "prompt"
enabled_tools = ["maps_weather", "maps_geo"]

[plugins."map-plugin".mcp_servers."amap-server".tools.maps_weather]
approval_mode = "approve"
```

两端对应关系：

| Claude Code | Codex |
|---|---|
| `allowed-tools` | `plugins.<plugin>.mcp_servers.<server>` |
| 使用完整 `mcp__plugin_...` 名 | 使用原始工具名，例如 `maps_weather` |
| 权限随 Skill/Command 描述 | 权限由 Codex 配置和用户信任控制 |

### 5.3 推荐方案

可移植性优先时：

- 共享 Skill 不写 `allowed-tools`；
- Skill 只描述逻辑服务和原始工具名；
- Claude Code 和 Codex 分别控制权限；
- Codex Skill 可通过 `agents/openai.yaml` 声明 MCP 依赖。

如果 Claude Code 必须获得精确预授权体验，则保留一个 Claude 专属薄入口，并把业务流程放在共享 reference 中。

## 6. Hooks 兼容性

Codex 当前在线文档明确说明：

- 默认插件 Hook 文件为 `hooks/hooks.json`；
- manifest 的 `hooks` 可以是路径、路径数组、内联对象或内联对象数组；
- manifest 中显式定义 `hooks` 后，会覆盖默认 `hooks/hooks.json` 的发现；
- 插件 Hook 安装后不会自动获得信任，需要用户审查；
- Hook 命令会收到 `PLUGIN_ROOT` 和 `PLUGIN_DATA`；
- Codex 同时设置 `CLAUDE_PLUGIN_ROOT` 和 `CLAUDE_PLUGIN_DATA`，用于兼容现有 Claude 插件 Hook。

因此以下 Claude 风格命令有机会直接在 Codex 中运行：

```json
{
  "command": "node ${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs"
}
```

但仍需验证：

- 目标事件是否在两个宿主中都存在；
- stdin 输入 JSON 是否一致；
- stdout 返回字段是否一致；
- matcher 语义是否一致；
- 超时、异步和错误退出行为是否一致；
- Codex Hook 信任提示是否符合预期。

### Superpowers 的处理方式

Superpowers 的 Codex manifest 显式声明：

```json
{
  "hooks": {}
}
```

这样做不是因为 Codex 不支持 Hook，而是为了阻止 Codex 自动加载 Claude Code 的 `SessionStart` Hook。Superpowers 在 Codex 中使用原生 Skill discovery，不需要再次注入 Claude bootstrap。

结论：共享 Hook 脚本是可行的，但是否共享 Hook 配置应按事件逐项决定。

## 7. Marketplace 差异

### 7.1 Claude Code

仓库级 marketplace：

```text
.claude-plugin/marketplace.json
```

常见插件入口：

```json
{
  "name": "map-plugin",
  "source": "./plugins/map-plugin",
  "strict": true
}
```

### 7.2 Codex

Codex 推荐的 repo marketplace：

```text
.agents/plugins/marketplace.json
```

典型入口：

```json
{
  "name": "map-plugin",
  "source": {
    "source": "local",
    "path": "./plugins/map-plugin"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Developer Tools"
}
```

Codex 在线文档还支持：

- GitHub shorthand 和 Git URL marketplace；
- `git-subdir` 插件来源；
- `ref` 或 `sha` 锁定；
- npm registry 插件来源；
- personal marketplace；
- 插件顺序、安装策略、认证策略和分类。

### 7.3 Legacy 兼容入口

Codex 在线文档明确说明，ChatGPT desktop app 可以读取：

```text
$REPO_ROOT/.agents/plugins/marketplace.json
$REPO_ROOT/.claude-plugin/marketplace.json
~/.agents/plugins/marketplace.json
```

其中 `.claude-plugin/marketplace.json` 是 legacy-compatible marketplace。

因此：

- 快速开发验证时，可以先尝试复用现有 Claude marketplace；
- 需要完整 Codex policy、category、Git/npm source 和展示控制时，应增加 `.agents/plugins/marketplace.json`；
- 不应默认认为 Codex CLI 的所有 marketplace 操作都与 legacy 文件完全等价，CLI 和桌面端都要实测。

## 8. Commands、Agents 与 Skills

### Skills

Skills 是当前最稳定的共享扩展点：

```text
skills/<skill-name>/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

共享 Skill 应尽量描述动作和结果，而不是直接写宿主工具名。

### Commands

Claude Code 支持 `commands/*.md` 和 slash command 语义。Codex 没有完全同构的插件入口。

建议：

- 新能力首先实现为 Skill；
- Claude Command 只作为调用共享 Skill 的薄入口；
- 不把业务流程长期维护在 Command 中。

### Agents

Claude Code 的 `agents/*.md` 不是 Codex 可直接复用的 Agent 注册格式。

建议：

- 把角色、检查清单和输出格式放在共享 prompt template 中；
- Claude Code 可将 template 注册为 Agent；
- Codex 可通过原生多 Agent 能力或普通 Skill 调度同一个 template；
- 缺少多 Agent 能力时，应降级为当前 Agent 顺序执行，而不是伪造不存在的工具调用。

## 9. Superpowers 的高级多宿主设计

截至本次调研，`obra/superpowers` 在线主分支版本为 `v6.1.1`，仓库同时包含：

```text
.agents/plugins/
.claude-plugin/
.codex-plugin/
.cursor-plugin/
.kimi-plugin/
.opencode/
.pi/
gemini-extension.json
skills/
hooks/
scripts/
tests/
```

其跨宿主设计原则是：

1. `skills/` 是唯一能力源码；
2. Skill 描述动作，不描述具体宿主工具；
3. 每个宿主有独立 tool mapping；
4. 每个宿主有独立 bootstrap 或 discovery 机制；
5. 所有内容通过宿主自己的安装机制分发；
6. 不修改用户的全局配置来“模拟安装”；
7. 每个宿主有独立测试和真实会话 acceptance test；
8. 正式发布物按宿主裁剪，而不是把整个源码仓库原样打包。

Superpowers 的 Codex 发布脚本会：

- 生成 rootless zip/tar.gz；
- 只打包 `.codex-plugin/`、`skills/`、assets、README 和许可证；
- 排除 Claude Hooks、其他宿主 manifest、tests 和 docs；
- 为每个 Skill 补充 `agents/openai.yaml`；
- 归一化时间戳和归档元数据；
- 校验没有混入源码专用目录；
- 输出 SHA-256。

对当前仓库而言，第一阶段无需复制完整流水线。应先完成一个双端 POC，再根据重复内容决定是否引入生成和分市场制品。

## 10. 推荐目录结构

```text
wx-cc-plugins/
├── .claude-plugin/
│   └── marketplace.json
├── .agents/
│   └── plugins/
│       └── marketplace.json        # 正式 Codex 分发时添加
└── plugins/
    └── map-plugin/
        ├── .claude-plugin/
        │   └── plugin.json
        ├── .codex-plugin/
        │   └── plugin.json
        ├── .mcp.json               # 优先双端共享
        ├── skills/
        │   └── amap-maps-weather/
        │       ├── SKILL.md        # 共享、宿主中立
        │       ├── agents/
        │       │   └── openai.yaml # Codex 元数据
        │       └── references/
        │           ├── claude-tools.md
        │           └── codex-tools.md
        ├── hooks/
        │   └── hooks.json          # 逐事件验证是否共享
        ├── scripts/
        └── assets/
```

## 11. 当前仓库已发现的问题

### map-plugin

目前有三处不一致：

1. Skill 中使用 `amap-service`；
2. `.mcp.json` server key 是 `amap-server`；
3. Claude manifest 引用 `./mcp.json`，实际文件名是 `.mcp.json`。

当前写法：

```text
mcp__amap-service__maps_weather
```

按现有名称推导，两端应分别为：

```text
Claude Code:
mcp__plugin_map-plugin_amap-server__maps_weather

Codex:
mcp__amap-server__maps_weather
```

实际改造前必须先统一 server name，并通过两个宿主的工具列表验证最终名称。

### Claude 专属内容

现有 Skills 中包含：

- `AskUserQuestion`
- `Agent`
- `Read/Grep/Glob/Bash`
- `$ARGUMENTS`
- `${CLAUDE_SKILL_DIR}`
- `${CLAUDE_PLUGIN_ROOT}`

其中 `${CLAUDE_PLUGIN_ROOT}` 在当前 Codex 中有兼容支持，但其他工具名和调用语义仍需映射。

### Project Analyzer

现有流程会生成或修改：

- `.claude/rules/`
- `.claude/settings.json`
- `CLAUDE.md`

跨端时应将规则内容与目标文件分离：

- Claude Code 输出 `.claude/rules/`、`CLAUDE.md`；
- Codex 输出或更新 `AGENTS.md`、项目 `.codex/config.toml` 或 Codex Hooks；
- 不让共享核心直接绑定某一个宿主的配置路径。

### Office 插件许可证

当前 marketplace 将 `office-plugin` 标注为 MIT，但部分 Skill 自带许可证包含禁止提取、衍生和分发的限制。若要公开发布到两个市场，必须先确认授权或替换实现。

## 12. 建议迁移顺序

1. 选择只有 Skill 的简单插件做双 manifest POC；
2. 验证同一个 `SKILL.md` 在 Claude Code 和 Codex 中都能发现和执行；
3. 修复 `map-plugin` 的 MCP path、server key 和完整工具名；
4. 使用一份直接 server-map `.mcp.json` 验证双端 MCP；
5. 验证 `hooks/hooks.json` 的共同事件和返回协议；
6. 将 Commands 改为 Skill 薄入口；
7. 将 named Agents 改为共享 prompt templates；
8. 增加双端验证和版本一致性检查；
9. 最后再引入分市场打包或自动同步流水线。

成功标准：

- 同一个插件目录可被两个产品安装；
- 同一个共享 Skill 能在两个产品中触发；
- 同一个 `.mcp.json` 能成功注册 MCP server；
- MCP 原始工具 schema 一致；
- 宿主完整工具名通过映射解决；
- Claude 专属内容不会被 Codex 错误执行；
- Codex 专属元数据不会影响 Claude Code；
- 两个市场的安装、更新和重新加载流程有独立验证。

## 13. 在线资料

### OpenAI / Codex

- [Codex：Build plugins（当前官方页面）](https://learn.chatgpt.com/docs/build-plugins)
- [Codex：Build plugins](https://developers.openai.com/codex/plugins/build)
- [Codex：Plugin structure](https://developers.openai.com/codex/plugins/build#plugin-structure)
- [Codex：Marketplace metadata](https://developers.openai.com/codex/plugins/build#marketplace-metadata)
- [Codex：Bundled MCP servers and lifecycle hooks](https://developers.openai.com/codex/plugins/build#bundled-mcp-servers-and-lifecycle-hooks)
- [Codex：How the ChatGPT desktop app uses marketplaces](https://developers.openai.com/codex/plugins/build#how-the-chatgpt-desktop-app-uses-marketplaces)
- [OpenAI 官方插件：ios-debugger-agent](https://github.com/openai/plugins/blob/main/plugins/build-ios-apps/skills/ios-debugger-agent/SKILL.md)

`developers.openai.com/codex/plugins/build` 当前会重定向到上述 ChatGPT Learn 官方页面；保留 Developers 链接是为了便于按原有章节锚点定位。

Codex 在线文档明确说明：

- `.codex-plugin/plugin.json` 是必需入口；
- `.mcp.json` 支持直接 server map 或 `mcp_servers` 包装；
- `hooks/hooks.json` 是默认 Hook 路径；
- manifest 的 `hooks` 可以覆盖默认发现；
- Codex 提供 `PLUGIN_ROOT`、`PLUGIN_DATA`，以及 Claude 兼容变量；
- 插件级 MCP server/tool 可以配置启用范围和审批模式；
- ChatGPT desktop app 可以读取 `.agents/plugins/marketplace.json` 和 legacy-compatible `.claude-plugin/marketplace.json`。

### Anthropic / Claude Code

- [Claude 官方插件仓库](https://github.com/anthropics/claude-plugins-official)
- [Claude 官方 MCP Integration Skill](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/plugin-dev/skills/mcp-integration/SKILL.md)
- [Claude Code Plugins 文档](https://code.claude.com/docs/en/plugins)
- [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp)

### Superpowers

- [obra/superpowers](https://github.com/obra/superpowers)
- [Porting Superpowers to a New Harness](https://github.com/obra/superpowers/blob/main/docs/porting-to-a-new-harness.md)
- [Superpowers Codex manifest](https://github.com/obra/superpowers/blob/main/.codex-plugin/plugin.json)
- [Superpowers Codex packaging script](https://github.com/obra/superpowers/blob/main/scripts/package-codex-plugin.sh)

## 14. 信息时效说明

插件格式仍在快速演进。实现时应遵循以下优先级：

1. 当前在线官方文档；
2. 当前产品版本的实际行为；
3. 官方 marketplace 中可运行的插件示例；
4. 本仓库文档和本地脚手架校验器。

如果本地脚手架或校验器与在线官方文档冲突，应先确认目标 Codex/Claude Code 版本，再使用实际安装和新会话测试决定。
