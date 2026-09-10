# 领域驱动工作流

使用本轮 `workflow.js --start` 返回的 `domain_order`，一次只处理一个领域。完成每个阶段后用脚本登记，再运行 `workflow.js` 获取下一步；当前领域未确认前不得进入下一个领域。

## 1. 调查代码事实

把当前领域的代码调查派发给只读子代理，提供人工确认的 include/exclude 范围和 [L1 提取规范](l1-extraction.md)。主 Agent 汇总证据，使用模板生成或更新 `docs/kb/L1/<domain_id>.md` 的代码版草稿；观察和推断不得写成已确认规则。

```bash
node <skill-dir>/scripts/workflow.js --complete-step code-facts --domain <domain_id>
```

脚本会校验 L1 草稿并生成本领域机器元数据。

## 2. 获取并确认语雀候选

当前领域配置了语雀来源时运行：

```bash
node <skill-dir>/scripts/yuque-candidates.js --domain <domain_id>
node <skill-dir>/scripts/workflow.js --complete-step yuque-candidates --domain <domain_id>
```

向用户展示 `docs/kb/.review/<domain_id>/yuque-candidates.yaml` 中的候选，说明只需把每项 `decision` 从 `pending` 改成 `approved` 或 `rejected`。Agent 不代替用户决定，也不修改候选事实字段。

用户修改后运行：

```bash
node <skill-dir>/scripts/yuque-selection.js --domain <domain_id>
```

仍有 `pending` 时停止等待；全部确认后继续。未配置语雀来源时，状态脚本会直接进入归档。

## 3. 归档当前领域资料

完整执行 [归档工作流](archive-workflow.md)。领域级命令会处理全部项目文档和已批准语雀文档，并自动复用未变化来源。

```bash
node <skill-dir>/scripts/workflow.js --complete-step archives --domain <domain_id>
```

## 4. 调查归档事实

把当前领域的归档调查派发给只读子代理。子代理先读相关摘要，按需读取 chunk，报告对领域上下文、术语、规则、边界和设计候选的支持、补充或冲突。主 Agent 综合代码与归档证据；冲突和推断继续作为候选。

```bash
node <skill-dir>/scripts/workflow.js --complete-step archive-facts --domain <domain_id>
```

## 5. 追问并形成领域知识

完整读取 [领域澄清与 ADR](domain-questioning.md)。可从仓库查明的事实继续交给子代理；需要业务判断、术语含义或原始设计原因时正常向用户追问，不限制轮数。互不依赖的问题尽量同轮提出，回答后重新判断是否仍有必要问题。

用户确认后：

- 将领域背景、角色、业务阶段和对象关系写入“领域上下文”；
- 将概念定义写入“术语”；
- 将约束写入“已确认规则与不变量”；
- 将具有长期价值且原因已确认的设计写入 `docs/kb/adr/<domain_id>/`；
- 将无法获得解释的问题写入 `.review/<domain_id>/domain-questions.md`，不阻塞其他内容。

完成 L1、ADR 和 `.review` 后运行：

```bash
node <skill-dir>/scripts/workflow.js --complete-step domain-knowledge --domain <domain_id>
```

## 6. 确认当前领域

集中向用户展示当前领域产物、归档关联、仍未解决的问题和主要证据。用户明确确认后运行：

```bash
node <skill-dir>/scripts/workflow.js --confirm-domain <domain_id>
```

然后重新运行 `workflow.js`。脚本只会推进到 `domain_order` 中的下一个待处理领域。

## 7. 完成仓库

所有领域确认后，派发仓库级只读子代理调查服务身份和系统边界。主 Agent 使用 `assets/L0-MAP.md` 创建或更新 L0 人工区，只保留“服务身份”和“系统边界”，并明确请用户 review。

用户完成 L0 review 后运行：

```bash
node <skill-dir>/scripts/workflow.js --complete-step l0-review
node <skill-dir>/scripts/index.js
node <skill-dir>/scripts/state.js
node <skill-dir>/scripts/verify.js
node <skill-dir>/scripts/workflow.js --complete-run
```

任一命令失败都停止并报告。增量运行若没有受影响领域，`workflow.js` 会直接提示完成本轮，不重写领域知识。
