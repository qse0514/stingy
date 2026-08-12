# 📖 学习手册 · 真实 LLM 流式链路（后端半程）

> 来源：Week 10 Day 4 · Stingy 项目
> 定位：理论 + 标准用法 + 自测题。以后写类似代码时直接翻这本，不用翻聊天记录。

---

## 第 1 章 · messages 数据结构与 LLM 无状态

### 理论

- 一场对话 = 一个按时间排序的数组：`{ role, content }[]`
- **LLM API 是无状态的**：服务器处理完请求即忘记你。"会话感"是前端 messages 数组维护出来的假象
- 因此每次请求必须携带**完整历史，包括 AI 自己说过的话** —— 否则 AI 对自己的上一轮回答毫不知情（"人格分裂"）

### 标准用法

```ts
type Role = 'user' | 'assistant';        // 联合类型 = 白名单，typo 编译期爆炸
interface Message { role: Role; content: string; }
```

- 前后端各放一份**完全一致**的类型文件，形状对齐
- role 永远不要用 `string` —— `'uses'` 这种 typo 会安静溜到运行时才炸

### 推论（因果链，背这条）

> 无状态 → 全量重发 → 对话越长 token 越多 → 越聊越贵 + 撞 context 上限
> → 所以"Context 优化"（截断/摘要/滑动窗口）是一个必然存在的工程话题

缓冲垫：输入是并行处理的（长历史 ≠ 等比变慢）；DeepSeek 有前缀缓存（重复历史打约 1 折）。

### 自测

1. 聊到第 10 轮，请求里带几条消息？为什么 AI 的话也要发回去？
2. `role: string` 和 `role: Role` 的差别会在什么时机暴露 typo？

<details><summary>答案</summary>

1. 19 条（10 user + 9 assistant）。LLM 无状态，连自己说过的话都不记得，不发回去它就不知道自己上轮说了什么。
2. `Role` 联合类型在**编译期**画红线；`string` 要等**运行时** API 报错才发现——类型是提前爆炸的炸弹。
</details>

---

## 第 2 章 · 后端分层标准（LLM 版 4 层架构）

### 理论

Notes API 的分层原样迁移，只是 service 底下从 MySQL 换成了 LLM：

| 层 | 职责 | 不该知道的事 |
|---|---|---|
| routes | 认路：URL → controller | 业务逻辑 |
| controllers | 校验输入、管响应（含 SSE）、接水泼水 | LLM 是哪家的 |
| services | **唯一**跟外部系统（DeepSeek）说话的层 | 谁在调它、前端长什么样 |
| types | 前后端共享的形状 | — |

**service 层的回报**：换 LLM 供应商 = 只改 service 里两行（apiKey + baseURL），上层全部无感。与"换 MySQL 前端没改"同一原理。

### 标准用法

```ts
// routes：路径写 '/'，前缀由挂载点给
app.use('/api/chat', chatRouter);   // index.ts
router.post('/', handleChat);       // routes/chat.ts —— 写 '/api/chat' 会变成双重前缀

// controller 第一件事永远是校验（不信任任何输入）
if (!Array.isArray(messages) || messages.length === 0) {
  return res.status(400).json({ error: '...' });
}
```

### 自测

1. 想从 DeepSeek 换成 Qwen，要改哪几个文件的哪几行？
2. `router.post('/api/chat', ...)` 错在哪？

<details><summary>答案</summary>

1. 只改 `services/llm.ts`：baseURL 一行 + model 名一行（key 在 .env 换）。
2. index.ts 挂载时已给前缀，真实路径会变成 `/api/chat/api/chat`。
</details>

---

## 第 3 章 · 环境变量与 API Key 安全标准

### 理论

- **key = 钱**。泄漏到公开仓库几分钟内被爬虫扫走盗刷
- `process` 是 Node 的全局管家（≈浏览器的 `window`）；`process.env` 是环境变量对象
- dotenv 的工作：读 `.env` 文本 → 解析 → 塞进 `process.env`

### 标准用法（四条铁律）

1. `.env` 必进 `.gitignore`；仓库只放 `.env.example` 模板
2. `import 'dotenv/config'` 放 **index.ts 第一行**（import 从上往下执行，晚了下游读到 undefined）——这是**副作用导入**：不导值只执行，同款语法 `import './index.css'`
3. 环境变量命名：全大写 + 下划线（`DEEPSEEK_API_KEY`），Unix 传统
4. `process.env.X` 读出来**永远是字符串**，要数字自己 `Number()`

### 自测

1. "副作用导入"是什么意思？为什么 dotenv 必须第一行？
2. `.env` 里写 `PORT=3001`，`process.env.PORT === 3001` 是 true 吗？

<details><summary>答案</summary>

1. 不导入任何值、只执行模块代码的 import。因为 import 按顺序执行，dotenv 晚于使用方就会读到 undefined —— 先装子弹再掏枪。
2. false。读出来是字符串 `'3001'`，`===` 数字不成立。
</details>

---

## 第 4 章 · ESM + TypeScript 工程规矩

### 标准配置对照表（背这张）

| 场景 | moduleResolution | import 相对路径 |
|---|---|---|
| client（Vite 打包） | `bundler` | 不写后缀 |
| server（Node 直跑 ESM） | `NodeNext` | **必须写 `.js`**（映射到 .ts 源文件）|

### 理论

- ESM 规矩：import 路径写**运行时真实存在**的文件名 —— TS 编译后只剩 `.js`
- `.js → .ts` 的映射是 `NodeNext` 模式的功能；`bundler` 模式不认识 → 报 `Cannot find module`

### 关键陷阱：运行时 ≠ 类型检查

今天真实发生：`tsx` 跑得好好的（curl 都出结果），`tsc`/IDE 却报找不到模块 —— 两者用了不同的解析规则。

**判断标准**：拿运行时证据反推报错性质（"真缺模块 curl 怎么会通？"）。IDE 红线 ≠ 程序坏了，但必须修到两边一致。验证命令：`npx tsc --noEmit`。

### 自测

1. server 里 `import ... from '../types/chat.js'`，磁盘上根本没有 chat.js，为什么合法？
2. curl 正常但 IDE 报 Cannot find module，第一反应是什么？

<details><summary>答案</summary>

1. NodeNext 模式下 `.js` 后缀映射到 `.ts` 源文件；写 `.js` 是因为运行时（编译后）它就叫 chat.js。
2. 运行时和类型检查规则不一致（大概率 tsconfig 配置），不是代码真缺东西——运行时证据优先。
</details>

---

## 第 5 章 · OpenAI 兼容 SDK 标准用法

### 理论

- **SDK = HTTP 请求的外套**：`client.chat.completions.create({...})` 背后就是 `POST {baseURL}/chat/completions`，参数对象 = 请求体 JSON
- **OpenAI 接口格式是行业事实标准**：DeepSeek/Qwen/Moonshot 全部兼容 → 用 OpenAI SDK + 改 baseURL 即可调任何一家（USB-C 效应）

### 标准用法

```ts
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});
const stream = await client.chat.completions.create({
  model: 'deepseek-chat',   // 必填：点名模型
  messages,                 // 必填：完整历史
  stream: true,             // 流式开关；false = 憋完整答案一次给
});
```

### 方法论（比 API 本身重要）

1. **第一次用**：抄官方文档 Quick Start，没人背 API
2. **日常用**：TS 自动补全探索（敲 `client.` 看菜单；参数框里 Ctrl+Space）
3. **模型参数（context 大小/价格/模型名）几个月过期一次**：只信官方 API 文档当天页面，不信任何人的记忆（包括 AI 老师的）

### 自测

1. `stream: true` 和 `false` 各返回什么？
2. 不确定 create() 支持哪些参数，两个标准动作是什么？

<details><summary>答案</summary>

1. true → 流对象（异步可迭代，"水管"）；false → 完整回答（"盒饭"）。
2. 查官方文档；或在参数对象里按 Ctrl+Space 看 TS 类型菜单。
</details>

---

## 第 6 章 · 流式转发：两段流 + SSE 协议 ⭐ 今日核心

### 理论：链路上有两段独立的流

```
第一段：DeepSeek ══▶ server    SDK chunk 对象，for await...of 接
第二段：server ══▶ 前端        SSE 文本信封，res.write 发

controller = 中转站：左手接一块，右手立刻泼一块，不存不等
```

### SSE 信封格式（协议规定，不是我们发明）

```
data: 内容\n\n
 ↑固定前缀    ↑两个换行 = 一条消息结束
```

### 应用层暗号（我们定义，借 OpenAI 惯例）

- `data: [DONE]` = 正常结束；`data: [ERROR]` = 出事了
- `[DONE]` 本身零魔法 —— 靠前端一句 `if (data === '[DONE]')` 兑现。**协议 = 前后端的合同**，与 Notes API 约定错误格式 `{ error }` 同理

### 标准代码模板（controller）

```ts
// ① SSE 三件套响应头
res.setHeader('Content-Type', 'text/event-stream');
res.setHeader('Cache-Control', 'no-cache');
res.setHeader('Connection', 'keep-alive');

// ② 接流 → 泼流
for await (const chunk of stream) {
  const text = chunk.choices[0]?.delta?.content ?? '';  // 见下方防御说明
  if (text) res.write(`data: ${JSON.stringify(text)}\n\n`);
}
res.write('data: [DONE]\n\n');
res.end();

// ③ catch：console.error 记日志 + data: [ERROR] + res.end()，不留僵尸连接
```

### 两个必懂细节

**`?.delta?.content ?? ''` 为什么层层防御**：流的第一块/最后一块往往没有 content（角色声明/结束信号），裸取会炸。可选链停住 + `??` 兜底。

**res.write vs res.json**：
> `res.json()` = 发短信，一次性发完即结束
> `res.write()` × N = 打电话，说一句对方听一句，`res.end()` 才挂断

**token 实感**：`"DeepSeek"` 到达时被切成 `Deep`/`Se`/`ek` 三块 —— LLM 按 token 生成，输入+输出都按 token 计费。

### 自测

1. 为什么说链路上有两段流？各自的格式和接法？
2. `data:` 前缀谁规定的？`[DONE]` 谁规定的？
3. `res.write` 写出去的字节去哪了？

<details><summary>答案</summary>

1. DeepSeek→server（SDK chunk，for await 接）；server→前端（SSE 文本信封，res.write 发）。
2. `data: ` 是 SSE 协议标准；`[DONE]` 是我们自定的应用层暗号（借 OpenAI 惯例），靠前端 if 判断兑现。
3. 立刻顺着打开着的 HTTP 连接飞到对端——res 就是连接本身的话筒，不存在中间暂存。
</details>

---

## 第 7 章 · Debug 标准流程（今日实战两例）

### 二分法排查 ⭐（已欠考两次，重点背）

> 链路长、不知道哪坏了 → **从中间切一刀**，先确定问题在哪半边。

今日实例：`[ERROR]` → 绕过自家代码裸 curl DeepSeek → 402 Insufficient Balance → 结论：代码清白，账户没钱。30 秒定位。

记忆钩子：修水管不用每节都拆，中间拧开看有没有水。Week 8 查 supermatch"先确认后端数据"= 同一招。

### 配套铁律

1. **日志优先**：catch 里必须 `console.error`，真相永远先看 server 终端
2. **错误也要体面**：出错时发 `[ERROR]` + `res.end()`，不崩、不挂死、不留僵尸连接
3. **HTTP 402** = Payment Required，最诚实的状态码：给钱

### 自测

1. 线上 LLM 功能挂了，你手上有 key，第一刀切在哪？
2. 为什么 catch 里发完 `[ERROR]` 还要 `res.end()`？

<details><summary>答案</summary>

1. 绕过自家代码，拿 key 直接 curl LLM API——立刻分清"我方代码问题"还是"供应商/账户问题"。
2. 不 end 连接就一直挂着（僵尸连接），前端傻等，服务器资源泄漏。
</details>

---

## 第 8 章 · React 引用身份（今日复现的老知识）

### 一句话

> **React 不比内容，只比引用。引用就是身份证。**

```ts
messages.push(x);                 // ❌ 内容变了引用没变 → React 认为没变 → 不渲染
setMessages([...messages, x]);    // ✅ 新数组新引用 → 触发渲染
```

### 双向陷阱（同一知识点的两个方向）

| 方向 | 症状 | 实例 |
|---|---|---|
| 引用该变而没变 | 数据加了 UI 不动 | push 直接改数组 |
| 引用不该变而狂变 | 无限循环 / #185 | 内联箭头函数进 callback ref、默认参数进依赖数组 |

### 附：map 的规矩

`arr.map((item, index) => ...)` —— **位置预设**（第1=当前项，第2=序号），**名字随意**。map 天生返回新数组（React 友好），原数组不动。

---

## 附 · 今日移动端 UI 标准（SmartShot 侧线沉淀）

1. **iOS 安全区规则**：底部无按钮的页面不留 safe area 白条；有吸底按钮的页面由按钮容器自己预留 `env(safe-area-inset-bottom)`
2. **点击热区标准**：可点元素 ≥ **44pt**（Apple HIG）。图标太小时用 **padding + 负 margin** 扩热区：视觉零变化、无 z-index 管理、热区永不错位 —— 优于叠透明盒子
3. **最小改动原则**：改配置前先查"谁真正依赖它"，列出**刻意不动清单**，零波及交付

---

## 🔴 明早重考清单

1. 二分法排查：名字 + 思路 + 今日实例（❌ 已欠两次）
2. 副作用导入的名字 + 前端同款语法（🟡）
3. 为什么 AI 自己的回答也要发回去（🟡）
4. token 与计费的关系（🟡）
