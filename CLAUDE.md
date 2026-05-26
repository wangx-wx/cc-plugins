# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

cc-plugins 是一个 Claude Code 插件平台，支持通过 agents、skills、commands 和 MCP servers 扩展 Claude 的能力。项目不包含传统构建系统（无 package.json、tsconfig 等），所有内容以 Markdown 文档 + JSON 配置 + Python 脚本为核心。

## 架构

### 插件注册体系

```
/.claude-plugin/marketplace.json    ← 顶层插件注册表，列出所有插件
/plugins/{plugin-name}/
  ├── .claude-plugin/plugin.json    ← 插件元数据、agents/skills/commands 声明
  ├── .mcp.json                     ← MCP 服务器连接配置
  ├── agents/                       ← Agent 定义（Markdown + YAML frontmatter）
  ├── skills/                       ← Skill 包（SKILL.md + scripts/ + references/）
  └── commands/                     ← 简单命令（Markdown）
```

### 当前插件

- **lyy-dev-plugin**：开发工具集，包含 code-reviewer agent、skill-creator skill、mcp-builder skill，集成 chrome-devtools MCP
- **map-plugin**：地图天气服务，包含 java-dependency-decompiler agent、amap-maps-weather skill，集成 amap-server MCP

### Skill 三层加载机制（Progressive Disclosure）

1. **Level 1 - 元数据**：SKILL.md frontmatter（name + description），始终加载
2. **Level 2 - 指令体**：SKILL.md body，skill 触发时加载（< 5k words）
3. **Level 3 - 捆绑资源**：scripts/、references/、assets/，按需加载

### Skill 目录结构

```
skill-name/
├── SKILL.md          ← 必需：YAML frontmatter + Markdown 指令
├── scripts/          ← 可选：可执行脚本（Python/Bash）
├── references/       ← 可选：按需加载的参考文档
└── assets/           ← 可选：输出用的模板/资源文件
```

## 常用命令

### Skill 工具链

```bash
# 初始化新 skill
python plugins/lyy-dev-plugin/skills/skill-creator/scripts/init_skill.py <skill-name> --path <output-dir>

# 验证 SKILL.md 格式
python plugins/lyy-dev-plugin/skills/skill-creator/scripts/quick_validate.py <path/to/skill-folder>

# 打包 skill 为 .skill 分发文件（zip 格式）
python plugins/lyy-dev-plugin/skills/skill-creator/scripts/package_skill.py <path/to/skill-folder> [output-dir]
```

### MCP 评估

```bash
# 安装评估依赖
pip install -r plugins/lyy-dev-plugin/skills/mcp-builder/scripts/requirements.txt

# 运行 MCP 服务器评估
python plugins/lyy-dev-plugin/skills/mcp-builder/scripts/evaluation.py
```

## 关键约定

### SKILL.md Frontmatter 规范

- `name`：必需，hyphen-case，仅小写字母/数字/连字符，最长 64 字符，不能以连字符开头或结尾
- `description`：必需，最长 1024 字符，禁止使用尖括号 `< >`
- 可选字段：`license`、`allowed-tools`、`metadata`
- 不允许有未定义的属性

### Agent 定义格式

Markdown 文件 + YAML frontmatter，frontmatter 包含 name/model/role 等元数据，body 定义行为指令和输出格式。

### MCP 工具命名

- snake_case 格式：`{service}_{action}_{resource}`
- 必须包含服务前缀避免冲突

### 插件注册

新增插件需同时更新：
1. `plugins/{name}/.claude-plugin/plugin.json` - 插件配置
2. `plugins/{name}/.mcp.json` - MCP 服务器配置（如有）
3. `.claude-plugin/marketplace.json` - 顶层注册表

## 忽略目录

- `temp/` - 临时文件，已在 .gitignore 中排除，不要读取或修改