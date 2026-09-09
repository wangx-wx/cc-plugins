# 领域范围配置

`docs/kb/domain-scope.yaml` 由人工填写，是领域归属和文档来源的唯一权威输入。脚本和 Agent 只能校验、读取，不能替人工修改。

## 数组写法

非空数组优先使用逐行写法：

```yaml
keywords:
  - 支付
  - 退款
```

可选数组没有内容时，以下三种写法等价，都会规范化为 `[]`：

```yaml
exclude_files: []
project_docs:
# 或完全省略该字段
```

## 完整示例

路径均相对于目标仓库根目录。`include_packages` 和 `exclude_packages` 使用完整 Java 包名；非 Java 项目可主要使用 `include_files`。

```yaml
schema_version: 1

domains:
  - id: payment
    name: 支付
    owner: payment-team
    status: active
    include_packages:
      - com.example.payment
    include_files:
      - payment-api/src/main/resources/payment-error-codes.yaml
    exclude_packages:
      - com.example.payment.legacy
    exclude_files: []
    keywords:
      - 支付
      - 退款
      - PaymentOrder
    project_docs:
      - docs/payment/payment-design.md
    yuque_sources:
      - base_slug: hpf27k
      - document_url: https://www.yuque.com/example/payment/refund

  - id: device
    name: 设备
    owner: device-team
    status: active
    include_packages: []
    include_files:
      - src/device/device-service.js
    exclude_packages: []
    exclude_files: []
    keywords:
      - 设备
      - Device
    project_docs:
    # yuque_sources 没有内容，直接省略
```

每个 `yuque_sources` 元素必须且只能选择一种形式：

- `base_slug`：在指定知识库内使用本领域 `keywords` 搜索；slug 使用 `yuque-books.js` 返回值，不得猜测。
- `document_url`：将确定的单篇文档加入待人工确认候选。

`status: active` 的领域进入 `domain_order`；`inactive` 保留配置但本轮不处理。领域顺序就是 `domains` 的书写顺序。

## 写完后的校验

从目标仓库根目录运行：

```bash
node <skill-dir>/scripts/scope-check.js
```

以下问题会作为 error 阻止继续：

- `schema_version` 不是 `1`，或 `domains` 为空；
- 领域 ID 格式错误或重复；
- 没有填写 `include_packages` 和 `include_files` 中的任何一种；
- 非空数组中包含空值或非字符串；
- `include_files`、`project_docs` 指向不存在的路径；
- `yuque_sources` 同时填写或同时缺少 `base_slug`、`document_url`；
- 使用 `base_slug` 却没有填写 `keywords`；
- `status` 不是 `active` 或 `inactive`。

未匹配到文件的包范围、缺失的排除路径会作为 warning 报告，但不会阻止继续。校验成功后生成 `docs/kb/.meta/scope-resolved.json`，并输出按人工书写顺序排列的 `domain_order`。
