# 规则格式参考

## 类型一：项目特有规则（五段结构）

来自代码分析。所有五段都必须有内容，缺少任意一段则移到"待确认"段。

### 模板

```markdown
### RULE-{CATEGORY}-{hash8} {规则标题}

> 来源：代码分析 | 置信度：高/中/低 | 证据：`path/to/file.java`

#### 场景
当做 {具体编码任务类型} 时适用。
不允许写"所有情况"或"任何时候"。

#### 约束
- SHALL {做什么} — 因为 {架构原因或业务风险}
- SHALL NOT {不能做什么} — 因为 {会导致什么问题}
- 每条约束必须可用 grep/find 独立核查
- SHALL NOT 的原因不得省略

#### 参考实现
以项目内 `module/path/ClassName.java` 为模板，核心结构：
（来自项目的真实代码片段，不是通用 Java 示例）

#### 反例
`module/path/LegacyClass.java` 中的写法 {具体说明}，不应模仿。

#### 验收方式
- `grep -r "{pattern}" {path}/` 应无结果
- 或：新增类的 package 路径应符合 {规律}
```

### 示例（合格的项目特有规则）

```markdown
### RULE-API-3f2a1b4c Feign 调用必须返回 Result<T> 并处理 fallback 错误码

> 来源：代码分析 | 置信度：高 | 证据：`order-service/src/main/java/com/example/feign/PaymentFeignClient.java`

#### 场景
当新增或修改 Feign 客户端接口及其 fallback 实现时适用。

#### 约束
- SHALL 所有 FeignClient 接口方法返回 `Result<T>`，不得返回裸业务对象
- SHALL fallback 实现必须用 `SensitiveLogUtils.maskLog()` 记录错误，不得打印原始异常堆栈
- SHALL fallback 返回 `Result.fail(ErrorCode.THIRD_PARTY_ERROR)`，不得 unwrap 直接抛出
- SHALL NOT 调用方直接 `.getData()` 而不先检查 `result.isSuccess()`

#### 参考实现
以 `order-service/src/main/java/com/example/feign/PaymentFeignClient.java` 为模板：
```java
@FeignClient(name = "payment-service", fallbackFactory = PaymentFeignClientFallbackFactory.class)
public interface PaymentFeignClient {
    @PostMapping("/api/payment/create")
    Result<PaymentDTO> createPayment(@RequestBody CreatePaymentReq req);
}
```

#### 反例
`legacy-service/src/main/java/com/example/feign/OldOrderClient.java`：
直接返回裸 DTO，fallback 打印原始异常，调用方 try/catch 吞掉异常继续执行。

#### 验收方式
- `grep -rn "implements FallbackFactory" src/` 找到的每个类，方法体必须包含 `SensitiveLogUtils`
- `grep -rn "\.getData()" src/` 前面必须有 `isSuccess()` 检查
```

---

## 类型二：团队编码原则（三段结构）

来自显式规范文件（checkstyle/ArchUnit/ADR）或用户确认。必须包含场景、约束、原因三段。

**原因段不得为空，不得只写"遵守规范"等空洞表达。**

### 模板

```markdown
### PRINCIPLE-{CATEGORY}-{hash8} {原则标题}

> 来源：{显式规范/ArchUnit/ADR/用户确认} | 置信度：高

#### 场景
当 {适用情况} 时适用。

#### 约束
- SHALL {做什么}
- SHALL NOT {不能做什么}

#### 原因
为什么本团队有这条原则（背景、历史包袱或业务风险），面向初级开发者说明 why。
```

---

## 不生成的内容（规则拒绝清单）

以下类型的规则不得写入任何段：

- **纯框架常识**：`@RestController 标记 Controller`、`@Service 标记服务类` — 任何 Spring 开发者都知道
- **空洞声明**：`注重代码质量`、`遵守规范`、`保持代码整洁` — 无场景无约束无原因
- **只有目录结构的观察**：`Controller 放在 controller/ 目录` — 这是目录结构，不是约束
- **从注解名推断的规则**：`发现 @FeignClient → 使用 FeignClient 调用` — 这是通用知识，不是项目规则
- **缺席证据推断的禁止规则**：`未发现 MQ 使用 → "禁止使用 MQ"` — 技术当前未使用 ≠ 架构禁止

**观察事实 vs 架构约束的区别**：

| 类型 | 示例 | 是否生成规则 |
|------|------|------------|
| 观察事实 | "当前项目未使用 MQ" | ❌ 不生成 |
| 反模式约束 | "MQ Consumer catch 后静默 COMMIT，消息丢失" | ✅ 生成 |
| 架构边界约束 | "跨模块调用必须通过 Feign（有 ADR 支撑）" | ✅ 生成 |
| 未来可能性限制 | "BFF 层不应使用 MQ" | ❌ 不生成 |

**判断标准**：如果任何有框架经验的 Java 开发者都会自然遵守这条规则，就不写。只有当规则是为了纠正项目内已存在的反模式，或团队不同层级有不同理解时，才写。规则必须来自正面证据（发现了什么），不得来自缺席证据（没发现什么）。
