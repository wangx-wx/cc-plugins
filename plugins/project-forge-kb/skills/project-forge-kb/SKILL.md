---
name: project-forge-kb
description: 从人工划定的领域范围构建或重建单仓知识库，归档项目及语雀文档，提取领域知识，并通过集中追问生成可审核的 L1 和 ADR 草稿。用于仓库知识库建设，不用于普通文档编辑。
---

# 单仓知识库建设

基于人工确定的领域范围，生成可追溯、可审核的领域知识。确定性脚本负责版本标记、哈希、切块、校验和发布；子代理负责限定范围内的事实调查；主 Agent 负责汇总证据、领域追问、摘要和草稿编写。

## 硬性边界

- `docs/kb/domain-scope.yaml` 归人工所有。`scope-init` 只能在文件不存在时创建空骨架；不得填充、改写、拆分、合并或静默修复正式领域。
- 每轮提取以人工触发时的 Git `HEAD` 为代码基线，记录到 `.meta/L1/<domain_id>.json` 的 `source_commit`。事实调查必须交给限定范围的子代理。
- 不得覆盖 `status` 非 `draft` 的 L1；差异写入 `docs/kb/.review/`。
- 推断不得写成正式术语或规则，必须连同证据保留为候选。代码、归档资料与人工结论冲突时保留各方证据，不自行裁决。
- 无法获得人工解释的问题写入 `docs/kb/.review/<domain_id>/domain-questions.md`，不进入 L1，也不阻塞其余 L1 草稿生成。
- ADR 只记录经人工解释且对未来维护或变更判断有长期价值的设计原因；不得把调查中的问题写成 ADR，也不为 ADR 设置 `status`。
- L1 最终保持 `draft`，只有人工可以改成 `confirmed`。已发布的 archive 不可变，来源变化时创建新目录。
- L0 只包含服务身份、系统边界和机器索引。主 Agent 必须基于仓库级子代理的事实调查起草人工区，并在最终检查时明确提醒用户 review L0。
- 首次生成 `source-state.json` 可以使用尚未提交的建库产物；已有基线后执行增量更新必须要求工作区干净，避免当前工作区内容与 Git `HEAD` 混用。
- `scripts/*.js` 是已封装的执行工具，不得通过读取或搜索脚本源码推断参数、配置或实现。按本 Skill 和 references 中的命令直接运行；用法不明确时执行 `node <skill-dir>/scripts/<name>.js --help`。只有用户明确要求开发或调试 ProjectForgeKB 脚本时才检查源码。

## 选择流程

- 缺少 `docs/kb/domain-scope.yaml` 时，先运行 `node <skill-dir>/scripts/scope-init.js`，再运行 `node <skill-dir>/scripts/yuque-books.js`，向用户列出知识库名称及可填写的 `base_slug`，并依据 [领域范围配置](references/domain-scope.md) 展示字段说明和完整 Demo，然后停止并等待人工填写。不得使用空 `domains` 继续。
- 用户询问 `domain-scope.yaml` 的字段、数组写法或校验规则时，读取 [领域范围配置](references/domain-scope.md)。
- 用户询问可用语雀知识库或不确定 `base_slug` 时，运行 `node <skill-dir>/scripts/yuque-books.js` 并展示返回的 `name` 与 `slug`，不得猜测或改写 slug。
- 文件存在时，运行 `node <skill-dir>/scripts/scope-check.js`。校验失败立即停止；严格使用输出的 `domain_order`，不得重排、增删、推断或合并领域。
- 建设仓库时，完整读取并执行 [领域工作流](references/domain-workflow.md)，一次只处理一个领域。
- 归档文档时，完整读取并执行 [归档工作流](references/archive-workflow.md)。
- 提取 L1 时，读取 [L1 提取规范](references/l1-extraction.md)。准备集中追问或生成 ADR 时，再读取 [领域澄清与 ADR](references/domain-questioning.md)。
- 所有领域完成人工检查点后，按领域工作流规定依次运行 `index.js`、`state.js`、`verify.js`；任一脚本失败即停止。

## 平台契约

使用宿主提供的仓库搜索、分段读取、补丁写入、子代理和 Node.js 执行能力。`<skill-dir>` 是本 `SKILL.md` 所在目录；除命令显式传入 `--repo-root` 外，所有脚本都从目标仓库根目录执行。脚本路径相对于本文件的 `scripts/` 解析，不依赖宿主私有工具名或全局安装路径。

宿主无法派发子代理时，报告当前环境不满足事实调查要求并停止领域提取。脚本报告 MCP 错误时直接停止并报告，不得创建兜底候选或把旧 archive 冒充为当前内容。

## 完成条件

报告当前领域、代码基线、创建或跳过的 archive、生成的 L1/ADR、`.review` 中未解决的问题、需要人工处理的确切事项和下一步。最终报告必须单独列出 `docs/kb/L0-MAP.md`，提醒用户 review“服务身份”和“系统边界”。存在 `pending` 语雀候选、脚本失败、未发布 staging 目录或静默跳过的必需来源时，不得声称完成。
