# 配置检查清单

> 规则编号采用 `JCR-00001` 形式递增，级别枚举：`Critical` > `Major` > `Minor` > `Info`
> 规则标题格式`规则编号 规则名称`

## 配置文件（.yml/.yaml/.properties）

### JCR-00001 明文敏感信息
- 级别：Critical
- 描述：出现明文密码/密钥/Token/AK/SK
- 修复建议：改为环境变量或密钥管理服务

### JCR-00002 生产关键配置缺少保护
- 级别：Major
- 描述：可能引入性能/稳定性问题
- 修复建议：补充注释与变更说明，必要时引入灰度/开关

### JCR-00003 默认关闭的安全配置被开启
- 级别：Critical
- 描述：引入安全漏洞
- 修复建议：保持安全默认值或补充访问控制措施

### JCR-00004 Spring Bean 覆盖开关被开启
- 级别：Critical
- 描述：`spring.main.allow-bean-definition-overriding=true` 被显式开启。该开关允许后注册的同名 Bean 静默覆盖先注册的 Bean，多数据源/多 Redis 场景下极易导致 `StringRedisTemplate`、`DataSource` 等基础设施 Bean 被错误覆盖而无任何报错，事故难以排查。Spring Boot 2.1+ 已将默认值改为 false 正是出于此考量
- 检查范围：`application.yml`/`application.yaml`/`application*.properties`/`bootstrap*.yml` 等启动配置文件
- 修复建议：删除该开关，转而通过 `@Primary` + `@Qualifier` + 显式 Bean 名称解决 Bean 冲突（联动参考 JAVA-00012）

## SQL（.sql/.ddl/.dml）

### JCR-00010 DML 无 WHERE 条件
- 级别：Critical
- 描述：UPDATE/DELETE 语句缺失 WHERE 条件，误删/误更新全表数据
- 修复建议：补充 WHERE 条件与影响评估

### JCR-00011 SELECT *
- 级别：Major
- 描述：SELECT * 查询，字段变化导致不稳定与性能浪费
- 修复建议：显式列出所需字段

### JCR-00012 DDL 破坏性变更
- 级别：Major
- 描述：DROP/TRUNCATE 或不可逆 ALTER 未提供回滚方案，数据不可恢复或迁移失败
- 修复建议：补充备份/回滚步骤或分步迁移

## 脚本（不限扩展名）

### JCR-00020 高危删除命令
- 级别：Blocker
- 描述：出现 `rm -rf /` 或对变量路径的无保护删除（如 `rm -rf $DIR`），可能导致灾难性数据丢失
- 修复建议：增加路径校验/白名单/保护开关

### JCR-00021 缺少安全执行选项
- 级别：Major
- 描述：脚本未设置 `set -euo pipefail`，错误被忽略导致不可预期行为
- 修复建议：增加严格模式并处理错误分支
