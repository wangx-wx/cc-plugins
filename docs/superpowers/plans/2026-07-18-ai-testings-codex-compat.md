# ai-testings Codex 双宿主兼容 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 ai-testings 插件用同一套能力核心，在 Claude Code 与 Codex 两个宿主真机跑通（skill 发现/触发、hooks、test-writer 调度）。

**Architecture:** 共享 `skills/` `agents/` `scripts/` 作唯一能力源；为 Codex 增加薄适配层（`.codex-plugin/plugin.json` + 每 skill 的 `agents/openai.yaml` + 仓库级 `.agents/plugins/marketplace.json`），靠 Codex 原生 discovery，不做 bootstrap 注入。

**Tech Stack:** Claude Code 插件规范、Codex 插件规范（`codex` CLI 0.144.5）、JSON/YAML 配置、Node 脚本（现有 hooks）。

## Global Constraints

- `skills/` 是唯一能力源——**禁止**为 Codex 复制 skill 副本。
- Claude Code 侧**零回归**：test-review 仍触发、`hooks/hooks.json` 仍工作。
- manifest `name` 双端一致：`ai-testings`。
- marketplace 顶层 `name` = `wx-cc-plugins`（`codex plugin add` 用它作 `--marketplace`）。
- 仓库根绝对路径：`/Users/wangx/workspace/aaa/vibe-coding/wx-cc-plugins`。
- 不做 bootstrap 注入、不做打包脚本、不碰其余 7 个插件（YAGNI）。
- `${CLAUDE_PLUGIN_ROOT}` 仅在 Task 2 确认 Codex hook 支持后于 hook 命令使用。
- 每个 JSON/YAML 先通过静态校验，再做 `codex exec` 真机验证。
- 无传统单测：本计划用「静态校验（自动）+ `codex exec` 真机行为验证」作为测试等价物。

## File Structure

- Create: `plugins/ai-testings/.codex-plugin/plugin.json` — Codex manifest
- Create: `plugins/ai-testings/skills/test-review/agents/openai.yaml` — Codex skill 发现元数据
- Create: `.agents/plugins/marketplace.json` — Codex marketplace（仓库级）
- Modify: `plugins/ai-testings/skills/test-review/SKILL.md` — 中性化步骤 6 的 AskUserQuestion
- Conditional（Task 4，依 Task 2）: `plugins/ai-testings/hooks.json`（根级）或调整 `plugins/ai-testings/hooks/hooks.json`
- Conditional（Task 5，依 Task 2）: `plugins/ai-testings/agents/openai.yaml` 或 manifest agents 声明
- Modify: `plugins/ai-testings/README.md` — 补 Codex 安装/使用说明

---

### Task 1: Codex manifest + marketplace，插件装上并原生列出 test-review

**Files:**
- Create: `plugins/ai-testings/.codex-plugin/plugin.json`
- Create: `.agents/plugins/marketplace.json`

**Interfaces:**
- Produces: marketplace 名 `wx-cc-plugins`；插件名 `ai-testings`（后续 Task 的 `codex exec`/`codex plugin` 命令依赖）。

- [ ] **Step 1: 写 Codex manifest**

Create `plugins/ai-testings/.codex-plugin/plugin.json`:
```json
{
  "name": "ai-testings",
  "version": "0.1.0",
  "description": "Java 后端测试规范助手：审查变更的测试需求(test-review)、按团队规范生成单测/集成测试(test-writer)。",
  "author": { "name": "wangx" },
  "keywords": ["java", "testing", "junit5", "mybatis-plus", "integration-test"],
  "skills": "./skills/",
  "interface": {
    "displayName": "AI Testings",
    "shortDescription": "Java 测试需求审查与单测生成",
    "longDescription": "审查变更的测试需求并生成符合团队规范的 JUnit5/集成测试。技术栈 MyBatis-Plus + PostgreSQL，JDK8/17 双栈。",
    "developerName": "wangx",
    "category": "Developer Tools",
    "capabilities": ["Interactive", "Read", "Write"],
    "defaultPrompt": ["审查这次变更需要哪些测试", "为改动的 Service 生成单元测试"]
  }
}
```

- [ ] **Step 2: 写 Codex marketplace**

Create `.agents/plugins/marketplace.json`:
```json
{
  "name": "wx-cc-plugins",
  "interface": {
    "displayName": "wx-cc-plugins",
    "shortDescription": "wangx 的 Claude Code / Codex 双宿主插件集合"
  },
  "plugins": [
    {
      "name": "ai-testings",
      "source": { "source": "local", "path": "./plugins/ai-testings" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

- [ ] **Step 3: 静态校验 JSON 合法**

Run:
```bash
python3 -m json.tool plugins/ai-testings/.codex-plugin/plugin.json >/dev/null && echo OK1
python3 -m json.tool .agents/plugins/marketplace.json >/dev/null && echo OK2
```
Expected: `OK1` 和 `OK2` 都打印。

- [ ] **Step 4: 注册本地 marketplace 到 Codex**

Run:
```bash
codex plugin marketplace add /Users/wangx/workspace/aaa/vibe-coding/wx-cc-plugins
codex plugin marketplace list
```
Expected: `marketplace list` 输出含 `wx-cc-plugins`。若报 marketplace 文件未找到，检查 `.agents/plugins/marketplace.json` 路径与 JSON。

- [ ] **Step 5: 安装 ai-testings 插件**

Run:
```bash
codex plugin add ai-testings --marketplace wx-cc-plugins
codex plugin list
```
Expected: `plugin list` 输出含 `ai-testings`。

- [ ] **Step 6: 验证 Codex 原生发现 test-review（核心假设）**

Run:
```bash
cd /Users/wangx/workspace/aaa/vibe-coding/wx-cc-plugins
codex exec "只回答：你现在能用的、名字里含 test 的 skill 有哪些？" 2>&1 | tail -20
```
Expected: 输出提到 `test-review`。这证明 Codex 靠 manifest + `skills/` 原生发现，无需 bootstrap。若未提到，检查 manifest `"skills": "./skills/"` 与 skill 目录结构。

- [ ] **Step 7: Commit**

```bash
git add plugins/ai-testings/.codex-plugin/plugin.json .agents/plugins/marketplace.json
git commit -m "feat(ai-testings): 增加 Codex manifest 与仓库级 Codex marketplace"
```

---

### Task 2: 探测 Codex 的 hooks 与 agent 行为（spec §7 待实测点）

**Files:**
- Create (临时探针，探测后删除): `plugins/ai-testings/hooks/probe.json`、`plugins/ai-testings/hooks.json`、`plugins/ai-testings/scripts/probe-marker.sh`
- Create: `docs/superpowers/plans/ai-testings-codex-probe-findings.md` — 探测结论

**Interfaces:**
- Produces: 5 条探测结论（HOOK_PATH、PRETOOLUSE、PLUGIN_ROOT_VAR、AGENTS_DECL、AGENT_META），Task 4/5 依据它们选分支。

- [ ] **Step 1: 建 marker 探针脚本**

Create `plugins/ai-testings/scripts/probe-marker.sh`:
```bash
#!/usr/bin/env bash
echo "PROBE_HIT event=$1 root=${CLAUDE_PLUGIN_ROOT:-UNSET}" >> /tmp/codex-hook-probe.log
```
Run: `chmod +x plugins/ai-testings/scripts/probe-marker.sh && : > /tmp/codex-hook-probe.log`

- [ ] **Step 2: 探测 hook 路径 —— 先试 Claude 风格 `hooks/hooks.json`**

Create `plugins/ai-testings/hooks/probe.json` 并临时改名验证；实际用现有 `hooks/hooks.json` 是否被 Codex 认。先放一个只含 marker 的根级 `hooks.json`：

Create `plugins/ai-testings/hooks.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "./scripts/probe-marker.sh PostToolUse-rootlevel" } ] }
    ]
  }
}
```
Run（重装插件让改动生效，然后触发一次 Bash）:
```bash
codex plugin add ai-testings --marketplace wx-cc-plugins 2>/dev/null
cd /Users/wangx/workspace/aaa/vibe-coding/wx-cc-plugins
codex exec "运行一次 shell 命令：echo hello" 2>&1 | tail -5
cat /tmp/codex-hook-probe.log
```
Expected: 若根级 `hooks.json` 被认，日志出现 `PROBE_HIT event=PostToolUse-rootlevel`。记录结论 HOOK_PATH=rootlevel 或 not-rootlevel。

- [ ] **Step 3: 探测 `hooks/hooks.json` 是否也被认**

把探针移到 `plugins/ai-testings/hooks/hooks.json`（临时备份现有再覆盖为 marker 版），重复 Step 2 的 `codex exec` + 查日志，记录 HOOK_PATH 是否含 `hooks/hooks.json`。完成后**恢复**原 `hooks/hooks.json`。

- [ ] **Step 4: 探测 PreToolUse 支持**

把探针 matcher 段改为 `"PreToolUse"`（在生效的那个 hook 文件里），marker 参数改 `PreToolUse-probe`，重装 + `codex exec "运行 shell：echo hi"`，查日志是否出现 `PreToolUse-probe`。记录 PRETOOLUSE=supported / unsupported。

- [ ] **Step 5: 探测 `${CLAUDE_PLUGIN_ROOT}` 变量**

把探针命令改为 `node ${CLAUDE_PLUGIN_ROOT}/scripts/probe-node.mjs`（新建 `probe-node.mjs` 内容：`require('fs').appendFileSync('/tmp/codex-hook-probe.log','NODE_ROOT='+(process.env.CLAUDE_PLUGIN_ROOT||'UNSET')+'\n')`）。重装 + 触发，查日志 `root=`/`NODE_ROOT=` 是否为真实路径。记录 PLUGIN_ROOT_VAR=usable / unset。

- [ ] **Step 6: 探测 agents 声明与元数据**

Run:
```bash
cd /Users/wangx/workspace/aaa/vibe-coding/wx-cc-plugins
codex exec "只回答：你能否调用一个叫 test-writer 的子 agent？能就说它的用途。" 2>&1 | tail -15
codex features 2>&1 | grep -i multi
```
记录 AGENTS_DECL（是否需 manifest 声明 agents）、AGENT_META（是否需 openai.yaml）、multi_agent 是否默认开。

- [ ] **Step 7: 记录结论并清理探针**

写 `docs/superpowers/plans/ai-testings-codex-probe-findings.md`，含 5 条结论（HOOK_PATH / PRETOOLUSE / PLUGIN_ROOT_VAR / AGENTS_DECL / AGENT_META 各一行结论 + 证据）。删除临时探针文件（`hooks.json` 若非最终方案则删、`probe-*.sh/mjs`、`hooks/probe.json`），恢复原 `hooks/hooks.json`。

Run:
```bash
git status --short   # 确认只剩 findings 文件与恢复后的原文件
```

- [ ] **Step 8: Commit**

```bash
git add docs/superpowers/plans/ai-testings-codex-probe-findings.md
git commit -m "test(ai-testings): 记录 Codex hooks/agent 行为探测结论"
```

---

### Task 3: 中性化 SKILL.md + openai.yaml，双端触发 test-review

**Files:**
- Modify: `plugins/ai-testings/skills/test-review/SKILL.md`
- Create: `plugins/ai-testings/skills/test-review/agents/openai.yaml`

**Interfaces:**
- Consumes: Task 1 的已装插件。
- Produces: 双端可发现可触发的 test-review。

- [ ] **Step 1: 中性化 SKILL.md 步骤 6**

在 `plugins/ai-testings/skills/test-review/SKILL.md` 中，将现有步骤 6 整段：
```markdown
6. **询问用户**：使用 AskUserQuestion 工具，一次性询问以下两个问题：

   - **是否启动 test-writer 生成测试**：选项「启动」/「仅审查，不生成」
   - **补充注意事项**：让用户输入对测试生成的额外要求，默认无。例如指定测试范围、特殊 mock 需求、只生成不运行等

   如果用户选择「启动」，将审查清单中结论为「补用例」或「新写」的条目，连同用户补充的注意事项，传递给 `test-writer` agent 执行。
```
替换为（描述动作，不点名宿主工具）：
```markdown
6. **询问用户**（采用当前宿主的用户询问方式，一次性提出以下两个问题）：

   - **是否启动 test-writer 生成测试**：选项「启动」/「仅审查，不生成」
   - **补充注意事项**：让用户输入对测试生成的额外要求，默认无。例如指定测试范围、特殊 mock 需求、只生成不运行等

   如果用户选择「启动」，将审查清单中结论为「补用例」或「新写」的条目，连同用户补充的注意事项交给 `test-writer` 执行：宿主支持子 agent 时派发 `test-writer` agent；不支持时在当前会话内按 test-writer 规范内联执行。
```
> frontmatter 的 `allowed-tools: AskUserQuestion` **保留不动**（Codex 忽略未知字段；Claude 继续预授权）。

- [ ] **Step 2: 建 Codex skill 元数据**

Create `plugins/ai-testings/skills/test-review/agents/openai.yaml`:
```yaml
interface:
  display_name: "Test Review"
  short_description: "审查变更的测试需求，输出测试审查清单"
```

- [ ] **Step 3: 静态校验**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('plugins/ai-testings/skills/test-review/agents/openai.yaml')); print('YAML_OK')"
python3 -c "
import re,sys
s=open('plugins/ai-testings/skills/test-review/SKILL.md').read()
assert s.startswith('---'), 'frontmatter 缺失'
assert 'AskUserQuestion 工具' not in s, '仍点名 AskUserQuestion 工具'
print('SKILL_OK')
"
```
Expected: `YAML_OK` 与 `SKILL_OK`。（可选：`find plugins -name quick_validate.py` 定位 skill 校验器，若存在则对 `plugins/ai-testings/skills/test-review` 运行。）

- [ ] **Step 4: Claude Code 侧验证（零回归）**

在 Claude Code 会话中输入：`帮我做一次提交前的 test-review`。
Expected: 触发 test-review，输出含表头 `| 文件 | 分层 | 变更性质 | 建议测试 | 现有测试 | 结论` 的清单，并在步骤 6 用 AskUserQuestion 弹出两个问题。

- [ ] **Step 5: Codex 侧验证**

Run:
```bash
codex plugin add ai-testings --marketplace wx-cc-plugins 2>/dev/null
cd /Users/wangx/workspace/aaa/vibe-coding/wx-cc-plugins
codex exec "对当前 git 变更做 test-review，先只输出审查清单表格，不要生成测试" 2>&1 | tail -30
```
Expected: 输出 test-review 的审查清单表格（分层/变更性质/结论列）。证明中性化后 Codex 侧可触发。

- [ ] **Step 6: Commit**

```bash
git add plugins/ai-testings/skills/test-review/SKILL.md plugins/ai-testings/skills/test-review/agents/openai.yaml
git commit -m "feat(ai-testings): test-review 工具中性化并补 Codex skill 元数据"
```

---

### Task 4: hooks 双端适配（依据 Task 2 结论）

**Files:**
- Modify/Create（依 Task 2 的 HOOK_PATH / PRETOOLUSE / PLUGIN_ROOT_VAR 结论选分支）。

**Interfaces:**
- Consumes: Task 2 findings。

- [ ] **Step 1: 依结论选择分支**

- **分支 A（HOOK_PATH 含 `hooks/hooks.json` 且 PLUGIN_ROOT_VAR=usable 且 PRETOOLUSE=supported）**：Claude 与 Codex **共享现有** `hooks/hooks.json`，无需改动，直接进 Step 2 验证。
- **分支 B（Codex 仅认根级 `hooks.json`，或变量不可用，或 PreToolUse 不支持）**：新增 Codex 专用根级 `hooks.json`（不动 Claude 的 `hooks/hooks.json`）。内容如下，按结论调整：

Create `plugins/ai-testings/hooks.json`（分支 B 用；`§VAR§` 依 PLUGIN_ROOT_VAR：usable→`node ${CLAUDE_PLUGIN_ROOT}/scripts/`，unset→`node ./scripts/`；PreToolUse 不支持则删除 PreToolUse 块）:
```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "§VAR§stop-test-reminder.mjs", "timeout": 15 } ] }
    ],
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "§VAR§pre-commit-test-check.mjs", "timeout": 15 } ] }
    ]
  }
}
```
> 若 PreToolUse 不支持，删除整个 `"PreToolUse"` 块，并在 README 注明 Codex 侧提交关口提醒暂缺（Claude 侧仍有）。

- [ ] **Step 2: 静态校验（若分支 B）**

Run: `python3 -m json.tool plugins/ai-testings/hooks.json >/dev/null && echo HOOK_JSON_OK`

- [ ] **Step 3: Claude Code hook 验证（零回归）**

在 Claude Code 会话触发一次 Bash 命令与一次会话结束。
Expected: `pre-commit-test-check`（PreToolUse:Bash）与 `stop-test-reminder`（Stop）按原行为触发。

- [ ] **Step 4: Codex hook 验证**

Run:
```bash
codex plugin add ai-testings --marketplace wx-cc-plugins 2>/dev/null
cd /Users/wangx/workspace/aaa/vibe-coding/wx-cc-plugins
codex exec "运行 shell 命令 git status，然后结束" 2>&1 | tail -15
```
Expected: 依结论，Stop（及 PreToolUse 若支持）hook 触发，可在 codex exec 输出或脚本 marker 中观察到。

- [ ] **Step 5: Commit**

```bash
git add plugins/ai-testings/hooks.json 2>/dev/null; git add -A plugins/ai-testings/hooks
git commit -m "feat(ai-testings): hooks 双端适配（依 Codex 探测结论）"
```

---

### Task 5: test-writer agent 的 Codex 调度适配（依据 Task 2 结论）

**Files:**
- Conditional（依 AGENTS_DECL / AGENT_META）: `plugins/ai-testings/.codex-plugin/plugin.json`（加 agents 声明）和/或 `plugins/ai-testings/agents/openai.yaml`。

- [ ] **Step 1: 依结论落地 agent 元数据**

- **若 AGENTS_DECL=需声明**：在 `.codex-plugin/plugin.json` 顶层加 `"agents": "./agents/"`（放在 `"skills"` 之后）。
- **若 AGENT_META=需 openai.yaml**：Create `plugins/ai-testings/agents/openai.yaml`:
```yaml
interface:
  display_name: "Test Writer"
  short_description: "按团队规范为 Java 变更生成单测/集成测试并运行验证"
```
- **若两者皆否**：跳过本 Task 的文件改动，仅做 Step 2 验证。

- [ ] **Step 2: Codex 侧多 agent 能力确认**

Run:
```bash
cd /Users/wangx/workspace/aaa/vibe-coding/wx-cc-plugins
codex exec --enable multi_agent "做一次 test-review，若有需要补测的项，就启动 test-writer 为其中一个生成单元测试" 2>&1 | tail -30
```
Expected: test-review 走到步骤 6 后，Codex 派发 test-writer（多 agent 开启时）或在当前会话内联执行 test-writer 规范（降级）。二者之一即通过；**不得**出现伪造的、不存在的工具调用。

- [ ] **Step 3: Commit**

```bash
git add plugins/ai-testings/.codex-plugin/plugin.json plugins/ai-testings/agents/openai.yaml 2>/dev/null
git commit -m "feat(ai-testings): test-writer 的 Codex 调度适配" || echo "无改动，跳过"
```

---

### Task 6: 双端端到端验收 + 文档收尾

**Files:**
- Modify: `plugins/ai-testings/README.md`

- [ ] **Step 1: 跑 spec §1 成功标准（Claude Code）**

在 Claude Code：装/启用插件 → `test-review` 触发输出清单 → 选「启动」走 test-writer → Bash/Stop 时 hook 触发。逐条确认。

- [ ] **Step 2: 跑 spec §1 成功标准（Codex）**

Run:
```bash
cd /Users/wangx/workspace/aaa/vibe-coding/wx-cc-plugins
codex exec --enable multi_agent "对当前变更做完整 test-review 并按结论生成必要测试" 2>&1 | tee /tmp/codex-acceptance.log | tail -40
```
Expected: 发现并触发 test-review → 输出清单 → 调度/内联 test-writer → hook 触发。逐条对照 spec §1 勾选。

- [ ] **Step 3: 写 Codex 使用说明**

在 `plugins/ai-testings/README.md` 末尾追加一节：
```markdown
## 在 Codex 中使用

    # 注册本仓库 marketplace（一次）
    codex plugin marketplace add /path/to/wx-cc-plugins
    # 安装
    codex plugin add ai-testings --marketplace wx-cc-plugins
    # 使用（test-writer 需多 agent）
    codex exec --enable multi_agent "对当前变更做 test-review"

说明：Codex 靠 `.codex-plugin/plugin.json` + `skills/*/agents/openai.yaml` 原生发现 skill。
hooks 行为见 docs/superpowers/plans/ai-testings-codex-probe-findings.md。
```

- [ ] **Step 4: 最终提交**

```bash
git add plugins/ai-testings/README.md
git commit -m "docs(ai-testings): 补 Codex 安装与使用说明，完成双宿主 POC"
```

---

## Self-Review

**Spec coverage（对照 spec 各节）：**
- §5 目录结构 → Task 1（manifest、marketplace）、Task 3（openai.yaml）✓
- §6.1 manifest → Task 1 ✓
- §6.2 skill 中性化 → Task 3 Step 1 ✓
- §6.3 openai.yaml → Task 3 Step 2 ✓
- §6.4 hooks（含待实测）→ Task 2（探测）+ Task 4（落地）✓
- §6.5 test-writer → Task 2 Step 6 + Task 5 ✓
- §6.6 marketplace → Task 1 Step 2 ✓
- §7 五个待实测点 → Task 2 Step 2-6 一一对应 ✓
- §1 成功标准 → Task 6 ✓

**Placeholder scan：** 条件分支（Task 4/5）均给出完整分支内容与选择依据，无 TBD；`§VAR§`/`§...§` 是明确标注的「依结论替换」占位，附替换规则。探针脚本内容完整。

**Type consistency：** marketplace name `wx-cc-plugins`、plugin name `ai-testings` 全计划一致；`codex plugin add ai-testings --marketplace wx-cc-plugins` 与 marketplace.json 的 `name` 字段一致；findings 的 5 个键（HOOK_PATH/PRETOOLUSE/PLUGIN_ROOT_VAR/AGENTS_DECL/AGENT_META）在 Task 2 产出、Task 4/5 消费，命名一致。
