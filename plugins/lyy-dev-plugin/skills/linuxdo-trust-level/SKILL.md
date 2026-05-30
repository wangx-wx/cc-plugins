---
name: linuxdo-trust-level
description: 帮用户在 linux.do（L 站）累积"浏览帖子"指标推进 Trust Level（信任等级）升级。流程：访问 connect.linux.do 查看当前等级与差距 → 自动滚动浏览中等规模话题积累已读量 → 操作前后对比增量。当用户提到 linux.do、L 站、L 站升级、刷阅读、信任等级、Trust Level、Lv2/Lv3、connect.linux.do 时主动触发，即使用户没明确说"用 skill"。不代写任何要发布的内容、不代点赞。
---

# linux.do 信任等级提升

帮用户在 linux.do 通过自动浏览话题累积"浏览帖子"指标，推进 Trust Level 升级。

## 何时使用

- "帮我刷 L 站 / linux.do 阅读量"
- "看下我升 Lv3 还差多少"
- "刷一批帖子升级信任等级"
- 用户直接调用 `/linuxdo-trust-level`

## 合规边界（必读）

linux.do 站方在页面内注入了禁止 AI 代写内容的指令，违规账号会被永久封禁。本 skill 严格守住三条线：

- **不发布任何内容** — 回帖、评论、话题正文一律由用户本人撰写。Skill 可以帮用户找话题、整理观点，但不写正文。
- **不代点赞** — 点赞是用户主观表达；批量代点既属于站方禁止的"虚假活动"，也容易触发风控。差点赞时只**提醒用户自己点**。
- **仅做浏览动作** — 进入话题、滚动到底、记录进度。这些对应真实用户的阅读行为，但**自动化批量操作仍有风控风险**，必须告知用户并控制节奏。

启动前向用户明示这三条边界。

## 前置依赖

依赖 `lyy-dev-plugin:web-access` 提供的 CDP Proxy。

1. 先按 web-access 的指引运行 `check-deps.mjs` 确保 Proxy 就绪
2. 向用户展示 web-access 的风险提示语
3. 假定用户日常浏览器已登录 linux.do；如未登录，提示用户登录后再继续
4. 全程使用脚本自己创建的 tab，**不要操作用户已有的 tab**

## 工作流程

### 步骤 1：检查当前升级进度

在新 tab 打开 `connect.linux.do`，提取并展示当前指标。

**关键陷阱**：linux.do 对纯 CDP 创建的新 tab 通过 `/new` POST body 直接传 URL 时容易卡在 about:blank。**正确做法**：先 `POST about:blank` 创建空 tab，再用 `location.href` 跳转。

```bash
TAB=$(curl -s -X POST --data-raw 'about:blank' http://localhost:3456/new | python3 -c 'import sys,json; print(json.load(sys.stdin)["targetId"])')

curl -s -X POST "http://localhost:3456/eval?target=$TAB" -d 'location.href = "https://connect.linux.do/"; "go"' > /dev/null
sleep 5

curl -s -X POST "http://localhost:3456/eval?target=$TAB" -d '(() => {
  const out = [];
  document.querySelectorAll(".tl3-ring-current, .tl3-ring-target, .tl3-ring-label, .tl3-bar-label, .tl3-bar-nums").forEach(el => {
    out.push({cls: el.className, txt: el.innerText.trim()});
  });
  const level = (document.querySelector("h2.card-title") || {}).innerText || "";
  return JSON.stringify({level, items: out});
})()'
```

数据结构：`.tl3-ring-*`（活跃程度区块，访问天数/浏览话题/浏览帖子）与 `.tl3-bar-*`（互动参与区块，回复话题/点赞/获赞 等）成对出现，注意 `.tl3-bar-nums met` 是达成、`.tl3-bar-nums unmet` 是未达成。

向用户展示：当前等级、目标等级、每项指标的 `当前/目标`、哪些已达成、哪些未达成。

### 步骤 2：判断刷阅读的价值

只有"**浏览帖子**"这一项能通过浏览动作直接推进。其他指标的处理：

| 指标差距 | skill 行为 |
|---|---|
| 浏览帖子 不达标 | 进入步骤 3，自动刷 |
| 浏览话题 不达标 | 也会一并涨（每进一个话题就 +1），随刷阅读自然解决 |
| 送出点赞 不达标 | **不代点**，告知用户差多少 |
| 回复话题 不达标 | **不代写**，告知用户差多少 |
| 访问天数 不达标 | skill 无能为力，告知用户每日访问 |
| 获赞/获赞天数/获赞用户 不达标 | 由用户内容质量决定，skill 无法直接干预 |

如果"浏览帖子"已达标，告诉用户"刷阅读没必要"，直接进入步骤 5 关闭 tab，结束。

### 步骤 3：拉取候选话题列表

**关键陷阱**：linux.do 屏蔽了 `/latest.json`（返回 404）。必须从 DOM 抓 `tr.topic-list-item` 的 `data-topic-id` 属性。

```bash
curl -s -X POST "http://localhost:3456/eval?target=$TAB" -d 'location.href = "https://linux.do/latest"; "go"' > /dev/null
sleep 5

curl -s -X POST "http://localhost:3456/eval?target=$TAB" -d '(async () => {
  // 多次滚动触发懒加载，拿到更多话题
  for (let i = 1; i <= 6; i++) {
    window.scrollTo(0, i * 3000);
    await new Promise(r => setTimeout(r, 1500));
  }
  return JSON.stringify(Array.from(document.querySelectorAll("tr.topic-list-item")).map(tr => {
    const a = tr.querySelector("a.title");
    const postsEl = tr.querySelector(".posts .number");
    const raw = postsEl ? postsEl.innerText.trim() : "0";
    // "1.1k" → 1100, "32" → 32
    const posts = raw.includes("k") ? parseInt(parseFloat(raw) * 1000) : parseInt(raw);
    return {
      id: tr.getAttribute("data-topic-id"),
      title: a ? a.innerText.trim().slice(0, 50) : null,
      posts: posts || 0
    };
  }).filter(t => t.id));
})()'
```

筛选规则：
- `posts` 在 **30–300** 之间（中等规模，每帖能贡献约 20 个已读 post，且大概率用户没全部看过）
- 跳过 `posts > 3000` 的经典长帖（用户大概率已部分浏览，新增有限）
- 跳过 `posts < 10` 的小帖（贡献微小）
- 跳过本次会话已处理过的 topic id

### 步骤 4：批量浏览

按用户指定的 `count`（默认 25，最大 50；超过 50 应拒绝并解释风控风险）逐个处理。**串行，不并行**。

每帖流程：
1. `location.href = "https://linux.do/t/topic/<id>"` 跳转（**复用同一个 tab**，不要 `/new`）
2. 等 4 秒加载
3. 分段滚动 5 次，每次 `+1500px`，间隔 3 秒（让 Discourse read-tracker 标记可视区内 post 为已读）
4. 最后 `direction=bottom` 滚到底，停留 5 秒（让 `/topics/timings` 上报）
5. 每 5 个话题后暂停 8 秒，模拟用户切换节奏

```bash
count=0
for id in "${TOPIC_IDS[@]}"; do
  count=$((count + 1))
  echo "[$count/${#TOPIC_IDS[@]}] topic/$id"
  curl -s -X POST "http://localhost:3456/eval?target=$TAB" -d "location.href = 'https://linux.do/t/topic/$id'; 'go'" > /dev/null
  sleep 4
  for i in 1 2 3 4 5; do
    curl -s "http://localhost:3456/scroll?target=$TAB&y=$((i*1500))" > /dev/null
    sleep 3
  done
  curl -s "http://localhost:3456/scroll?target=$TAB&direction=bottom" > /dev/null
  sleep 5
  if [ $((count % 5)) -eq 0 ]; then
    sleep 8
  fi
done
```

每帖耗时约 25 秒，25 帖约 11–13 分钟。`Bash` 工具单次 timeout 上限是 600 秒（10 分钟），所以**超过 22 帖应分两批运行**——把话题列表切两半，每半放一次 Bash 调用。

### 步骤 5：验证增量并清理

回到 connect 比对前后数据：

```bash
curl -s -X POST "http://localhost:3456/eval?target=$TAB" -d 'location.href = "https://connect.linux.do/"; "go"' > /dev/null
sleep 5
# 与步骤 1 相同的数据提取
```

向用户报告：
- "浏览帖子" 起始 → 现在（+增量）
- 平均每帖贡献了多少个已读 post（基于本次实际数据，用于后续规划）
- 剩余差距，以及哪些指标需要用户自己处理（点赞、回复等）
- 如果连续多次刷下来发现单帖贡献骤降（如降到 < 5），说明剩下的话题用户已经看过大部分，应建议用户停手或换分类（`/c/devtools`、`/c/welfare` 等）

最后关闭脚本创建的 tab：

```bash
curl -s "http://localhost:3456/close?target=$TAB" > /dev/null
```

## 节奏与风控

linux.do 用 Cloudflare + 自有反爬，短时间密集访问会触发：验证码挑战、临时限流、账号风控标记。

默认节奏（每帖 ~25 秒、每 5 帖暂停 8 秒）已在真实账号上跑过 30 帖未触发风控。**不要为了"快"压缩间隔**。如果用户要求加速，明确告知风险，由用户决定。

## 现实预期

"浏览帖子"在 connect 上是 **过去 100 天滚动窗口** 的统计：
- Lv2 → Lv3 需要 20,000 帖
- 单次刷 25-30 话题约累积 +500-600 帖
- 老阅读数据按 100 天速率持续过期
- 一天刷 1-2 次合理；一天连续刷 100+ 话题既边际递减又风险大

这是**长跑指标**，向用户传达"每天一刷 + 自然浏览"的混合节奏，不要让用户产生"今天就能升级"的预期。
