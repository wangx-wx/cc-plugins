# 领域驱动工作流

使用本轮 `workflow.js --start` 返回的 `domain_order`，一次只处理一个领域。完成每个阶段后用脚本登记，再运行 `workflow.js` 获取下一步；当前领域未确认前不得进入下一个领域。

## 1. 调查代码事实

把当前领域的代码调查派发给只读子代理，提供人工确认的 include/exclude 范围和 [L1 提取规范](l1-extraction.md)。主 Agent 汇总证据，使用模板生成或更新 `docs/kb/domains/<domain_id>/README.md` 的代码版草稿；观察和推断不得写成已确认规则。

若该 README 的 `status` 是 `confirmed`、`review_required`、`stale` 或 `retired`，Agent 不要直接改写它。按 [L1 提取规范](l1-extraction.md) 把新发现的差异写入 `.review/<domain_id>/l1-changes.md`；只有 `draft` 和 `candidate` 可以由 Agent 直接改写。用户可以直接维护任意合法状态下的 L1 内容和状态。

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

## 5. 持续访谈并形成领域知识

完整执行 [领域建模访谈](domain-questioning.md)。以代码和归档调查得到的术语候选、ADR 问题候选为起点，建立设计树，按 frontier 分轮追问。每轮用户回答后重新计算设计树，并立即把满足准入条件的术语写入 L1 草稿、把满足准入条件的设计写入 ADR；不得根据扫描结果直接生成正式术语或 ADR。

同时将人工确认的领域背景、规则和边界写入 L1，并把本领域机器元数据中关联的每个 archive 写入 README 的“归档资料”；同一个 archive 可以被多个领域 README 引用。将无法获得解释的问题写入 `.review/<domain_id>/domain-questions.md`。frontier 为空后，汇总 L1、ADR 和 `.review`；只有用户确认已经达到共同理解，才运行：

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

所有领域确认后，派发仓库级只读子代理调查服务身份和系统边界。主 Agent 使用 `<skill-dir>/assets/L0.md` 创建或更新 `docs/kb/L0.md` 人工区，只保留“服务身份”和“系统边界”，并明确请用户 review。替换全部模板占位符后再进入下一步，`verify.js` 会报告仍含占位符的 L0。

用户完成 L0 review 后运行：

```bash
node <skill-dir>/scripts/workflow.js --complete-step l0-review
node <skill-dir>/scripts/index.js
node <skill-dir>/scripts/state.js
node <skill-dir>/scripts/verify.js
node <skill-dir>/scripts/workflow.js --complete-run
```

任一命令失败都停止并报告。增量运行若没有受影响领域，`workflow.js` 会直接提示完成本轮，不重写领域知识。

## 增量运行

增量运行只处理受影响的领域，流程可能比预期短，遇到时不要误判为出错：

- **代码没变但仍进入代码调查**：只要领域配置了语雀来源就会被选中。此时确认 README 的已确认内容未被改写即可，不必重新做领域访谈。
- **领域被直接跳过**：若代码没有变化、也没有新增归档，`workflow.js` 会判定该领域知识无需重写并直接放行。这表示没有东西要写，不代表流程失败。
