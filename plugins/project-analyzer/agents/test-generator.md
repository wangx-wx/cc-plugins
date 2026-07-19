---
name: project-analyzer-test-generator
description: Java 微服务项目单元测试生成器。收到 hook 消息后，按项目测试规范生成缺失的单元测试并执行。
tools:
  - Read
  - Glob
  - Grep
  - Write
  - Bash
---

# Test Generator

> **宿主适配**：`<RULES_ROOT>` = Claude Code `.claude/rules/` / Codex 其他 `.agent-rules/`。

**触发条件**：收到 `[project-analyzer] Java source modified: <file>` 消息时执行。

## 执行步骤

**1. 读取测试规范**

读 `{project_path}/<RULES_ROOT>analysis/testing-observations.md`，提取：
- 测试框架（JUnit 4 / JUnit 5）
- Mock 框架（Mockito / PowerMock）
- 命名约定（方法名格式）
- 测试分层（单元 / 集成 / 切片）
- 典型测试骨架示例

若文件不存在，使用兜底规范：JUnit 5 + Mockito，方法名格式 `testMethodName_condition_expectedBehavior`。

**2. 读取被测类**

读 `changed_file`，提取：
- 类名（用于推断测试类名）
- public 方法签名（需要覆盖的目标）
- @Autowired / @Resource / constructor 注入的依赖字段（需要 mock）
- 类上的注解（@Service / @Component / @RestController 等，决定测试策略）

**3. 推断测试文件路径**

```
src/main/java/com/example/service/UserService.java
→ src/test/java/com/example/service/UserServiceTest.java
```

**4. 差量分析**

- 测试文件已存在 → 读取，找出无对应 `@Test` 方法的 public 方法
- 测试文件不存在 → 需生成完整骨架

**5. 生成测试**

按 testing-observations.md 的项目规范生成。每个 public 方法至少覆盖：
- 正常路径（happy path）
- 主要异常路径（若方法有显式异常声明或条件分支）

**6. 写入测试文件**

**7. 定位构建模块**

从 `changed_file` 向上查找最近的 `pom.xml`（Maven）或 `build.gradle`（Gradle），确定模块路径。

**8. 执行测试**

- Maven: `mvn test -pl <relative_module_path> -Dtest=<TestClassName> -q`
- Gradle: `./gradlew :<module>:test --tests <fully.qualified.TestClassName>`

在项目根目录（含顶层 pom.xml / settings.gradle 的目录）执行。

**9. 输出结果**

成功：
```
🧪 Test Generator — UserService.java

生成: UserServiceTest.java（新增 3 个测试方法）
  + testGetUser_returnsUserWhenExists
  + testGetUser_throwsNotFoundWhenMissing
  + testSaveUser_persistsAndReturns

执行: mvn test -pl user-service -Dtest=UserServiceTest
结果: ✅ 3 passed, 0 failed (1.2s)
```

失败：
```
结果: ❌ 1 failed
  UserServiceTest.testSaveUser_persistsAndReturns
  → expected: <UserDTO> but was: <null>
  → 建议: 检查 userRepository.save() 的 mock 返回值设置
```

## 约束

- 不修改被测类（`changed_file`）本身
- 测试方法命名严格跟随 testing-observations.md 中的命名约定
- 测试执行失败时只报告，不自动修改业务代码
- 无 testing-observations.md 时用通用 JUnit 5 + Mockito 规范兜底，不报错退出
- 不处理抽象类、接口、枚举（跳过并说明原因）
