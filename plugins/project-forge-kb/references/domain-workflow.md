# 领域驱动工作流

使用 `scope-check.js` 返回的 `domain_order`。一次只建设一个领域；`docs/kb/domain-scope.yaml` 在整个流程中只读。

## 1. 固定代码基线并调查代码事实

记录人工触发时的 Git `HEAD`。把当前领域的代码扫描派发给一个只读子代理，任务必须包含精确的 include/exclude 范围和 [L1 提取规范](l1-extraction.md) 中的报告要求。主 Agent 不重复扫描同一范围，只负责补充核验子代理报告中影响后续判断的证据。

基于调查结果生成代码版 L1 草稿和 `.meta/L1/<domain_id>.json`。此时只可写入观察事实和推断候选，不得把推断写成正式术语或规则。

## 2. 生成语雀候选

```bash
node <skill-dir>/scripts/yuque-candidates.js --domain <domain_id>
```

脚本使用 `fetch_all: true` 调用 `yuque_search_documents`，按 `document_url` 去重，记录摘要和匹配证据，并写入 `docs/kb/.review/<domain_id>/yuque-candidates.yaml`。脚本重跑必须保留已有的 `approved` 和 `rejected`；脚本和 Agent 都不得替人工修改 `decision`。

存在 `pending` 时，请人工只把 `decision` 改成 `approved` 或 `rejected`，然后停止。标题、关键词命中、排序或直接 URL 都不构成自动批准依据。

## 3. 确认语雀选择

人工处理后运行：

```bash
node <skill-dir>/scripts/yuque-selection.js --domain <domain_id>
```

结果为 `awaiting_confirmation` 时报告候选文件路径并再次停止。只有结果为 `confirmed` 时才继续，且只能获取和归档 `approved` 文档。

## 4. 归档已批准来源

完整执行 [归档工作流](archive-workflow.md)。准备当前领域的全部 `project_docs` 和已批准语雀文档，由主 Agent 完成摘要，再发布不可变 archive。脚本负责获取、来源版本、切块、校验和发布；主 Agent 负责摘要。

## 5. 调查归档事实并补全候选

把已发布 archive 的事实调查派发给只读子代理，明确当前领域、代码基线和 archive 路径。子代理先读摘要，按需读取 chunk，并报告对已有术语、规则、边界和设计候选的支持、补充或冲突。

主 Agent 综合两次子代理调查，更新 L1 草稿的非争议部分和 `.meta` 证据；冲突与推断仍不得升级为正式知识。

## 6. 集中澄清领域知识

完整读取并执行 [领域澄清与 ADR](domain-questioning.md)。先完成事实调查和设计树，再一次提出当前 frontier 中所有必须由人工判断的问题。不要设置固定的代码后追问和归档后追问两个检查点。

用户回答后重新计算 frontier。只有确实影响领域知识正确性或重要设计原因的问题才进入下一轮；可以从环境查明的事实继续交给子代理调查，不得询问用户。

## 7. 确认后写入 L1、ADR 和未解决问题

frontier 收敛或剩余问题已明确无法回答后，集中展示拟写入的 L1、ADR 和 `.review` 内容并取得一次明确的领域确认。确认后，将概念含义写入“术语”，约束写入“已确认规则与不变量”，具有长期维护价值的设计原因使用 `assets/ADR.md` 写入 `docs/kb/adr/<domain_id>/`；跨领域 ADR 写入 `docs/kb/adr/shared/`。L1 的“设计与决策”只保留摘要和相对链接。

无法获得人工解释的问题使用 `assets/domain-questions.md` 写入 `docs/kb/.review/<domain_id>/domain-questions.md`。它们不进入 L1，也不阻塞其他知识生成。

写入后报告 L1、ADR 和 `.review` 路径，不再增加重复审核检查点；但 Agent 仍不得把 L1 的 `status` 改成 `confirmed`。随后进入 `domain_order` 的下一个领域。

## 8. 完成仓库

全部领域通过检查点后，先把仓库级事实调查派发给一个只读子代理。子代理基于 `domain-scope.yaml`、全部 L1、ADR、构建文件和项目入口，报告项目的服务身份、负责与不负责的系统边界及证据；不得修改文件，也不得补充无法从证据支持的职责。

主 Agent 使用 `assets/L0-MAP.md` 创建或更新 `docs/kb/L0-MAP.md` 的人工区。只写“服务身份”和“系统边界”，不得增加“外部协作”或“知识路由”。已有 L0 时保留人工已确认内容；发现差异时在最终检查中提出，不静默覆盖。

L0 人工区完成后，依次运行：

```bash
node <skill-dir>/scripts/index.js
node <skill-dir>/scripts/state.js
node <skill-dir>/scripts/verify.js
```

`index.js` 只替换 `L0-MAP.md` 标记内的机器区；`state.js` 写入初始增量基线，不判断变化；`verify.js` 输出结构化 JSON，存在错误时以状态码 1 退出。最后报告错误、警告和一次仓库检查清单，然后等待人工最终检查。

首次生成 `source-state.json` 时允许建库产物尚未提交；如果已有 `source-state.json`，再次执行 `state.js` 代表增量更新，工作区必须干净。检查包含未提交、未跟踪和冲突文件，发现任一项即停止。

最终检查必须单独列出 `docs/kb/L0-MAP.md`，明确提醒用户 review“服务身份”和“系统边界”。用户完成该 review 前，不得声称知识库建设完成。
