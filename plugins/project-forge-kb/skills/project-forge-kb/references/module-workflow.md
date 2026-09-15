# 业务模块驱动工作流

使用本轮 `workflow.js --start` 返回的 `module_order`，一次只处理一个业务模块。完成每个阶段后用脚本登记，再运行 `workflow.js` 获取下一步；当前业务模块未确认前不得进入下一个业务模块。所有 ADR 必须写入 `docs/kb/L1/<module_id>/adr/<四位编号>-<描述>.md`，例如 `docs/kb/L1/payment/adr/0001-preserve-refund.md`；不得直接放在 L1 目录下。

## 1. 调查代码事实

把当前业务模块的代码调查派发给只读子代理，提供人工确认的 include/exclude 范围和 [L1 提取规范](l1-extraction.md)。主 Agent 汇总证据，使用模板生成或更新 `docs/kb/L1/<module_id>/README.md` 的代码版草稿；观察和推断不得写成已确认规则。

若该 README 的 `status` 是 `confirmed`、`review_required`、`stale` 或 `retired`，Agent 不要直接改写它。按 [L1 提取规范](l1-extraction.md) 把新发现的差异写入 `.review/<module_id>/l1-changes.md`；只有 `draft` 和 `candidate` 可以由 Agent 直接改写。用户可以直接维护任意合法状态下的 L1 内容和状态。

```bash
node <skill-dir>/scripts/workflow.js --complete-step code-facts --module <module_id>
```

脚本会校验 L1 草稿并生成本业务模块机器元数据。

## 2. 获取并确认语雀候选

当前业务模块配置了 `yuque_sources` 时运行：

```bash
node <skill-dir>/scripts/yuque-candidates.js --module <module_id>
node <skill-dir>/scripts/workflow.js --complete-step yuque-candidates --module <module_id>
```
当前业务模块没有配置 `yuque_sources`、但填写了 `keywords` 时，不得跳过语雀候选阶段。先运行：

```bash
node <skill-dir>/scripts/yuque-books.js
```

向用户展示知识库名称和 slug；用户确认后显式传入：

```bash
node <skill-dir>/scripts/yuque-candidates.js --module <module_id> --book-slug <slug> --confirm-book
```

`--book-slug` 必须和 `--confirm-book` 一起使用；它只指定本次检索，不会静默修改 `module-scope.yaml`，并会在候选文件中记录 `confirmed_book_slug`。只有 `keywords` 和 `yuque_sources` 都为空时，工作流才跳过语雀候选阶段。

向用户展示 `docs/kb/.review/<module_id>/yuque-candidates.yaml` 中的候选，说明只需把每项 `decision` 从 `pending` 改成 `approved` 或 `rejected`。Agent 不代替用户决定，也不修改候选事实字段。

用户修改后运行：

```bash
node <skill-dir>/scripts/yuque-selection.js --module <module_id>
```

仍有 `pending` 时停止等待；全部确认后继续。未配置语雀来源时，状态脚本会直接进入归档。

## 3. 归档当前业务模块资料

完整执行 [归档工作流](archive-workflow.md)。业务模块级命令会处理全部项目文档和已批准语雀文档，并自动复用未变化来源。

```bash
node <skill-dir>/scripts/workflow.js --complete-step archives --module <module_id>
```

## 4. 调查归档事实

把当前业务模块的归档调查派发给只读子代理。子代理先读相关摘要，按需读取 chunk，报告对业务模块上下文、术语、规则、边界和设计候选的支持、补充或冲突。主 Agent 综合代码与归档证据；冲突和推断继续作为候选。

```bash
node <skill-dir>/scripts/workflow.js --complete-step archive-facts --module <module_id>
```

## 5. 持续访谈并形成业务模块知识

完整执行 [业务模块建模访谈](module-questioning.md)。以代码和归档调查得到的术语候选、ADR 问题候选为起点，建立设计树，按 frontier 分轮追问。每轮用户回答后重新计算设计树，并立即把满足准入条件的术语写入 L1 草稿、把满足准入条件的设计写入 ADR；不得根据扫描结果直接生成正式术语或 ADR。

同时将人工确认的业务模块背景、规则和边界写入 L1，并把本业务模块机器元数据中关联的每个 archive 写入 README 的“归档资料”；同一个 archive 可以被多个业务模块 README 引用。将无法获得解释的问题写入 `.review/<module_id>/module-questions.md`。frontier 为空后，汇总 L1、ADR 和 `.review`；新 ADR 使用 `assets/ADR.md`，文件名为 `<四位编号>-<描述>.md`，frontmatter 使用 `doc_id: ADR-<module_id>-<编号>`，并在 L1 的“设计与决策”表中使用相同 `doc_id` 和正确相对链接。只有用户确认已经达到共同理解，才运行：

```bash
node <skill-dir>/scripts/workflow.js --complete-step module-knowledge --module <module_id>
```

## 6. 确认当前业务模块

集中向用户展示当前业务模块产物、归档关联、仍未解决的问题和主要证据。确认前先确保 ADR 均位于 `L1/<module_id>/adr/` 且 README 链接可达；`workflow.js --confirm-module` 会执行这项结构检查。用户明确确认后运行：

```bash
node <skill-dir>/scripts/workflow.js --confirm-module <module_id>
```

然后重新运行 `workflow.js`。脚本只会推进到 `module_order` 中的下一个待处理业务模块。

## 7. 完成仓库

所有业务模块确认后，派发仓库级只读子代理调查服务身份。主 Agent 使用 `<skill-dir>/assets/L0.md` 创建或更新 `docs/kb/L0.md` 的“服务身份”，并明确请用户 review。替换全部模板占位符后再进入下一步，`verify.js` 会报告仍含占位符的 L0。`index.js` 只生成业务模块知识索引，不在 L0 中生成 ADR 或 archive 索引。

用户完成 L0 review 后运行：

```bash
node <skill-dir>/scripts/workflow.js --complete-step l0-review
node <skill-dir>/scripts/index.js
node <skill-dir>/scripts/state.js
node <skill-dir>/scripts/verify.js
node <skill-dir>/scripts/workflow.js --complete-run
```

任一命令失败都停止并报告。增量运行若没有受影响业务模块，`workflow.js` 会直接提示完成本轮，不重写业务模块知识。

## 增量运行

增量运行只处理受影响的业务模块，流程可能比预期短，遇到时不要误判为出错：

- **代码没变但仍进入代码调查**：只要业务模块配置了 `yuque_sources` 或 `keywords` 就会被选中，因为这两种配置都要检索语雀。此时确认 README 的已确认内容未被改写即可，不必重新做业务模块访谈。
- **业务模块被直接跳过**：若代码没有变化、也没有新增归档，`workflow.js` 会判定该业务模块知识无需重写并直接放行。这表示没有东西要写，不代表流程失败。
