# 关于「AI Agent 是否进入了 ReAct 之后的下一阶段」的研究笔记

(这是我读了几篇论文 + 看了几个开源项目之后整理的一些笔记,准备写一篇综述)

## 背景

- 2022 年 ReAct 论文出来,定义了「Reason + Act」的循环模式:LLM 先想,然后调用工具,然后看结果,然后再想——成为 Agent 的事实标准
- 之后三年,各种 Agent 框架(LangChain、AutoGPT、CrewAI、Multi-Agent 等)本质上都是 ReAct 的变体
- 但 ReAct 有一个根本问题:每一步都需要 LLM 单独 reason 一次,token 消耗大、延迟高,而且容易陷入 loop(我在做某个数据爬虫 Agent 时遇到过,它来回切换两个工具卡了 20 步)

## 最近看到的变化

### 1. Anthropic 的 Claude Code 实践
- 它没有用经典 ReAct 循环。它更像是「LLM 直接当主控,工具调用只是 LLM 的 native 能力」
- 不需要外挂 framework,LLM 自己内部规划——这是因为模型本身的 reasoning 能力变强了
- 实测:同样任务,Claude Code 调用工具的次数比 LangChain 少 60%,但完成质量更高

### 2. OpenAI 的 Operator 和 Anthropic 的 Computer Use
- 这俩都不再走「工具调用」的范式,而是「让 AI 看屏幕、控鼠标」
- 工具变成了「电脑本身」
- 准确率还不高(Operator 大概 60-70%),但思路是革命性的——把「Agent 要做什么」从「调用 API」变成了「使用任何一个软件」

### 3. 开源界的 OpenAI Swarm 和 Magentic-One
- Swarm 是 OpenAI 在 2024 年底发布的极简 multi-agent 框架,核心思想是「agent handoff」——把任务直接传给另一个 agent,不再走中央调度
- Magentic-One 是微软的多 agent 框架,有一个 Orchestrator 角色专门做规划

## 一些观察

### 观察 1:Agent 的瓶颈正在从「调度」转移到「上下文」
以前我们觉得 Agent 难的是「怎么让它知道下一步做什么」(调度问题)。现在模型够聪明了,真正的难题变成了:**怎么让它在多步任务里记住之前所有的关键信息**。Claude 4.7 的 1M 上下文窗口、Memory MCP 这些东西,本质上都是在解决这个问题。

### 观察 2:Multi-Agent 不是因为单 Agent 不够强,而是因为「并行」
看了几个多 agent 落地的实际案例,发现真正用 multi-agent 的场景,几乎都是**并行任务**(同时调研多个方向、同时写多个章节)。串行任务用 multi-agent 反而拖慢——因为 agent 间通信本身有开销。

### 观察 3:工具的设计哲学在变
ReAct 时代,工具是给模型用的「黑盒函数」。现在的趋势是:**工具的输入输出也用自然语言**,让模型可以「读懂」结果。比如 MCP 协议设计的工具返回值,鼓励包含 explanation,而不是只返回结构化数据。

## 关键数据/引用

- ReAct 论文:Yao et al., 2022, "ReAct: Synergizing Reasoning and Acting in Language Models"
- Anthropic 在他们的 Building Effective Agents 文章中明确说:「我们不推荐多数应用用 framework,直接 prompt + tools 即可」
- Claude Code 在 SWE-bench 上的成绩:从 2024 年 6 月的 33% 提升到 2025 年的 72% (官方数据)
- 估计 2026 年会有更多「不需要 framework」的 Agent 实践

## 想表达的核心

ReAct 范式正在被淘汰。但替代它的不是更复杂的 framework,反而是**更简单的「让 LLM 自己 reason + 直接调工具」**。这个反直觉的发现,值得好好讲讲。

目标读者:对 AI Agent 感兴趣的开发者、了解过 LangChain 但觉得 over-engineering 的人、想做 Agent 应用的产品经理。
