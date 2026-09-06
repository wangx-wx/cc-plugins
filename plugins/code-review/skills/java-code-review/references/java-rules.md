# Java 规范检查清单

> 规则编号采用 `JAVA-00001` 形式递增，级别枚举：`Blocker` > `Critical` > `Major` > `Minor`
> 规则标题格式：`规则编号 规则名称`

## JAVA-00001 不必要的工作
- 级别：Critical
- 描述：存在可避免的重复计算或重复 IO 操作。典型模式：循环内执行数据库查询（N+1 问题）、循环内发起 RPC/HTTP 调用、对同一数据源的重复查询未缓存、已有批量接口却逐条调用
- 修复建议：将循环内的远程调用提取到循环外，改为批量查询后用 Map 关联；对重复计算结果做局部变量缓存

## JAVA-00002 未利用并发
- 级别：Critical
- 描述：多个相互无依赖的 IO 操作（如多个 RPC 调用、多表查询）采用顺序执行，总耗时为各操作之和，显著拉长接口响应时间
- 判定前提：**必须确认各操作之间没有数据依赖**。如果后续操作的入参来源于前序操作的返回值（链式依赖），则属于必须顺序执行的逻辑，不应标记此规则。常见的非违规场景包括：先查主记录再根据主记录字段查关联数据、先校验再操作、先获取 ID/Code 再用其查详情等
- 典型违规场景：同一方法中对不同表/服务发起多次独立查询，且查询参数均来自方法入参而非彼此的返回值（如同时查用户信息和订单统计，两者互不依赖）
- 修复建议：使用 CompletableFuture、线程池或并行流将独立操作并发执行，总耗时降为最慢操作的耗时

## JAVA-00003 内存问题
- 级别：Critical
- 描述：可能导致内存泄漏或 OOM 的代码模式。包括：无界集合持续增长（如无上限的缓存 Map）、ThreadLocal 使用后未在 finally 中 remove、流/连接等资源未关闭、一次性加载全表数据到内存
- 修复建议：集合设置容量上限或使用 LRU 缓存；在 finally 或 try-with-resources 中清理资源；大数据量场景使用分页或流式查询

## JAVA-00004 抽象泄漏
- 级别：Critical
- 描述：模块暴露了应封装的内部实现细节，或跨层直接依赖破坏了分层架构。如 Controller 直接操作 DAO、Service 返回数据库 Entity 给前端、工具类暴露内部数据结构
- 修复建议：严格遵循 Controller → Service → Repository 分层；使用 DTO/VO 隔离层间数据传递，避免 Entity 直接暴露

## JAVA-00005 Null 风险
- 级别：Major
- 描述：可能抛出 NullPointerException 的代码路径。包括：对可能为 null 的返回值直接调用方法、集合操作前未判空、Map.get() 结果未判空直接使用、链式调用中间环节可能为 null
- 修复建议：外部输入和跨层返回值做判空校验；优先使用 Optional 包装可空返回值；集合使用 CollectionUtils.isEmpty() 判空

## JAVA-00006 明文敏感信息
- 级别：Critical
- 描述：代码中以硬编码形式出现密码、数据库连接串、API Key、Token、AK/SK 等敏感凭据，存在泄露风险
- 修复建议：敏感信息通过环境变量、配置中心或密钥管理服务（如 Vault）注入，禁止提交到代码仓库

## JAVA-00007 并发安全问题
- 级别：Major
- 描述：多线程场景下的数据竞争风险。包括：共享可变状态未加同步、在并发上下文中使用 HashMap/ArrayList/SimpleDateFormat 等非线程安全类、对共享变量的 check-then-act 非原子操作
- 修复建议：使用 ConcurrentHashMap、CopyOnWriteArrayList 等并发集合替代；共享计数器使用 AtomicInteger；复合操作使用 synchronized 或 Lock 保护

## JAVA-00008 事务使用问题
- 级别：Major
- 描述：Spring 事务可能失效或使用不当。常见场景：同类内部方法调用绕过代理导致 @Transactional 失效、private 方法上标注 @Transactional、事务方法内执行耗时 IO（如 HTTP 调用）导致长事务、未指定 rollbackFor 导致受检异常不回滚
- 修复建议：确保事务方法通过代理调用；添加 rollbackFor = Exception.class；将耗时 IO 移到事务外部

## JAVA-00009 API 设计问题
- 级别：Major
- 描述：接口设计不合理影响可维护性。包括：方法参数超过 5 个未封装为对象、Controller 中编写业务逻辑而非委托 Service、返回值直接使用 Map 而非定义明确的 DTO
- 修复建议：超过 3 个参数封装为 Request DTO；Controller 仅负责参数校验和结果返回，业务逻辑交给 Service 层

## JAVA-00010 @Async 方法字段访问不一致
- 级别：Critical
- 描述：标注 `@Async` 的方法中，混用了通过 `@PostConstruct` 赋值的 static 桥接字段与 `@Autowired` 实例字段。由于 `@Async` 方法在不同线程执行，实例字段可能在代理对象未完全初始化时被访问（热部署、Bean 重载、依赖顺序异常等场景），导致 NPE。典型模式：类中既有 `public static XxxService iXxxService`（在 `@PostConstruct` 中赋值），又有 `@Autowired private YyyService yyyService`（未桥接到 static），在 `@Async` 方法中同时使用两者
- 判定条件：（以下条件全部满足时触发）1) 方法标注了 `@Async` 或被异步调用；2) 同一类中存在 static 桥接模式（`@PostConstruct` 将 `@Autowired` 字段赋值给 static 字段）；3) `@Async` 方法中直接使用了未桥接到 static 的 `@Autowired` 实例字段
- 修复建议：新增的依赖也应遵循既有 static 桥接模式（在 `@PostConstruct` 中赋值给 static 字段，方法内使用 static 引用）；或统一改为构造器注入 + 实例字段访问，彻底消除 static 桥接反模式

## JAVA-00011 @PostConstruct static 桥接遗漏
- 级别：Critical
- 描述：类使用 `@Autowired` + `@PostConstruct` static 桥接模式时，新增了 `@Autowired` 依赖但未在 `@PostConstruct init()` 方法中同步添加 static 赋值。如果该依赖会在非 Spring 管理的线程（如 `@Async`、`@Scheduled`、消息监听器）中使用，将导致 NPE
- 修复建议：每个新增的 `@Autowired` 字段，如果对应的类存在 static 桥接模式，必须在 `@PostConstruct` 中同步添加赋值；或重构为构造器注入消除 static 模式

## JAVA-00012 多实例基础设施 Bean 未显式区分
- 级别：Critical（满足全部三个条件时）/ Minor（仅条件 1+2 满足，注入点已用 `@Qualifier`）
- 描述：项目存在多个同类型的基础设施 Bean，但既未通过 `@Primary` 指定默认 Bean，也未在所有注入点使用 `@Qualifier` 显式区分。会导致 Spring 在容器中按 Bean 名称匹配，新人新增 Bean 时容易覆盖既有 Bean（如多 Redis 场景下 `StringRedisTemplate` 被覆盖），或注入到非预期实例，引发数据写入错误数据源、缓存串库等线上故障
- 适用类型清单：`RedisTemplate`、`StringRedisTemplate`、`RedisConnectionFactory`、`LettuceConnectionFactory`、`JedisConnectionFactory`、`DataSource`、`SqlSessionFactory`、`SqlSessionTemplate`、`PlatformTransactionManager`、`RestTemplate`、`WebClient`、`KafkaTemplate`、`RabbitTemplate`、`MongoTemplate`、`ObjectMapper`
- 触发条件：本次 diff 中出现"适用类型清单"中任一类型的 `@Bean` 方法、`@Configuration` 类中相关字段、或对其的 `@Autowired`/`@Resource`/构造器注入
- 检查步骤（触发后执行，缺一不可）：
  1. 使用 Grep 在整个仓库（`{repo-path}` 范围）扫描所有 `@Bean` 方法返回类型为该类型的定义，统计总数 N。模式示例：`@Bean[^)]*\)[\s\S]{0,200}(StringRedisTemplate|RedisTemplate)\s+\w+\s*\(`
  2. 若 N < 2，**不报违规**（单实例不需要 `@Primary`）
  3. 若 N ≥ 2，使用 Grep 检查这些 Bean 定义中是否有任意一个标注了 `@Primary`
  4. 使用 Grep 扫描所有对该类型的注入点（`@Autowired`、`@Resource`、构造器参数、`@Qualifier`），统计裸类型注入（未带 `@Qualifier` 且未通过字段名/参数名匹配特定 Bean 名）的数量
- 判定逻辑：
  - **Critical**：N ≥ 2 且无 `@Primary` 且存在裸类型注入点 —— 直接触发 Bean 覆盖/注入歧义风险
  - **Minor**：N ≥ 2 且无 `@Primary`，但所有注入点都使用了 `@Qualifier` —— 当前安全，但新人新增注入时极易踩坑
  - 不报：N < 2，或已有 `@Primary` 显式指定默认 Bean
- 排除场景：
  - Bean 通过 `@ConditionalOnProperty`/`@Profile` 互斥激活（同一时刻容器内只有 1 个）
  - 测试目录 `src/test/` 下的 Bean 定义
- 修复建议：
  1. 给业务最常用的那个 Bean 加 `@Primary`，使裸注入有明确默认值
  2. 所有 Bean 方法显式指定 `@Bean(name = "xxxRedisTemplate")`，避免依赖方法名隐式命名
  3. 所有注入点使用 `@Qualifier("xxxRedisTemplate")` 或 `@Resource(name = "xxxRedisTemplate")` 显式指定
  4. 切忌依赖 `spring.main.allow-bean-definition-overriding=true` 兜底（见 JCR-00004）

## JAVA-00013 Redis 全量 Key 查询或批量删除
- 级别：Critical
- 描述：禁止在生产代码中执行 Redis 全量 Key 查询或无边界批量删除。典型高危模式包括：`keys *`、`RedisTemplate.keys("*")`、通过 `delete`/`unlink` 删除匹配全部或大范围 pattern 的 key、删除全部 key，以及 `@CacheEvict(value = "multilevel:wash:**", allEntries = true)` 等对整类缓存执行全量清理的写法。此类操作可能阻塞 Redis、误删业务缓存或触发大面积缓存击穿
- 判定条件：本次 diff 中新增或修改的代码、注解、脚本字符串、常量或配置包含全量 key 查询、全量删除、按通配符大范围删除 Redis key 的逻辑时触发；若仅为测试目录 `src/test/` 下代码，不触发
- 修复建议：禁止使用 `KEYS` 和无边界通配符删除；改用精确 key、业务维度白名单、小批量 `SCAN` + 限速处理，或通过版本号/命名空间切换实现缓存失效；缓存清理必须明确影响范围并评估峰值流量

## JAVA-00014 消息消费者 info 日志输出消息体
- 级别：Critical
- 描述：Kafka、RocketMQ、RabbitMQ 等消息消费者禁止在 info 级别日志中输出完整消息体内容。消息体可能包含敏感信息，且高吞吐消费场景下会造成日志爆量、磁盘压力和检索成本上升
- 判定条件：本次 diff 中新增或修改的消息消费方法、监听器、Handler 或 Consumer 逻辑内，存在 `log.info(...)`、`LOGGER.info(...)` 等 info 级日志直接输出消息体对象、原始 payload、反序列化后的完整 DTO/JSON/XML/body/content/value 时触发
- 修复建议：info 日志只保留 traceId、messageId、topic、partition、offset、业务主键等可定位字段；完整消息体如确需排查，应降为 debug 并受日志采样、脱敏和开关控制

## JAVA-00015 消息消费者 info 日志输出消息体基本信息
- 级别：Minor
- 描述：Kafka、RocketMQ、RabbitMQ 等消息消费者在 info 级别输出消息体大小、编码、摘要、schema、字段数量等基本信息时，需要提醒评估消息量。若消费量较大，持续 info 日志仍可能造成日志噪声和存储成本
- 判定条件：本次 diff 中新增或修改的消息消费逻辑内，`log.info(...)` 输出的是消息体元信息而非完整内容，如 body size、payload length、encoding、charset、schema、摘要 hash、字段数量等时触发；若已明确使用采样、限频或仅异常/低频路径输出，可不触发
- 修复建议：评估 topic/consumer 的日均与峰值消息量；高频消费者建议降为 debug、采样输出、按异常场景输出，或仅保留关键链路定位字段

## JAVA-00016 禁止使用 fastjson
- 级别：Critical
- 描述：禁止使用 `com.alibaba.fastjson`（fastjson 1.x）工具包。该库历史反序列化漏洞频发，autoType 多次被绕过导致远程代码执行（RCE），相关 CVE（如 CVE-2022-25845）至今仍有利用风险，且 1.x 已停止维护。注意：`com.alibaba.fastjson2` 是官方推出的安全升级版，不在此规则禁止范围内
- 判定条件：本次 diff 中新增或修改的代码出现 `com.alibaba.fastjson.` 包下的 import（如 `com.alibaba.fastjson.JSON`、`com.alibaba.fastjson.JSONObject`）或相关 API 调用（`JSON.parseObject`、`JSON.toJSONString`、`JSONObject`、`JSONArray` 等）时触发；`com.alibaba.fastjson2.` 不触发
- 修复建议：迁移到安全的 JSON 库——优先使用项目已集成的 Jackson（`ObjectMapper`）或 Gson；若需保持 fastjson API 风格，可升级到 `com.alibaba.fastjson2`
