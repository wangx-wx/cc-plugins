---
name: kb
description: Retrieve code knowledge across the lyy multi-project knowledge base via the `kb search` CLI (wraps graphify, emits NDJSON). Use when working in this repo (lyy-project-knowledge) or the lyy GitLab workspace and the user asks about a project's location, architecture, call paths, or blast radius — e.g. "order-query 在哪个项目", "starmind 入口怎么走", "改了 OrderService 影响谁", "BizChat 到 DashScope 的调用链", "find the project for X", "how does Y work", "what calls Z", "trace the path from A to B". Flow is always: `kb search project <keyword>` to locate the project, then `query`/`explain` to discover exact node labels, then `path`/`affected` with those labels. Prefer this over `cd <repo> && graphify query` when the project is tracked here. Triggers: "kb search", "查知识库", "项目在哪", "调用链", "影响面", "入口在哪". Do NOT use for one-off git operations or building/maintaining the knowledge base.
---

# kb —— lyy 知识库统一检索入口

封装 graphify 的**多项目检索**。输出 NDJSON（stdout 每行一个 JSON），成败靠 exit code。**本 skill 只做检索，不做建图/维护。**

## 调用方式

`kb` 不在 PATH，必须绝对路径调用（config/map 按脚本位置解析，任何 cwd 下都能跑）：

```
/Users/wangx/workspace/lyy-workspace/lyy-project-knowledge/sync-project/kb
```

**下文所有示例里的 `kb` 都是这条绝对路径的简写，实际执行时必须展开** —— 直接敲 `kb` 会 command not found。
等价长入口：`node .../sync-project/lyy.mjs kb:search <子命令>`。

## 黄金路径：定位 → 对齐节点 → 追链

这三步的顺序是这个 skill 最要紧的部分，因为跳过第 2 步会**静默地给出错误结论**。

图里有两层节点：Java AST 解析出的 **`code`** 节点，和文档语义抽取出的 **`concept`** 节点。同一个业务名在两层里常常各有一个同名节点，而**跨层之间连边稀疏**。`path` / `affected` 会替你选中其中一个，选错层就走不通——此时它不报错、exit code 仍是 0，只输出一行 `No path found`。你于是拿到一个看起来很确定的"没有关系"并据此回答用户，而换成同层的 label 一查就通。同一张 starmind 图上的实测：

| from | to | 结果 |
|---|---|---|
| `BizChatService`（code/C4） | `DashScope`（concept/C12） | **No path found** ← 跨层，假阴性 |
| `BizChatService.chat()`（concept/C12） | `DashScope`（concept/C12） | 2 hops，链路清清楚楚 |
| `BizChatService`（code/C4） | `BizChatFlowService`（code/**C13**） | 1 hop ← 同层跨 community 照样通 |

决定连通性的是 **`Type` 层，不是 community**。所以：

1. **定位项目** —— `kb search project <关键词>`，拿 `path` 字段当 `<rel>`。
2. **对齐节点** —— `kb search explain <口头名> --project <rel>`。explain 能模糊匹配，并回显它究竟选中了谁：`Node:` 真实 label、`Type:` 哪一层、`Degree:` 连了多少边。两端各 explain 一次，确认 `Type` 同层。
   拿不准该问哪个节点时，先 `kb search query "<自然语言问题>" --project <rel>` 广搜，从输出的 `NODE <label> [src=...]` 行里**原样抄** label（含括号、空格、中文、斜杠）。
3. **追链** —— 把对齐好的 label 喂给 `path` / `affected`，记得加引号防 shell 断词。

只问"X 怎么实现的"时第 2 步就够了，不必凑满三步。

## 子命令

`<rel>` = `kb search project` 返回的 `path` 字段（如 `ai/infrastructure/starmind`），**不是本地绝对路径**。

| 子命令 | 参数 | 干什么 | 专属 flag |
|---|---|---|---|
| `project` | `[关键词]`（可省=全部） | 在项目清单里模糊匹配，不调 graphify | `--path <rel>` 精确匹配单条<br>`--limit <N>` 截断 |
| `query` | `"<自然语言问题>"` | 图遍历广搜，返回相关节点+出处。最常用 | `--dfs` 深度优先追单链（默认 bfs 铺开）<br>`--budget <N>` 限 token<br>`--context <关系>` 限关系类型，可多次 |
| `explain` | `<label>` | 单节点结构化解释：源文件+行号、type、community、degree、全部邻居 | — |
| `path` | `<A> <B>` | A→B 最短路径，**方向敏感** | — |
| `affected` | `<label>` | 反向依赖传播，改动前评估波及面 | `--depth <N>` 传播深度<br>`--relation <关系>` 限关系，可多次 |

除 `project` 外都接 `--project <rel>`。`affected` 默认覆盖的关系（不传 `--relation` 时全用）：`calls, indirect_call, references, imports, imports_from, re_exports, inherits, extends, implements, uses, mixes_in, embeds`。

```bash
kb search project 订单
kb search project --path middleStage/order/order-query
kb search query "订单查询怎么走的" --project middleStage/order/order-query --dfs --budget 1500
kb search explain "BizChatService.chat()" --project ai/infrastructure/starmind
kb search affected "BizChatService.chat()" --project ai/infrastructure/starmind --depth 2
```

**省略 `--project` 会走跨项目 FTS 兜底，但项目 description 目前普遍是空的，命中率很低**（多半直接 `NO_MATCH` exit 2）。别把它当正常路径，先 `project` 定位又快又准。

## 空结果不等于"没有"

这几类输出都是 exit 0，最容易被当成权威的否定答案。**kb 会在这时追加一行 `{"type":"hint","code":"EMPTY_RESULT",...}` 指出排查方向——看到它就别急着下结论。**

| 输出 | 更可能的原因 | 怎么救 |
|---|---|---|
| `No matching nodes found.`（query） | 起点没匹配上 | 换更贴近代码词汇的问法；看 `Traversal: ... Start: [...]` 那行，它直说了从哪几个节点起跳 |
| `No node matching 'X' found.`（explain） | 名字差太远 | `query "X 是什么" --project <rel>` 广搜，从 NODE 行抄 label |
| `No path found between A and B` | 两端不在同一层；或方向反了 | 分别 `explain` 两端比 `Type`；再调换 A/B 试一次 |
| `No affected nodes found.` | 选中了同名的另一层节点；或确实是叶子 | `explain` 看 `Degree`：Degree 明显大于 0 却查不出影响面，就是选错了节点 |

确认过两端 label 与层次之后，空结果才是真结论，这时可以放心回答"没有这条链路"。

这份警惕不止对 kb 有效——**你自己写的命令同样会静默返回 0 行**。本 skill 的评测里就真栽过一次：为排掉本仓库噪声写了 `grep -rI "rest/biz/chat" . | grep -v "/starmind/"`，得到 0 命中，于是答"跨项目 0 个调用方"；而前端的网关路径正是 `/aigw/customer/starmind//rest/biz/chat`，`grep -v` 把唯一的真命中一起吃了。**要下否定结论前，把过滤器去掉再验一次**——过滤器排掉的往往正是你要找的东西。

## 检索完，顺着出处去读真代码

图是索引不是答案。结论要落到源码上，检索输出里已经给了锚点：

- `explain` 的 `Source:` —— 相对仓库根的路径。`code` 节点带行号（`starmind-starter/src/.../BizChatService.java L114`），指的是**带注解的声明起点**，`class`/方法关键字往往还在其下几行（该例真正的 `public class` 在 L117，中间隔着 3 个注解）；`concept` 节点指向文档，行号为 `None`
- `query` 每行 `NODE <label> [src=docs/llm-call-entry.md ...]` 的 `src=` —— 该节点的出处文件
- 首行 meta 的 `projectPath` —— 仓库本地绝对路径

`projectPath` + `Source`/`src=` 拼起来就是可直接 Read 的绝对路径。涉及具体实现、要给用户引用代码位置时，读一眼原文再答，别只转述节点名。

## 输出契约（NDJSON）

检索类**首行固定 `type:"meta"`**，后续是 graphify 原样文本（`Traversal:` / `NODE ...` / `EDGE ...` / `Node:` 等）——**别对整段 stdout `JSON.parse`**，按行处理，非 JSON 行按文本保留。

| `type` | 出现于 | 关键字段 |
|---|---|---|
| `project` | `kb search project` | `path` / `localPath` / `name` / `description` |
| `meta` | 检索类首行 | `command` / `project` / `projectPath` / `graphPath` + (`question`｜`target`｜`from`,`to`｜`source`) |
| `candidates` | 跨项目 ≥2 候选 | `query` / `matches[]` |
| `hint` | 紧随 candidates；或空结果末尾 | `message`，空结果时带 `code:"EMPTY_RESULT"` + `command` |
| `error` | 失败 | `code` / `message` / 常带 `suggestion` |

**exit code**（判断成败靠它，不靠文字）：

| code | 含义 | 下一步 |
|---:|---|---|
| 0 | 命令成功——**但结果可能为空**，见上一节 | — |
| 2 | 跨项目 0 候选（`NO_MATCH`） | 先 `kb search project` 拿 `--project` |
| 3 | 跨项目 ≥2 候选（**未执行查询**） | 从 `matches` 选一个，加 `--project <rel>` 重跑 |
| 4 | 该项目未建图（`NO_GRAPH`/`GRAPHIFY_FAILED`） | 建图不属本 skill——转 `kb:graphify` / `kb-enrich` skill，或直接读源码 |
| 5 | 参数错误 | 检查子命令名 / flag |
| 6 | 其他运行时（如 `EMPTY_MAP`） | 检查 `kb/project-map.json` |

## 约定路径（无需查询即可推断）

相对本仓库根 `/Users/wangx/workspace/lyy-workspace/lyy-project-knowledge`：

- 项目卡片：`kb/projects/<rel>/card.md`
- 图 JSON：`kb/projects/<rel>/graphify-out/graph.json`（存在 = 已建图）
- 可视化：`kb/projects/<rel>/graphify-out/graph.html`
- **建图清单 + 规模**：`kb/manifest.json` 的 `projects` 是 `<rel> → {stats:{nodes,edges,communities,files}, status, builtAt, sourceCommit}` 映射，**键集合就是全部已建图项目**。要判断建没建图、图多大、哪些项目可查，读它比逐个探 graph.json 快得多。
- 全量项目清单（含未建图）：`kb/project-map.json`
- 给人看：`kb/portal.html` / `kb/overview.md` / `kb/README.md`

## 何时**不**用这个 skill

| 场景 | 用什么 |
|---|---|
| 单仓库内已有 `graphify-out/`，且只问该仓库本身 | 全局 graphify skill：`graphify query` |
| 一次性 git 操作（clone/pull/branch） | 直接 `git` |
| 建图 / 补语义 / 社区命名 | `kb:graphify`、`kb-enrich` skill |

在这个仓库里默认**优先 `kb search`**，不要 `cd <repo> && graphify`——kb 已封装、跨项目、机器友好。
