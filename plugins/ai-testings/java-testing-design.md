# Java 后端测试方案（供团队讨论 / 决策）

> **本文档定位**：把单元测试 / 集成测试的可选方案、各自权衡**摊开陈列**，供团队沟通后决策，**不是定稿规范**。
> 凡需团队拍板处标 `【决策点】`，文末汇总。方案均编号（D = 数据源，H = Hook 触发），便于讨论时引用。
> 技术栈基线：MyBatis-Plus + PostgreSQL；JDK8 与 JDK17 双栈并存。

---

## 1. 测试分层与判断标准

### 1.1 什么变更需要哪种测试（判断矩阵）

| 变更位置 | 单元测试 | 集成测试 | 说明 |
|---|---|---|---|
| Service / 领域逻辑 | **必需** | 跨组件/事务时需要 | 有分支、计算、状态流转就必须有单测 |
| Mapper / 自定义 SQL | 不适合 | **必需** | mock SQL 无意义，必须连真实 PG |
| Controller / 接口 | 有逻辑才需要 | **推荐**（`@WebMvcTest`+MockMvc） | mock service，只验证接口契约/参数/序列化 |
| 外部调用（Feign/RPC/MQ） | mock 后做单测 | 契约测试（另议） | 不直连真实下游 |
| Util / 纯函数 | **必需** | 不需要 | |
| DTO/VO/Entity/Config/常量 | 豁免 | 豁免 | 无逻辑 |

**触发信号**：diff 里有分支/计算/状态流转 → 单测；有 SQL/跨服务/事务/消息 → 集成测试；只是字段增减/重命名/配置/纯透传 → 豁免（须注明原因）。

**改动已有代码（复用优先——不是所有变更都要新写测试）**：先查是否已有相关测试——① **已覆盖本次改动** → 跑现有测试验证，仅在行为改变时更新断言，不重复造测试；② **有测试但未覆盖本次改动** → 在现有测试类补用例；③ **完全没有、且按上表需要** → 才新写。禁止「改 `src/main` 不动 `src/test`」，也禁止「能复用却另起炉灶重写」。

### 1.2 反模式红线（来自现有代码的真实问题）

| 红线 | 正确做法 |
|---|---|
| 无断言，靠 `System.out.println` + `Thread.sleep` 人肉看 | AssertJ 断言；异步用 Awaitility |
| 硬编码密钥 / 真实 userId，只能连真实环境跑 | 测试数据 / mock；密钥不入库 |
| 纯逻辑也用 `@SpringBootTest` 启整个容器 | 纯逻辑用 Mockito 单测 |
| 测试直连真实下游 / 真实库做断言 | 见第 2 节数据源方案 / mock |
| 改主代码不更新旧测试 | 同步更新或补用例 |

---

## 2. 集成测试：真/mock 边界 + 数据源方案【核心 · 决策点】

### 2.1 先决：什么时候用真数据、什么时候 mock

> 选数据源之前先统一这个认知，否则团队容易吵成「那我全 mock 不就行了」或「那全连真库」。

**第一步：分清两个常被混为一谈的概念。**

| 做法 | 它是什么 | 在集成测试里 |
|---|---|---|
| 用 `@Sql`/fixture 往**真实库**灌入可控的测试数据 | **数据准备（seed）**，不是 mock | ✅ 必须做——保证可重复，不依赖库里既有数据 |
| 用假对象替换 Mapper/数据库、返回写死的数据 | **mock 数据库** | ❌ SQL/方言根本没测到，退化成单测，等于没测 |

> 所以「集成测试能不能 mock 数据」：若指**准备可控数据**，这是正确姿势；若指**把数据库本身 mock 掉**，那它就不再是集成测试。

**第二步：判断原则——被验证的那个集成点必须用真；它之外、又慢/不可控/有副作用的依赖，应当 mock。**

| 这个测试在验证什么 | 用真 | 该 mock 掉 |
|---|---|---|
| Mapper / SQL 正确性 | **真数据库（PG）** | 该层若有的外部调用 |
| Service 业务编排 | Service + 真 DB | 第三方 HTTP、其他微服务 RPC、MQ、**LLM/大模型** |
| Controller 接口 / 全链路 | Controller→Service→DB | 同上外部依赖 |
| 纯算法 / 计算逻辑 | （不该用集成测试，改用单测） | —— |

**反例（来自现有代码）**：`ScenesWorkflowTests` 直连真实 LLM 接口、`Thread.sleep` 等结果。正确做法是测 workflow 编排时**把 LLM mock 成固定响应**，只验证编排/工具调用逻辑——这样才稳定、可重复、能进 CI。

**常用 mock 手段：**
- `@MockBean`（Spring Boot 3.4+ / Spring 6.2 起改用 `@MockitoBean`）：在 `@SpringBootTest` 里替换某个 bean，适合 mock service / 外部 client。⚠️ 会使 Spring 上下文缓存失效、触发重建，**用多了显著拖慢测试**，需节制。
- **WireMock**：mock 外部 HTTP 服务，走真实 HTTP 栈，比 `@MockBean` 更接近真实。
- 反向地，**Testcontainers** 是把依赖**变真**（DB/Kafka/Redis）。

**典型组合**：真 DB（Testcontainers）+ mock 外部 HTTP（WireMock/@MockBean）+ 真 Service/Mapper。

### 2.2 数据源候选方案

确定「该用真数据库」之后，真正的分歧点是 **Mapper/SQL 测试连哪个库**。下面列出全部候选方案。

#### 候选方案逐个说明

#### D1. 内存数据库 H2（PostgreSQL 兼容模式）
- **做法**：H2 加 `MODE=PostgreSQL`，内存启动。
- **优点**：纯 Java、零外部依赖、最快、CI 无需 Docker。
- **缺点**：兼容模式**不完整**——JSONB、数组、`ON CONFLICT`、窗口函数、PG 专有函数行为不一致；MyBatis-Plus 的 PG 特性易踩坑；**"测过了生产挂"**。
- **适用**：SQL 极简单的项目勉强可用；**不推荐**作为 PG 项目的主力。

#### D2. Testcontainers（真实 PostgreSQL 容器）
- **做法**：测试启动时用 Docker 拉起真实 PG 容器（版本可钉、可用带 pgvector/postgis 的镜像）。
- **优点**：**方言 100% 真实**、版本可控、数据隔离好（每次干净容器）、生态成熟、扩展支持最好。
- **缺点**：**每个开发者本地需装 Docker**；首次拉镜像慢；启动有开销（可用 singleton + reuse 优化）。
- **适用**：CI 已有 Docker 的团队的主流选择。

#### D3. embedded-postgres（zonky）
- **做法**：下载**真实 PG 二进制**在本地进程跑，无需 Docker。
- **优点**：真实 PG（非兼容模式）、**无需 Docker**、跨平台、`mvn test` 即跑。
- **缺点**：二进制下载/版本管理；**arm64 Mac 需额外依赖**；**装 PG 扩展（pgvector 等）困难**；社区活跃度不如 Testcontainers。
- **适用**：团队不便普及 Docker、又要真实 PG 时的替代。

#### D4. 真实远程数据库（两种细分）
- **D4a 直连开发库**（共享、含真实数据）：方言最真实、零搭建；但**数据隔离最差**（并发污染、数据漂移、不可重复）、**写操作危险**（破坏他人数据）、需 VPN/凭据、有安全合规问题。**仅适合本地手动只读验证复杂 SQL**，不进 CI、不让 agent 自动生成。
- **D4b 专用独立测试库**（CI 专属 PG 实例，每次重置 schema）：比 D4a 安全，方言真实、无需每人装 Docker；但仍是**共享实例**，并发隔离靠 schema/事务，需配套数据清理与重置策略，需运维一个常驻实例。

#### D5. 外部预置容器（docker-compose 管理）
- **做法**：CI/本地用 docker-compose 预先起好 PG，测试连固定连接串（容器生命周期在测试代码之外）。
- **优点**：测试代码简单、容器可跨多次运行复用。
- **缺点**：仍需 Docker；环境耦合、端口冲突风险、隔离不如 D2；需手动维护 compose 与生命周期。

### 2.3 统一对比表

| 维度 | D1 H2 | D2 Testcontainers | D3 embedded-pg | D4a 开发库 | D4b 独立测试库 | D5 compose |
|---|---|---|---|---|---|---|
| 方言真实度 | ❌低 | ✅高 | ✅高 | ✅最高 | ✅最高 | ✅高 |
| 数据隔离/可重复 | ✅高 | ✅高 | ✅高 | ❌最差 | ⚠️中 | ⚠️中 |
| 需要 Docker | 否 | **是** | 否 | 否 | 否 | **是** |
| 需要网络/VPN | 否 | 否 | 否 | **是** | **是** | 否 |
| 写操作安全 | ✅ | ✅ | ✅ | ❌危险 | ⚠️ | ⚠️ |
| PG 扩展(pgvector等) | ❌ | ✅ | ⚠️难 | ✅ | ✅ | ✅ |
| 启动速度 | 最快 | 中（可优化） | 中 | 快 | 快 | 快 |
| CI 友好 | ✅ | ✅(有Docker) | ✅ | ⚠️ | ✅ | ✅ |
| agent 生成友好 | ⚠️假绿 | ✅ | ✅ | ❌flaky | ⚠️ | ⚠️ |
| 维护成本 | 低 | 中 | 中 | 低 | 中(需运维实例) | 中 |

### 2.4 不论选哪种，都要解决：表结构（schema）从哪来

MyBatis-Plus 不会自动建表，集成测试必须有 schema 来源。优先级：
1. **复用 Flyway / Liquibase 迁移脚本**（与生产同源，最推荐）；
2. `@Sql` 指定建表脚本；
3. Testcontainers init script / 镜像内置。

> 【决策点】是否已有 Flyway/Liquibase？没有的话集成测试的建表方式要单独定。

### 2.5 倾向性建议（供参考，最终团队定）

- **CI 有 Docker 且开发机普遍能装 Docker → D2 Testcontainers**（最真实、隔离最好、生态最成熟）。
- **Docker 难普及 → D3 embedded-postgres**（保住真实 PG，门槛最低）；若用到 pgvector 等扩展则 D3 不适用。
- **D4a 真实开发库**只作本地手动验证手段，**不进自动化**。
- **D1 H2** 对 PG 项目基本排除。
- 可以"**默认一种 + 允许一种例外**"组合（如默认 D2、无 Docker 时降级 D3），但会增加基类与文档维护成本。

### 2.6 【团队已定】数据源决策结论

> 适用范围：本组 Apollo 接管配置、数据源在 Apollo 远程 namespace 的微服务。技术现状——应用启动走 `apollo.bootstrap + eagerLoad`，本地仓库看不到 jdbc url（在 `sharding-datasource.properties` / `druid-*.properties` 等远程 namespace 里）。

**方案：直连 Apollo DEV 共享开发库（D4a 受控变体），集成测试复用项目运行时配置。**

- **适用边界**：仅**本地手动 / 半自动**运行——开发者本机在**公司局域网内 100% 可连 dev**（Apollo + 数据库）；而 **CI 在局域网外、连不上 dev**，故**不进 CI**（将来要 CI 化则另立 Testcontainers 方案）。
- **环境判定字段（纠正：不是 `app.meta`）**：
  - 主：顶层 `env` / `APOLLO_ENV`（默认 `DEV`），须为 `DEV`；
  - 辅：`apollo.meta` 地址含 `-dev`（而非 `-test-alpha` / `-uat` / `-pro`）；
  - ⚠️ 二者均为 `${ENV_VAR:DEV}` 形式，**静态读 yaml 只能拿到默认值**；校验须取**运行时实际生效值**（环境变量），或启动后打印真实 datasource url 再断言。

**三道护栏（强制）**：
1. **环境校验**——运行前确认运行时 `APOLLO_ENV=DEV` 且 `apollo.meta` 含 `-dev`；非 DEV 一律拒跑。
2. **真实数据提醒**——执行集成测试时显式告警「正在连 Apollo dev 真实共享库」。
3. **写隔离**——集成测试默认 `@Transactional`，方法结束自动回滚，不向共享库落数据；所需数据由测试**在事务内自行 seed**，不依赖库中既有数据。

**连带消解的决策点**：决策点 3（建表来源）→ 无需建表（dev 库为生产同构的现成 schema）；决策点 2（是否允许真实库）→「是，限本地 + 三护栏」。

**落地必处理的架构坑（写基类时）**：
1. `@SpringBootTest` 会触发 Apollo 全量 namespace 加载 → 连 Redis/RocketMQ/Eureka/xxljob。**必须关 Eureka 注册**（`eureka.client.enabled=false`）、禁 xxljob、按需排除 MQ，避免测试**注册进 dev 注册中心**干扰真实服务发现。
2. 含 `sharding-datasource`（分库分表）/ 多数据源的项目，`@Transactional` 回滚**跨分片 / 跨源不保证**，需单独验证。

### 2.7 依赖处理：真 / mock / 关（被测目标用真，其余分流）

> 「集成测试是不是把外部服务/中间件全部 mock?」——否。被测的那个集成点用**真**；其余看它是「业务依赖」还是「基础设施」：业务依赖 **mock**（保留 `verify` 验证交互），基础设施直接 **关**。两个最易错点：① 数据库也是「中间件」，但它永远在「真」那一类（mock 掉就退化成单测）；② Eureka/xxljob 是「关」不是「mock」（禁用客户端，不是替换成假对象）。

| 依赖 | 处理 | 为什么 |
|---|---|---|
| **数据库 PG** | ✅ **真**（连 dev） | 它就是被测目标 |
| 第三方 HTTP / 其他微服务 RPC / LLM | 🎭 **mock**（`@MockBean` / WireMock） | 慢、不可控、有副作用 |
| RocketMQ 发送（producer） | 🎭 **mock** `RocketMQTemplate` + `verify` | 真发会触发 dev 上真实下游消费 |
| RocketMQ 消费（consumer） | 直接调 listener，**不连 broker** | 真收到的是别人/线上的消息 |
| Redis | 缓存逻辑本身被测 → **真**；只是顺带用 → 可 mock | 取决于是不是被测目标 |
| Eureka 注册中心 | 🚫 **关闭**（`eureka.client.enabled=false`） | mock 不了，只能禁用客户端；防注册进 dev |
| xxljob / Sentinel | 🚫 **关闭** | 与被测逻辑无关，纯防副作用 |

**异步 / MQ / 事务提交后回调** 与「事务回滚护栏」额外冲突，单独说明——先分清测的是「**被触发的动作**」还是「**真实执行后的结果**」：前者 mock / 同步化纳入回滚，后者才放行真跑 + 手动善后。

| 场景 | 默认做法 | 要点 |
|---|---|---|
| 发 MQ（producer） | **mock `RocketMQTemplate` + `verify`** | 绝不真发 dev MQ——会触发下游真实消费，副作用比写库更广；只验证发了哪个 topic / body |
| 消费 MQ（consumer） | **直接调 listener 消费方法**，传入构造消息 | 不连真 broker；消费逻辑里的 DB 写仍走真库 + 回滚 |
| `@Async` / 线程池异步 | 默认**同步化**（换 `SyncTaskExecutor` 或 mock 异步 bean） | 异步线程不在测试事务里：① 读不到主线程未提交数据 ② 其写回滚不掉（真落库）。同步化后才能纳入回滚 |
| 确需验证「异步真跑完」 | **Awaitility 等待**（替代 `Thread.sleep`）+ `@AfterEach` 手动清理 | 这类**不享受回滚护栏**（异步写已落库），共享 dev 库慎用并须标注 |
| 提交后才发消息（`afterCommit` / 事务消息） | `TestTransaction` 手动提交 + 清理，或单列为不回滚测试 | ⚠️ `@Transactional` 回滚 → 永不提交 → `afterCommit` **不触发**，易漏测 |

---

## 3. 依赖清单（按 测试类型 × JDK 版本）

> 仅罗列**需要哪些依赖**，不涉及放在哪个 pom / parent。

### 3.1 单元测试依赖（两栈都需要）

| 依赖 | JDK8 / Spring Boot 2.x | JDK17 / Spring Boot 3.x |
|---|---|---|
| `spring-boot-starter-test`（含 JUnit5 + Mockito + AssertJ + spring-test） | SB 2.x 版本 | SB 3.x 版本 |
| Mockito（随上者传递） | 4.x | 5.x |
| 命名空间差异 | `javax.*`（如 `javax.servlet`） | `jakarta.*` |
| 注意 | 老项目若残留 JUnit4，需移除 `junit-vintage` 并迁移到 JUnit5 | — |

> 单测一般**只需 `spring-boot-starter-test` 一个依赖**，其余传递引入。

### 3.2 集成测试依赖（取决于第 2 节选哪个数据源方案）

| 选用方案 | 需要额外引入的依赖 |
|---|---|
| **D2 Testcontainers** | `org.testcontainers:postgresql` + `org.testcontainers:junit-jupiter`（test scope）。版本可由 Spring Boot BOM 管理；SB 较老时需显式引 `testcontainers-bom`。**JDK17/SB3.1+ 可选** `org.springframework.boot:spring-boot-testcontainers`（启用 `@ServiceConnection`，JDK8 无此项）。 |
| **D3 embedded-postgres** | `io.zonky.test:embedded-postgres`（+ Spring 集成可选 `io.zonky.test:embedded-database-spring-test`）；**arm64 Mac 需额外** `io.zonky.test.postgres:embedded-postgres-binaries-darwin-arm64v8`。版本以官方最新为准。 |
| **D1 H2** | `com.h2database:h2`（test scope）。 |
| **D4 真实库 / D5 compose** | 仅需 `org.postgresql:postgresql` 驱动（项目运行时通常已有），无需额外测试依赖。 |

> 若集成测试需 mock 外部 HTTP 服务（见 2.1），额外引入 `org.wiremock:wiremock-standalone`（或 Spring Cloud Contract WireMock）；mock Spring bean 用 `@MockBean`/`@MockitoBean` 无需额外依赖。

### 3.3 集成测试基类示例（以 D2 Testcontainers 为例，两栈通用写法）

```java
@SpringBootTest
public abstract class AbstractPostgresIT {
    static final PostgreSQLContainer<?> POSTGRES;
    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine").withReuse(true);
        POSTGRES.start();                  // 整个 JVM 共享一个容器
    }
    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
    }
}
```
> `@DynamicPropertySource` 写法 JDK8/JDK17 都能用；JDK17/SB3.1+ 可改用 `@ServiceConnection` 简化。

### 3.4 测试目录与命名规范（两栈通用）

**目录**：测试放 `src/test/java`，**镜像** `src/main/java` 的包结构（被测类同包，IDE / 插件可直接关联）；测试资源放 `src/test/resources`。

**分流后缀**：`*Test` = 单测（Surefire / `mvn test`），`*IT` = 集成测试（Failsafe / `mvn verify`）。激活 failsafe 插件后：`mvn test` 只跑单测（快、每次提交跑），`mvn verify` 额外跑集成测试（CI 全量阶段跑）。

**测试类命名**：镜像被测类全名 + 后缀，便于快速定位——
- `OrderServiceImpl` → 单测 `OrderServiceImplTest`、集成 `OrderServiceImplIT`；
- `OrderMapper` → 集成 `OrderMapperIT`（Mapper 不做单测，见 1.1）。

**测试方法命名**：`方法_条件_预期`（英文，可在 IDE 快速搜索定位）+ `@DisplayName` 中文（测试报告可读）。例：

```java
@Test
@DisplayName("库存为零时下单应抛异常")
void createOrder_whenStockZero_throwsException() { /* given-when-then */ }
```

---

## 4. Claude Code 辅助能力（初步形态）

三者分工：**Skill 判断 → Agent 生成 → Hook 兜底提醒**。

### 4.1 Skill：`test-review`（审查变更，判断测试需求）

```markdown
---
name: test-review
description: 审查当前代码变更(git diff)，依据团队测试规范判定每处变更「是否需要测试 / 哪种测试 / 旧测试是否需更新」，输出审查清单。当用户要做提交前测试检查、审查测试覆盖、或提到「测试审查 / test-review」时使用。
---
# 步骤
1. 取变更：`git diff --name-only HEAD` 与 `git diff HEAD`；无 git 则取本轮会话改动文件。
2. 每个 src/main 变更文件按「判断矩阵」分层并判断。
3. 检查对应测试是否存在、是否覆盖本次改动；改了主代码但旧测试未动 → 标「需更新」。
4. 输出表格：| 文件 | 分层 | 变更性质 | 建议测试 | 现有测试 | 结论 |
5. 询问是否调用 test-writer agent 生成/更新。
# 判断矩阵 / 红线：见团队测试规范第 1 节。
```

### 4.2 Agent：`test-writer`（按规范生成测试）

```markdown
---
name: test-writer
description: 为指定 Java 变更生成符合团队规范的单测或集成测试，并运行 mvn 验证通过。
tools: Read, Grep, Glob, Edit, Write, Bash
model: sonnet
---
你是资深 Java 测试工程师，严格遵循《团队测试规范》。
流程：
1. 读变更文件，判断分层与变更性质。
2. 按矩阵选类型：纯逻辑/Service→Mockito 单测(*Test)；Mapper/SQL→集成测试继承 AbstractPostgresIT(*IT)；Controller→@WebMvcTest+MockMvc；DTO/VO/Config→跳过。
3. 生成测试：必须有有效 AssertJ 断言；禁止 System.out / Thread.sleep / 硬编码密钥；集成测试复用基类，绝不连真实环境。
4. 运行 mvn 验证通过；失败修复后重试（≤3 次）。
5. 输出：生成文件清单 + 运行结果。
约束：只动 src/test，不改 src/main。
```

### 4.3 Hook 触发方案对比【决策点】

我之前给的 `PostToolUse + matcher:"Write|Edit"` 会**每次写文件都触发，过于频繁**。下面把所有触发时机方案列出：

| 方案 | 触发事件 | 触发时机/频率 | 打扰程度 | 最适合 | 备注 |
|---|---|---|---|---|---|
| **H1** | `PostToolUse` (matcher `Write\|Edit`) | 每次写/改文件后 | **高**（编辑过程反复触发） | 想要实时提醒 | 必须脚本过滤（仅 src/main java、排除豁免类型）降噪 |
| **H2** | `Stop` | 每轮对话结束时一次 | **低** | 轮末统一提醒 | 需追踪本轮改了哪些文件（对比 git status） |
| **H3** | `UserPromptSubmit` | 用户下次发话时 | 低 | 衔接下一轮 | 时机略滞后 |
| **H4** | `PreToolUse`（匹配 `git commit`） | 提交前拦截 | 低 | **提交关口门禁** | 只在用 Bash commit 时触发；最接近"质量门" |
| **H5** | 不用 hook，纯 skill 手动触发 | 人工调用 `test-review` | 无 | 完全可控 | 依赖人记得调用 |

**软 / 硬两档（与上面方案正交）：**
- **软提醒**：`exit 0` + 注入 `additionalContext`（不阻断，仅提示 Claude/用户）——你倾向这档。
- **硬阻断**：`exit 2` 或返回 `decision: block`（`Stop` 阻止结束、`PreToolUse` 阻止提交）——严格模式备选。

**组合建议（供参考）**：日常用 **H2（Stop 软提醒）** 主打、不打扰；想要质量门再叠加 **H4（commit 前检查）**；**H1 仅在确需实时时启用且必须脚本降噪**。

> **【团队已定】** 采用 **H2 + H4，均软档**（`exit 0` 注入 `additionalContext`，不阻断）；不启用 H1。Hook 仅做**粗判断**（改了 `src/main` 而缺对应测试就提醒），精确的分层判断交给 `test-review` skill。

### 4.4 软提醒脚本示例（以 H1 为例，字段以官方 hooks 文档为准）

```bash
#!/usr/bin/env bash
# 改了 src/main 主代码但缺对应测试时，注入提醒（不阻断）
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
case "$file" in *src/main/java/*.java) ;; *) exit 0 ;; esac
case "$(basename "$file")" in *DTO.java|*VO.java|*Entity.java|*Config.java|*Constants.java) exit 0 ;; esac
base="$(basename "$file" .java)"
testdir="$(dirname "$(printf '%s' "$file" | sed 's#src/main/java#src/test/java#')")"
if ls "$testdir/${base}Test.java" "$testdir/${base}IT.java" >/dev/null 2>&1; then exit 0; fi
cat <<EOF
{ "hookSpecificOutput": { "hookEventName": "PostToolUse",
  "additionalContext": "测试提醒：${base} 位于 src/main 但未找到 ${base}Test/${base}IT，若含逻辑/SQL/接口请按规范补测试。" } }
EOF
exit 0
```

---

## 5. 待决策项汇总（供团队沟通）

| # | 决策点 | 选项 / 结论 |
|---|---|---|
| 1 | **集成测试数据源默认方案** | ✅ **已定**：直连 Apollo DEV 共享库（D4a 受控变体），复用运行时配置，仅本地、不进 CI（详见 2.6） |
| 2 | 是否允许 D4a 真实开发库 | ✅ **已定**：是，但限本地 + 三道护栏（环境校验 / 真实数据提醒 / 事务回滚），不做无回滚真实写 |
| 3 | 集成测试**建表来源** | ✅ **已定**：无需建表——dev 库为生产同构的现成 schema |
| 4 | **Hook 触发方案** | ✅ **已定**：H2（Stop 轮末软提醒）+ H4（git commit 前软提醒），均**软档**（注入提醒、不阻断）；不用 H1。判断做粗，精确分层交给 test-review skill |
| 5 | **共享方式（两条线）** | ✅ **已定**：① Claude 资产（skill/agent/hook）做成**可分发 plugin** 统一推送；② 集成测试基类**不跨项目共享**（测试作用域限单项目），由 plugin 的 `test-writer` agent 按**统一模板**在各项目内生成自包含基类（模板是唯一事实来源；双栈各按自己的栈生成） |
| 6 | 是否引入 `@MybatisPlusTest` 数据层切片测试 | 🔶 拟定：切片 + 全量**按变更范围分流**——小改动（单 Mapper/SQL）用 `@MybatisPlusTest` 切片，大改动（跨 Service 编排）用 `@SpringBootTest` 全量；单库可切片，分库分表项目走全量。切片在 Apollo 下取数据源的行为留待落地确认 |

---

## 6. 实施路径（决策后）

1. 确定 D 方案与依赖 → 搭好集成测试基类 + 命名/分流约定（先在 1 个试点项目）。
2. 落 `test-review` skill + `test-writer` agent，跑通「审查 → 生成 → 验证」闭环。
3. 按选定的 H 方案加 hook，联调提醒体验。
4. 选 1 个 JDK17 + 1 个 JDK8 项目试点 → 修订 → 推广。
```

