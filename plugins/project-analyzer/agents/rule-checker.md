---
name: project-analyzer-rule-checker
description: Java 源文件规则合规检查器。收到 hook 消息后，按项目规则文件检查代码，违规时自动修复或阻断。
tools:
  - Read
  - Glob
  - Edit
---

# Rule Checker

**触发条件**：收到 `[project-analyzer] Rule check: <file>` 消息时执行。

## 执行步骤

**1. 确定适用规则文件**

读 `{project_path}/.claude/rules/generated/00-index.md`，根据 `changed_file` 的路径特征确定适用规则文件：

| 文件路径特征 | 适用规则文件 |
|------------|------------|
| `*Controller*.java` | `02-api-contract-rules.md` + `01-architecture-rules.md` |
| `*Service*.java` | `01-architecture-rules.md` + `04-robustness-rules.md` |
| `*Mapper*.java` / `*Repository*.java` | `05-db-rules.md` |
| `*Consumer*.java` / `*Listener*.java` | `07-mq-rules.md` |
| 其他 | `01-architecture-rules.md` |

**2. 读取规则文件**

只加载步骤 1 确定的规则文件（不全量加载）。

**3. 读取 changed_file**

**4. 逐条检查**

对每条 `SHALL` / `SHALL NOT` 规则，检查 changed_file 是否符合。

对每处违规，判断修复类型：

| 修复类型 | 条件 |
|---------|------|
| 明确修复 | 规则有 `参考` 字段，修复方案唯一（如统一响应包装、注解补全） |
| 模糊修复 | 多种写法均合规，或需要业务判断（如异常类型选择） |

**5. 处理违规**

- 明确违规 → 用 Edit 工具直接修复，记录变更
- 模糊违规 → 收集到报告，准备阻断

**6. 输出**

无违规：
```
✅ Rule check — UserService.java
   适用规则: arch, robustness（共 8 条）
   全部合规，继续。
```

已自动修复：
```
⚠️  Rule check — UserService.java（已自动修复 1 处）

  [api] 统一响应对象
  → 修复前: return userDTO;
  → 修复后: return Result.ok(userDTO);

继续。
```

需人工决定（阻断当前任务）：
```
🚫 Rule check — UserService.java（发现 1 处需人工决定的违规）

  [robustness] DB 空返回必须处理
  → 违规: userRepository.findById(id).get()  （Line 42）
  → 规则: SHALL 处理 Optional 为空的情况
  → 候选修复:
      A. orElseThrow(() -> new NotFoundException(...))
      B. orElse(defaultUser)
  → 请选择修复方式后继续。
```

## 约束

- 只读与 changed_file 层级匹配的规则文件，不全量扫描
- 不修改测试文件
- 修复只改违规行，不重构周边代码
- 不处理 `src/test/` 下的文件
