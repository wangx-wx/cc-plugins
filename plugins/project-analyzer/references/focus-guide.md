# Focus Guide：各维度分析要点

每个 focus 关注的分析维度和**典型高价值规则方向**。这是分析方向，不是执行步骤列表。

---

## arch — 架构边界

**读哪些文件**：Controller + Service + Mapper/Repository，跨业务模块各取 2-3 个，加 GlobalExceptionHandler。

**关注**：
- 模块划分方式（按业务领域 vs 按技术层次，是否一致）
- 跨模块调用是否统一（全部 Feign vs 部分直接注入）
- 请求链层次（Controller → Service → Mapper 分层是否清晰，是否存在跨层调用）
- 参数校验位置（@Valid 在 Controller、还是 Service 手动校验、还是两者都有）

**典型高价值规则**：跨层直接注入 Mapper、校验方式不一致、包结构有项目特有规律。

---

## api — API 契约

**读哪些文件**：统一响应对象、FeignClient 接口（2-3 个）、FallbackFactory 实现（2-3 个）、Controller（2-3 个带 @PostMapping 的）。

**关注**：
- 统一响应对象是否被所有 Controller 使用（是否有返回裸 DTO 的例外）
- FeignClient 接口方法返回类型（是否也用统一响应对象）
- FallbackFactory 实现模式（日志写法、错误码返回方式是否统一）
- 调用方对 Feign 返回值的处理（是否先检查 isSuccess() 再取 getData()）
- 错误码定义位置（枚举类、常量类、还是分散）

**典型高价值规则**：直接 getData() 不检查、fallback 打印原始异常、FeignClient 返回裸对象。

---

## security — 异常/日志/安全

**读哪些文件**：GlobalExceptionHandler（必读）、带 @Transactional 的 Service（2-3 个）、有敏感字段的 Entity/DTO、日志工具类（若有）。

**关注**：
- 异常处理边界（GlobalExceptionHandler 处理什么，哪些场景用本地 try-catch）
- 敏感字段日志打印（手机号、身份证、银行卡等字段日志中是否脱敏）
- @Transactional 边界（事务内是否有外部调用：Feign 调用、MQ 发送、文件操作）
- 异常是否被吞掉（catch 后只 log 不处理、空 catch）

**典型高价值规则**：事务内调外部服务（副作用顺序问题）、敏感字段明文日志、异常吞掉不处理。

---

## robustness — 健壮性

**读哪些文件**：调用了 Feign 的 Service（2-3 个，看调用方如何处理返回值）、Mapper 调用处（看空返回处理）、MQ Consumer（如有）、Redis 使用处（如有）。

**关注**：
- Feign 调用失败后调用方怎么处理（fallback 后是否继续判断、是否有降级逻辑）
- DB 查询返回空时的处理（Optional / 抛异常 / null check 是否统一）
- 并发写保护（是否有乐观锁、悲观锁、唯一索引相关写法）
- MQ 消费失败处理（catch 后是否明确 ACK/NACK，不是 finally 无条件 ACK）
- Redis 不可用时的降级（try-catch 还是允许抛出 500）

**典型高价值规则**：DB 空返回无处理、MQ 消费 finally 无条件 ACK、Feign 失败后未降级直接返回 null。

---

## db — 数据库层

**读哪些文件**：Mapper 接口（2-3 个）、Mapper XML（2-3 个，如有）、Entity（2-3 个）、复杂查询 Service。

**关注**：
- SQL 参数化（Mapper XML 中是否有 `${}` 拼接用户输入）
- 批量操作限制（`insertBatch` 是否有大小控制）
- Entity 注解规范（@TableName / @Table 命名规律、软删除字段规律）
- Mapper 方法命名规律（项目特有的命名约定）
- tk.mybatis Example 使用方式（如有）

**典型高价值规则**：`${}` SQL 注入风险、批量无上限、Entity 字段命名不一致。

---

## cache — 缓存

**读哪些文件**：Redis 配置类、RedisTemplate 使用处（2-3 个）、有 @Cacheable 的 Service（如有）、分布式锁实现（如有）。

**关注**：
- Redis key 命名规范（是否有统一前缀或格式规律）
- 序列化方式（Jackson / JDK / Kryo，是否统一）
- 缓存注解使用方式（@Cacheable 的 key SpEL 写法规律）
- 分布式锁实现（Redisson / 自实现 setNX，过期时间设置是否一致）
- 缓存穿透/雪崩保护（是否有空值缓存、随机过期时间等保护）

**典型高价值规则**：key 无过期时间、序列化方式不统一、lock 无线程标识。

---

## mq — 消息队列

**读哪些文件**：MQ Consumer（全部，如不超过 10 个）、MQ Producer（2-3 个）、消息体 DTO（2-3 个）。

**关注**：
- Consumer 幂等保障（业务 ID 去重 / Redis 锁 / DB 唯一索引）
- ACK 确认时机（是在 finally 无条件 ACK，还是成功才 ACK、失败 NACK）
- 消息体设计（是否有版本字段、是否所有字段可为 null）
- Producer 发送失败处理（是否有重试或补偿机制）
- 死信队列是否配置

**典型高价值规则**：Consumer finally 无条件 ACK（消息丢失风险）、无幂等保护、消息体无版本字段。

---

## testing — 测试

**读哪些文件**：测试类（sample 2-5 个，覆盖不同测试类型）。

**关注**：
- 测试框架和分层（@WebMvcTest / @SpringBootTest / 纯 Mockito）
- Mock 策略（什么层 mock 什么）
- 测试命名约定（是否有一致的命名模式）
- 是否只有 happy path（有无边界测试：空输入、异常场景、并发）

**无测试时**：不生成"禁止使用 X 框架"规则，直接生成默认 TDD 约束：
- Controller 接口必须有 @WebMvcTest 切片测试
- Service 公共方法必须有单元测试
- 测试方法命名约定（如无约定则建议 `methodName_whenCondition_thenExpected`）

**典型高价值规则**：只有 happy path 无异常场景、分层策略与项目惯例不符、mock 层级不一致。
