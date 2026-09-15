---
name: project-forge-kb
description: 从人工划定的范围构建或增量更新项目知识库：扫描代码与归档资料，经人工访谈生成可审核的 L1 业务模块知识、ADR 和 L0 索引。当用户提到给某个仓库或项目建知识库、生成或更新 docs/kb、业务模块知识、L0/L1 索引、把项目文档或语雀文档归档进知识库，或在代码变更后做知识库增量更新时，都应使用本 Skill，只做普通文档编辑或与知识库无关的代码改动时不要使用。
---

# 项目知识库建设

基于人工确定的业务模块范围，生成可追溯、可审核、可增量更新的项目知识。脚本负责判断当前阶段并推进流程；子代理负责限定范围内的事实调查；主 Agent 负责汇总证据、业务模块追问和知识编写。这里的业务模块是仓库内的业务能力单元，不等同于技术目录，也不代表跨仓库的完整业务领域。

## 硬性边界

- `docs/kb/module-scope.yaml` 归人工所有。`scope-init` 只能在文件不存在时创建空骨架；不得填充、改写、拆分、合并或静默修复正式业务模块范围。
- 每轮提取以人工触发时的代码版本为基线。事实调查必须交给限定范围的子代理。
- 用户可以直接修改 `docs/kb/L1/<module_id>/README.md` 的内容和 `status`。Agent 只能改写 `draft` 和 `candidate`；`confirmed`、`review_required`、`stale`、`retired` 都承载人工判断，Agent 不得覆盖，新发现的差异写入 `docs/kb/.review/<module_id>/l1-changes.md`（模板 `<skill-dir>/assets/review-changes.md`）。
- 代码和归档调查只产生术语候选与 ADR 问题候选。正式术语和 ADR 必须经过 [业务模块建模访谈](references/module-questioning.md)；推断不得写成正式术语或规则。
- 代码、归档资料与人工结论冲突时保留各方证据，不自行裁决。
- 无法获得人工解释的问题写入 `docs/kb/.review/<module_id>/module-questions.md`，不进入 L1，也不阻塞其余 L1 草稿生成。
- ADR 必须满足业务模块建模访谈规定的全部准入条件；不得把调查问题、普通实现事实或 Agent 推测写成 ADR，也不为 ADR 设置 `status`。
- L1 在人工确认前保持 `draft` 或 `candidate`，确认后为 `confirmed`。用户执行 `workflow.js --confirm-module <module_id>` 确认业务模块时，脚本会按该人工确认将 L1 README 的状态更新为 `confirmed`。归档由脚本维护，来源变化时保留历史并生成新快照。状态取值为 `candidate`、`draft`、`confirmed`、`review_required`、`stale`、`retired`；其中 `draft` 和 `candidate` 是 Agent 可改写的未确认状态，其余状态的内容和状态由用户维护。
- archive 是全局共享的不可变来源快照；同一文档关联多个业务模块时只归档一次，每个业务模块分别在自身 README 和机器元数据中引用它。
- 文档路径契约不可自行变更：L1 固定为 `docs/kb/L1/<module_id>/README.md`；ADR 固定为 `docs/kb/L1/<module_id>/adr/<四位编号>-<描述>.md`，不得把 ADR 放在 L1 根目录，也不得用 `ADR-0001-...` 代替文件名前缀。ADR frontmatter 的正式标识为 `doc_id: ADR-<module_id>-<编号>`。
- L0 只包含服务身份和机器生成的业务模块知识索引。主 Agent 必须基于仓库级子代理的事实调查起草服务身份，并在最终检查时明确提醒用户 review L0。
- 首次生成知识库状态可以使用建库产物；已有基线后执行增量更新要求工作区干净，避免当前工作区内容与版本基线混用。
- `scripts/*.js` 是已封装的执行工具，不要通过读取或搜索脚本源码推断流程。按本 Skill 和 references 中的命令直接运行；用法不明确时执行 `node <skill-dir>/scripts/<name>.js --help`。只有用户明确要求开发或调试 ProjectForgeKB 脚本时才检查源码。

## 选择流程

- 缺少 `docs/kb/module-scope.yaml` 时，先运行 `node <skill-dir>/scripts/scope-init.js`，再运行 `node <skill-dir>/scripts/yuque-books.js`，向用户列出知识库名称及可填写的 `base_slug`，并依据 [业务模块范围配置](references/module-scope.md) 展示字段说明和完整 Demo，然后停止并等待人工填写。不得使用空 `modules` 继续。
- 用户询问 `module-scope.yaml` 的字段、数组写法或校验规则时，读取 [业务模块范围配置](references/module-scope.md)。
- 用户询问可用语雀知识库或不确定 `base_slug` 时，运行 `node <skill-dir>/scripts/yuque-books.js` 并展示返回的 `name` 与 `slug`，不得猜测或改写 slug。
- 文件存在时，运行 `node <skill-dir>/scripts/scope-check.js`。校验失败立即停止；严格使用输出的 `module_order`，不得重排、增删、推断或合并业务模块。
- 范围校验成功后先运行 `node <skill-dir>/scripts/workflow.js --start` 创建本轮运行，再运行 `node <skill-dir>/scripts/workflow.js` 获取下一步。已有增量基线时，启动脚本会先要求工作区干净并只选出受影响业务模块。
- 每完成一个 Agent 阶段或脚本动作，按 [业务模块工作流](references/module-workflow.md) 登记完成，再重新运行 `workflow.js`。不得跳过状态脚本给出的 `next_action`。
- `workflow.js --confirm-module` 是业务模块级结构检查点；如果报告 ADR 路径、文件名或 `doc_id` 错误，先修正文档和 L1 链接，不得绕过确认继续下一个业务模块。
- 建设仓库时，完整读取并执行 [业务模块工作流](references/module-workflow.md)，一次只处理一个业务模块。
- 归档文档时，完整读取并执行 [归档工作流](references/archive-workflow.md)；正常流程按业务模块调用一次归档入口。
- 提取 L1 时，读取 [L1 提取规范](references/l1-extraction.md)。进入持续业务模块访谈时，再完整读取 [业务模块建模访谈](references/module-questioning.md)。
- 所有业务模块完成人工检查点后，按业务模块工作流规定依次运行 `workflow.js --complete-step l0-review`、`index.js`、`state.js`、`verify.js`、`workflow.js --complete-run`；任一脚本失败即停止。

## 平台契约

使用宿主提供的仓库搜索、分段读取、补丁写入、子代理和 Node.js 执行能力。`<skill-dir>` 是本 `SKILL.md` 所在目录，`assets/` 与 `references/` 中的模板和文档都相对它解析；除命令显式传入 `--repo-root` 外，所有脚本都从目标仓库根目录执行。脚本路径相对于本文件的 `scripts/` 解析，不依赖宿主私有工具名或全局安装路径。

宿主无法派发子代理时，报告当前环境不满足事实调查要求并停止业务模块提取。脚本报告 MCP 错误时直接停止并报告，不得创建兜底候选或把旧 archive 冒充为当前内容。

## 完成条件

报告当前业务模块、代码基线、创建或跳过的 archive、生成的 L1/ADR、`.review` 中未解决的问题、需要人工处理的确切事项和下一步。最终报告必须单独列出 `docs/kb/L0.md`，提醒用户 review“服务身份”。存在 `pending` 语雀候选、脚本失败、未替换的模板占位符或未完成的当前业务模块步骤时，不得声称完成。
