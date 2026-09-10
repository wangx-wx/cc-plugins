---
name: project-forge-kb
description: 从人工划定的领域范围构建或增量更新单仓领域知识库，归档项目及语雀文档，通过事实调查和追问生成可审核的 L1 与 ADR。用于仓库知识库建设，不用于普通文档编辑。
---

# 单仓知识库建设

基于人工确定的领域范围，生成可追溯、可审核、可增量更新的领域知识。脚本负责判断当前阶段并推进流程；子代理负责限定范围内的事实调查；主 Agent 负责汇总证据、领域追问和知识编写。

## 硬性边界

- `docs/kb/domain-scope.yaml` 归人工所有。`scope-init` 只能在文件不存在时创建空骨架；不得填充、改写、拆分、合并或静默修复正式领域。
- 每轮提取以人工触发时的代码版本为基线。事实调查必须交给限定范围的子代理。
- 不得覆盖 `status` 非 `draft` 的 L1；差异写入 `docs/kb/.review/`。
- 推断不得写成正式术语或规则，必须连同证据保留为候选。代码、归档资料与人工结论冲突时保留各方证据，不自行裁决。
- 无法获得人工解释的问题写入 `docs/kb/.review/<domain_id>/domain-questions.md`，不进入 L1，也不阻塞其余 L1 草稿生成。
- ADR 只记录经人工解释且对未来维护或变更判断有长期价值的设计原因；不得把调查中的问题写成 ADR，也不为 ADR 设置 `status`。
- L1 最终保持 `draft`，只有人工可以改成 `confirmed`。归档由脚本维护，来源变化时保留历史并生成新快照。
- L0 只包含服务身份、系统边界和机器索引。主 Agent 必须基于仓库级子代理的事实调查起草人工区，并在最终检查时明确提醒用户 review L0。
- 首次生成知识库状态可以使用建库产物；已有基线后执行增量更新要求工作区干净，避免当前工作区内容与版本基线混用。
- `scripts/*.js` 是已封装的执行工具，不要通过读取或搜索脚本源码推断流程。按本 Skill 和 references 中的命令直接运行；用法不明确时执行 `node <skill-dir>/scripts/<name>.js --help`。只有用户明确要求开发或调试 ProjectForgeKB 脚本时才检查源码。

## 选择流程

- 缺少 `docs/kb/domain-scope.yaml` 时，先运行 `node <skill-dir>/scripts/scope-init.js`，再运行 `node <skill-dir>/scripts/yuque-books.js`，向用户列出知识库名称及可填写的 `base_slug`，并依据 [领域范围配置](references/domain-scope.md) 展示字段说明和完整 Demo，然后停止并等待人工填写。不得使用空 `domains` 继续。
- 用户询问 `domain-scope.yaml` 的字段、数组写法或校验规则时，读取 [领域范围配置](references/domain-scope.md)。
- 用户询问可用语雀知识库或不确定 `base_slug` 时，运行 `node <skill-dir>/scripts/yuque-books.js` 并展示返回的 `name` 与 `slug`，不得猜测或改写 slug。
- 文件存在时，运行 `node <skill-dir>/scripts/scope-check.js`。校验失败立即停止；严格使用输出的 `domain_order`，不得重排、增删、推断或合并领域。
- 范围校验成功后先运行 `node <skill-dir>/scripts/workflow.js --start` 创建本轮运行，再运行 `node <skill-dir>/scripts/workflow.js` 获取下一步。已有增量基线时，启动脚本会先要求工作区干净并只选出受影响领域。
- 每完成一个 Agent 阶段或脚本动作，按 [领域工作流](references/domain-workflow.md) 登记完成，再重新运行 `workflow.js`。不得跳过状态脚本给出的 `next_action`。
- 建设仓库时，完整读取并执行 [领域工作流](references/domain-workflow.md)，一次只处理一个领域。
- 归档文档时，完整读取并执行 [归档工作流](references/archive-workflow.md)；正常流程按领域调用一次归档入口。
- 提取 L1 时，读取 [L1 提取规范](references/l1-extraction.md)。准备集中追问或生成 ADR 时，再读取 [领域澄清与 ADR](references/domain-questioning.md)。
- 所有领域完成人工检查点后，按领域工作流规定依次运行 `index.js`、`state.js`、`verify.js`；任一脚本失败即停止。

## 平台契约

使用宿主提供的仓库搜索、分段读取、补丁写入、子代理和 Node.js 执行能力。`<skill-dir>` 是本 `SKILL.md` 所在目录；除命令显式传入 `--repo-root` 外，所有脚本都从目标仓库根目录执行。脚本路径相对于本文件的 `scripts/` 解析，不依赖宿主私有工具名或全局安装路径。

宿主无法派发子代理时，报告当前环境不满足事实调查要求并停止领域提取。脚本报告 MCP 错误时直接停止并报告，不得创建兜底候选或把旧 archive 冒充为当前内容。

## 完成条件

报告当前领域、代码基线、创建或跳过的 archive、生成的 L1/ADR、`.review` 中未解决的问题、需要人工处理的确切事项和下一步。最终报告必须单独列出 `docs/kb/L0-MAP.md`，提醒用户 review“服务身份”和“系统边界”。存在 `pending` 语雀候选、脚本失败或未完成的当前领域步骤时，不得声称完成。
