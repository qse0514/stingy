# Week 10 · Day 4 提问日志

> 用途：每天记录效涵问过的问题，当天结束时基于这个清单做复盘 quiz。
> 规则：问过 = 薄弱点，复盘必考。

## 今日问题清单

| # | 问题 | 涉及知识点 | 一句话答案 |
|---|------|-----------|-----------|
| 1 | 为什么 `setMessages([...messages, newMsg])` 不能写成 `messages.push()`？（Day 3 讲过，今天忘了）| ⚛️ React 引用比较 | React 只比引用不比内容；push 不换引用 → 不重渲染 |
| 2 | 气泡为什么要两层 div？ | 🎨 Flexbox 分工 | 外层管对齐（justify-end），内层管长相；对齐是父容器的事 |
| 3 | `map()` 怎么用？`msg` 和 `index` 是预设的吗？ | 🟡 数组方法 | 位置预设（第1=当前项，第2=序号），名字随便起 |
| 4 | `import 'dotenv/config'` 是什么？ | 🟢 副作用导入 | 不导值只执行模块，同款语法：`import './index.css'` |
| 5 | import 写 `chat.js` 但文件是 `chat.ts`，为什么？ | 🔵 ESM + TS 规矩 | ESM 模式 import 路径写编译后的文件名，一律 `.js` 后缀 |
| 6 | 为什么是 `process.env.PORT`？`.PORT` 是 convention 吗？ | 🟢 Node 全局对象 | process = Node 的 window；PORT 是自己在 .env 起的名，非魔法；全大写是惯例 |
| 7 | `client.chat.completions.create` 是什么？参数是什么规矩？ | 🤖 LLM API 调用 | SDK 的命名空间映射 REST 端点；参数 = 请求体字段，由 API 文档定义 |
| 8 | 怎么知道 SDK 该写什么？需要自己把 URL 翻译成对象吗？ | 🤖 SDK 使用方法 | 不靠自己推导：抓官方文档示例 + 靠 TS 自动补全探索 |
| 9 | `streamChat` 这个函数整体到底干了什么？ | 🤖 service 层职责 | 收对话历史 → 发请求给 DeepSeek → 返回一个"流"（不等完整答案） |
| 10 | 每次调用都把整个对话发给 DeepSeek？（Day 3 讲过无状态，再次确认） | 🤖 LLM 无状态 | 对，全量历史每次都发；对话越长 payload 越大 → 引出 Context 优化话题 |
| 11 | 全量重发会不会越来越慢？ | 🤖 LLM 性能 | 会变慢但是缓慢增长（首 token 延迟↑）；真正先爆的是钱包和 context 上限 |
| 12 | 你的数据多新？DeepSeek 新模型 context 不止 64K 吧？ | 🤖 事实核查 | 学员质疑正确：查证后确认新模型已到 128K+；教训：模型参数过期快，以官方 API 文档为准 |
| 13 | `data: [DONE]` 怎么就知道是结束？是 OpenAI 的 convention 吗？ | 🤖 自定义协议 | [DONE] 本身无魔法，是前后端自己约定的暗号；确实借用了 OpenAI 的惯例 |
| 14 | `res.write` 写到哪里去了？`data:` 前缀又是从哪来的？ | 🤖 SSE 管道 | res = 连接本身，write 直接把字节推给浏览器；`data:` 是 SSE 信封格式，前端拆信封取内容 |
| 15 | Harness 到底是什么意思？ | 🤖 核心概念 | 原意马具；工程上 = 裸 LLM 周围让它能干活的全部工程层（今天写的每一行后端都是） |

## 复盘状态

- [x] 当日复盘 quiz 已完成（6 题：2✅ 3🟡 1❌）
- 明早重考清单：
  - ❌ 二分法排查（名字+思路，已两次接触仍未记住）
  - 🟡 副作用导入的名字
  - 🟡 为什么连 AI 自己的回答也要发回去
  - 🟡 token 与计费的关系
