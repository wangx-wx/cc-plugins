## 1. 判断矩阵：什么变更需要哪种测试

| 变更位置 | 单元测试 | 集成测试 | 说明 |
|---|---|---|---|
| Service / 领域逻辑 | **必需** | 跨组件/事务时需要 | 有分支、计算、状态流转就必须有单测 |
| Mapper / 自定义 SQL | 不适合 | **必需** | mock SQL 无意义，必须连真实 PG |
| Controller / 接口 | 有逻辑才需要 | **推荐**（`@WebMvcTest`+MockMvc） | mock service，只验证接口契约/参数/序列化 |
| 外部调用（Feign/RPC/MQ） | mock 后做单测 | 契约测试（另议） | 不直连真实下游 |
| Util / 纯函数 | **必需** | 不需要 | |
| DTO/VO/Entity/Config/常量 | 豁免 | 豁免 | 无逻辑 |
| 抽象类 / 接口 / 枚举 | 豁免 | 豁免 | 测具体实现类 |

**触发信号**：diff 里有分支/计算/状态流转 → 单测；有 SQL/跨服务/事务/消息 → 集成测试；只是字段增减/重命名/配置/纯透传 → 豁免（须注明原因）。

**覆盖要求**：每个 public 方法至少两个用例——正常路径（happy path）+ 主要异常路径（方法有显式异常声明或条件分支时）。

## 2. 复用优先

不是所有变更都要新写测试。先查是否已有相关测试：
1. 已覆盖本次改动 → 跑现有测试验证，仅在行为改变时更新断言，不重复造测试
2. 有测试但未覆盖本次改动 → 在现有测试类补用例
3. 完全没有、且按矩阵需要 → 才新写

禁止：改 `src/main` 不动 `src/test`；能复用却另起炉灶重写。

## 3. 反模式红线

| 红线 | 正确做法 |
|---|---|
| 无断言，靠 `System.out.println` + `Thread.sleep` 人肉看 | AssertJ 断言；异步用 Awaitility |
| 硬编码密钥 / 真实 userId，只能连真实环境跑 | 测试数据 / mock；密钥不入库 |
| 纯逻辑也用 `@SpringBootTest` 启整个容器 | 纯逻辑用 Mockito 单测 |
| 测试直连真实下游 | mock 外部依赖 |
| 改主代码不更新旧测试 | 同步更新或补用例 |

## 4. 集成测试数据源

**连 Apollo DEV 共享开发库，复用运行时配置。**

- 仅**本地手动 / 半自动**运行，**不进 CI**（CI 在局域网外连不上 dev）
- 环境校验：运行时 `APOLLO_ENV=DEV` 且 `apollo.meta` 含 `-dev`；非 DEV 拒跑
- 真实数据提醒：执行时显式告警「正在连 Apollo dev 真实共享库」
- 写隔离：默认 `@Transactional`，方法结束自动回滚；测试数据在事务内自行 seed
- `@SpringBootTest` 必须关 Eureka（`eureka.client.enabled=false`）、禁 xxljob

## 5. 真 / mock / 关

被测目标用**真**，其余分流：

| 依赖 | 处理 | 说明 |
|---|---|---|
| 数据库 PG | ✅ 真（连 dev） | 被测目标 |
| 第三方 HTTP / 其他微服务 RPC / LLM | 🎭 mock（`@MockBean` / WireMock） | 慢、不可控 |
| RocketMQ 发送 | 🎭 mock `RocketMQTemplate` + `verify` | 绝不对真发 dev MQ |
| RocketMQ 消费 | 直接调 listener，不连 broker | |
| Redis | 被测则真，否则可 mock | |
| Eureka | 🚫 关闭（`eureka.client.enabled=false`） | 防注册进 dev |
| xxljob / Sentinel | 🚫 关闭 | |

## 6. 异步 / MQ / 事务提交后回调

| 场景 | 做法 | 要点 |
|---|---|---|
| 发 MQ（producer） | mock `RocketMQTemplate` + `verify` | 绝不真发 dev MQ |
| 消费 MQ（consumer） | 直接调 listener 方法 | 不连 broker |
| `@Async` / 线程池异步 | 默认同步化（`SyncTaskExecutor` 或 mock） | 异步线程不在测试事务里 |
| 确需验证异步真跑完 | Awaitility + `@AfterEach` 手动清理 | 不享受回滚护栏，慎用 |
| `afterCommit` / 事务消息 | `TestTransaction` 手动提交 | 回滚不触发 afterCommit |

## 7. 目录与命名

- **目录**：`src/test/java`，镜像 `src/main/java` 包结构，测试包名与源码包名一致
- **后缀**：`*Test` = 单测（`mvn test`），`*IT` = 集成测试（`mvn verify`）
- **类命名**：`OrderServiceImpl` → 单测 `OrderServiceImplTest`、集成 `OrderServiceImplIT`；`OrderMapper` → 集成 `OrderMapperIT`（Mapper 不做单测）
- **方法命名**：`test方法_条件_预期`（英文）+ `@DisplayName` 中文

```java
@Test
@DisplayName("库存为零时下单应抛异常")
void testCreateOrder_whenStockZero_throwsException() { /* given-when-then */ }
```

## 8. 单元测试依赖

| 场景 | 依赖 |
|---|---|
| 单测 | `spring-boot-starter-test`（含 JUnit5 + Mockito + AssertJ） |
| 集成测试（本组） | 仅需 `postgresql` 驱动（项目已有） |
| 集成测试需 mock HTTP | 额外 `wiremock-standalone` |

> JDK8 → `javax.*`；JDK17 → `jakarta.*`；老项目有 JUnit4 需迁移到 JUnit5。
