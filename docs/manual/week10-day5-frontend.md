# 📖 学习手册 · Week 10 Day 5 · 前端全集（流式渲染 + 界面打磨）

> 来源：Week 10 Day 5 · Stingy 项目（姊妹篇：Day 4 后端半程手册）
> 里程碑：🏁 全链路闭环 —— 浏览器实测"输入 → Express → DeepSeek → SSE 流回 → 打字机"
>
> 当日成果清单：
> - ✅ 前端流式渲染走通 + 真打字机验收（催了 4 次才去浏览器那次）
> - ✅ system prompt 后端就位（Stingy 人设，services 层）
> - ✅ Markdown 渲染（react-markdown，`**` 不再裸奔）
> - ✅ 自动滚动（视口钉在打字机上）
> - ⏳ 欠账：`res.body!` 改正经检查（见文末待办）

---

## 第 1 章 · 前端分层标准

### 理论

| 层 | 职责 | 后端对应 |
|---|---|---|
| `components/` | 长相：渲染 + 接用户事件，零逻辑 | controllers |
| `hooks/` | 逻辑：fetch/读流/拆信封/state 全部脏活 | **services** |
| `types/` | 形状：前后端对齐 | types |
| `App.tsx` | 组装：拼零件，不写逻辑不写具体 UI | routes |

### 标准用法（三条搬家原则）

1. state 住得离使用者越近越好（input 半成品文字 → ChatInput 自己家）
2. 长相层只拿回调（ChatInput 只知道 `onSend(text)`，不知道 fetch 存在）
3. hook 只导出"数据+动作"（`{ messages, sendMessage }`），setMessages 藏住不给外面乱改

**回报**（第三次验证）：换通信方式只改 useChat，组件一行不动 —— 换 MySQL / 换 LLM / 换 SSE，同一个道理。

### 自测

1. 四层各叫什么？哪层 ≈ 后端 service？
2. 为什么 setMessages 不从 useChat 导出？

<details><summary>答案</summary>

1. components（长相）/ hooks（逻辑）/ types（形状）/ App.tsx（组装）。hooks ≈ service —— 唯一跟后端说话的层。
2. 强制外部只能走 sendMessage 改数据，规矩收口在一个地方，没人能绕过。
</details>

---

## 第 2 章 · fetch 流式标准姿势

### 理论：信封不是信

`await fetch()` 在**响应头到达的瞬间**就返回了 —— 此刻 body 内容可能一个字都没来：

```
res.status / res.ok / res.headers   ✅ 立刻到手（信封）
res.body                            ⏳ 只是取水把手，内容还在路上（信）
```

- `res.json()` = 把 body 流读干+拼起来+parse 的快捷方式（Week 2 一直在用流而不自知）
- 流式必须放弃快捷方式，手动拿把手：`res.body!.getReader()`
- EventSource 用不了：只能 GET，POST 不了 messages 数组

### 两个关键 API

```ts
const reader = res.body!.getReader();
// 🤖 锁住流拿独占把手：一条流只能一个读者，锁了之后 res.json() 会报 locked
// 🤖 流 = 一次性电影票：流过就没了，不能回头重读

const decoder = new TextDecoder();
// 🟡 字节(Uint8Array) → UTF-8 文字的翻译官
// 🟡 ⚠️ 必须循环外建一次：它有记忆 —— 中文字3字节可能被分块切半，
//    半个字攥它肚子里等下一块（配合 stream:true）。换新的=半个字丢了=乱码�
```

### 陷阱：setState 之后立刻用 state = 旧快照

> **setState 是"下单"不是"到货"** —— 本次函数执行里读到的 state 永远是旧的。

标准解法"一鱼两吃"：

```ts
const newMessages = [...messages, userMsg]; // ① 造进普通变量（立即可用）
setMessages(newMessages);                   // ② 一吃：给 React 渲染
fetch(..., { body: JSON.stringify({ messages: newMessages }) }); // ③ 二吃：发后端
```

### 自测

1. `await fetch()` 返回的时刻，后端执行到哪了？
2. 为什么 TextDecoder 不能在循环里 new？

<details><summary>答案</summary>

1. 后端刚发完响应头（setHeader 后），body 可能还没写任何数据。
2. 它有记忆：跨块被切半的中文字节攥在肚子里等拼接，换新实例半个字就丢了（乱码）。
</details>

---

## 第 3 章 · 读流循环 + SSE 拆信封 ⭐ 核心模板

### 层级模型（背这个）

```
一条流（整个回答）
  └─ 一桶水（reader.read() 一次，网络随机切，不看任何边界）
       └─ 一封信（data: 内容\n\n = 一条SSE消息 = 后端一次 res.write）
            └─ 信的内容（LLM 吐的一块 token）
桶和信不对齐 → buffer 存在的全部理由：把桶重新拼成信
```

### 标准代码模板

```ts
setMessages((prev) => [...prev, { role: 'assistant', content: '' }]); // 先挂空气泡
let buffer = '';

while (true) {
  const { done, value } = await reader.read();  // 泵一桶
  if (done) break;                              // 井干了（后端 res.end）
  buffer += decoder.decode(value, { stream: true }); // 字节层防切半个字

  const lines = buffer.split('\n\n');  // 按封口切信
  buffer = lines.pop()!;               // 信封层防切半封信：残尾塞回等下一桶
  // pop = 双重动作：从数组移除末项 + 返回它
  // 尾巴是半封信→保住；恰好切齐→空串，无害。一行兜两种情况

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6);                   // 撕掉 'data: '（6字符）
    if (data === '[DONE]') break;                 // 暗号：正常结束
    if (data === '[ERROR]') { /* updateLast 换错误提示 */ break; }
    const text = JSON.parse(data); // 后端 stringify 过：防内容里的\n\n炸信封
    setMessages((prev) => appendToLast(prev, text)); // 打字机的一声"嗒"
  }
}
```

### 打字机的真相

今天**没写 setInterval** —— 生成+网络的节奏就是打字节奏，每封信到 setState 一次。
Week 6 的是假打字机（字全在手上，演出来的慢）；真流式不需要演。

### 自测

1. buffer 防什么？decoder 的 stream:true 防什么？
2. 后端为什么要 JSON.stringify 再发？

<details><summary>答案</summary>

1. buffer 防"信被桶切半"（信封层）；stream:true 防"中文字被桶切半"（字节层）。同一哲学两层：流式世界数据以任意方式碎裂。
2. 内容里若有 \n\n 会被误判成封口把消息切碎；stringify 把换行转义，保证一封信永远一行。
</details>

---

## 第 4 章 · React 不可变更新（连环 setState 版）

### 两条升级规则

**规则 1：循环/连续更新必须函数式**

```ts
setMessages((prev) => ...) // "React，拿你手上最新的值给我算"
// 用 [...messages, x] 会基于函数开始时的旧快照，字互相覆盖
```

**规则 2：改嵌套数据 = 一路新到底**

```ts
// ❌ prev[prev.length-1].content = text   ← push 的近亲：改旧对象引用不变
// ✅ map + 展开：
prev.map((msg, i) =>
  i === prev.length - 1 ? { ...msg, content: msg.content + text } : msg
);
// 只有最后一项造新对象（...msg 摊开旧字段，content 后写的赢），其余原样
```

### 边界澄清

**"不可变"是 state 的规矩，不是所有数组的规矩** —— `lines.pop()` 直接改 lines 完全没问题，它只是局部临时变量。

### 自测

1. 什么时候必须用 `(prev) =>` 函数式更新？
2. `{ ...msg, content: text }` 里如果 Message 以后加了 timestamp 字段，这行要改吗？

<details><summary>答案</summary>

1. 循环或短时间内连续多次 setState 时——否则每次都基于同一份旧快照。
2. 不用。...msg 自动摊开全部字段，新字段自动带上——这就是用展开而不是手写字段的原因。
</details>

---

## 第 5 章 · system prompt 与三种 role

### 理论

messages 的第三种 role：`system` = 幕后导演的字条 —— 发给模型但不显示在界面，定人设/规矩/边界。

**没有 system prompt 的真实后果**（当日实测）：AI 自称 DeepSeek 官方 App，幻觉了一堆自己没有的能力（搜网页/读文件）—— 模型不知道自己是谁时，按训练数据里最常见的场景瞎猜。

### 标准用法

```ts
// 🤖 放【后端】services 层，不放前端：
const SYSTEM_PROMPT = {
  role: 'system' as const,
  content: '你是 Stingy，一个精打细算的记账助手。用简短、口语化的中文回复。',
};
// create() 里：
messages: [SYSTEM_PROMPT, ...messages],  // 导演字条永远排第一
```

两个设计决定（都是故意的）：

1. **放后端**：前端 messages 用户碰得到（DevTools/改代码）——字条贴观众席谁都能撕了重写。放后端 = 防篡改 = Prompt Injection 防御第一块砖
2. **前端 types 不加 'system'**：界面永远不该出现 system 气泡，类型不对称是刻意约束

### `as const` 与 值/类型两个世界

```ts
let a: string = '...';        // 类型 string：无限大池子
let b: 'system' = 'system';   // 字面量类型：只装一滴水的池子
type Role = 'user' | 'assistant' | 'system'; // 三滴水池子（白名单的精确说法）
```

- `'system'` 既是值（运行时真实字符串）也可以当类型用（编译期模具，编译后蒸发）
- 裸对象字面量的 role 会被推断成 string（塞不进白名单）→ `as const` 收窄成字面量类型
- 有 interface 标注时不需要 as const（interface 已经撑腰）

### 自测

1. system prompt 放前端会有什么问题？
2. 为什么 SYSTEM_PROMPT 里要 as const，而 types/chat.ts 里的对象不用？

<details><summary>答案</summary>

1. 用户可见+可篡改（DevTools/自造请求），人设和规矩形同虚设——注入攻击第一入口。
2. 裸字面量对象 TS 推断 role 为 string；有 interface/类型标注的地方 TS 已按声明收窄。
</details>

---

## 第 6 章 · Markdown 渲染（react-markdown）

### 理论：React 默认把字符串当纯文本

```tsx
{message.content}  // ⚛️ AI 回的 **加粗** 原样显示星号——裸奔
```

这不是 bug，是 React 在**保护你**：字符串永远不当代码/HTML 执行（防 XSS）。
代价：Markdown 语法没人翻译。解法：不自己写解析器（大坑），用现成翻译官。

### 标准用法

```bash
npm install react-markdown   # client 目录下
```

```tsx
// ⚛️ 它就是个普通组件：import 进来当标签用，喂 Markdown 字符串，吐正经 HTML
import ReactMarkdown from 'react-markdown';

// ⚛️ 改的是【长相层】MessageBubble.tsx——content 在哪被摆出来就改哪
// ⚛️ 用户的话原样显示（用户真打 ** 就该显示 **）；AI 的话才交给翻译官
{isUser ? message.content : <ReactMarkdown>{message.content}</ReactMarkdown>}
```

### 陷阱：JSX 花括号是"门"，只开一次

```tsx
// ❌ 当日真实翻车现场：
{isUser ? {message.content} : {}}
//         ~~~~~~~~~~~~~~~~ JS 世界里再套 {} = 对象字面量，语法炸
```

规则背下来：

- `{}` 是**从 HTML 世界进 JS 世界的门**——进去了就是纯 JS，不能再套花括号
- JS 世界里写 `<标签>` = **回到 HTML 世界**——标签内部要塞变量就得**再开一次门**
- 门可以反复开关：`<ReactMarkdown>{message.content}</ReactMarkdown>` 里的 `{}` 合法，因为标签内部又是 HTML 世界

### 自测

1. 为什么 React 默认不渲染 Markdown/HTML？这是保护还是缺陷？
2. `{isUser ? {msg.content} : x}` 错在哪？
3. 用户的消息为什么不过 ReactMarkdown？

<details><summary>答案</summary>

1. 保护：字符串永不当代码执行，防 XSS 注入。翻译 Markdown 是额外需求，交给专门组件。
2. 外层 `{}` 已进 JS 世界，内层 `{msg.content}` 被当成对象字面量，语法错误。直接写 `msg.content`。
3. 用户打的是纯文本不是 Markdown——他真输入 `**` 就该看到 `**`，翻译反而歪曲原话。
</details>

---

## 第 7 章 · 自动滚动三零件 ⭐ 核心模板

### 理论：真正会滚的只有一行

`scrollIntoView()` 是**浏览器原生命令**（不是 React 的东西）：
"调整滚动条，直到【我】出现在可视区域"。滚动 100% 浏览器干，我们只下命令。

几何事实：锚点站在队伍**最后一个** → 要让队尾露脸，滚动条只能拉到底。
"滚到底"就这样被翻译成了浏览器听得懂的话。

```
AI 吐一个字 → setMessages → 重渲染 → messages 变了
→ useEffect 触发 → ref 拿到锚点 div → scrollIntoView()
→ 浏览器拉滚动条到锚点露脸 = 到底
```

每个字走一遍这条链 → 视口钉在打字机上（每字触发是 feature 不是 bug：
只在结束时滚一次的话，中间过程看不见）。

### 标准代码（ChatWindow.tsx）

```tsx
// ⚛️ 零件①：useRef 造"盒子"。hook 必须在组件顶层（return 之前）
const bottomRef = useRef<HTMLDivElement>(null);

// ⚛️ 零件③：messages 一变（= 每个字到货）就滚到锚点
useEffect(() => {
  bottomRef.current?.scrollIntoView();  // ?.：锚点还没挂上 DOM 时 current 是 null
}, [messages]);  // ⚛️ 依赖数组：messages 一变就触发

// ⚛️ 零件②：锚点。空 div 站在 JSX 列表最后，盒子挂它身上
<div ref={bottomRef} />
```

### 剖析 `useRef<HTMLDivElement>(null)`

```tsx
const bottomRef = useRef<HTMLDivElement>(null);
//    ~~~~~~~~~   ~~~~~~ ~~~~~~~~~~~~~~  ~~~~
//    盒子名       造盒子  模具(给TS看)     初始材料
```

- **造盒子**：本质就是 `{ current: null }`，跟 useState 互补：

| | `useState` | `useRef` |
|---|---|---|
| 改它触发重渲染？ | ✅ 会 | ❌ 不会 |
| 跨渲染 | 值会换新 | **盒子永远同一个**（身份证不变） |

- **模具** `<HTMLDivElement>`：告诉 TS 盒子将来装 div → `.current` 才有 `scrollIntoView` 补全
- **初始 null**：这行执行时 JSX 还没变成真实 DOM，盒子先空着

### ref 怎么盯上目标？——不是找，是亲手挂

```tsx
<div ref={bottomRef} />   // ⚛️ "React，造完这个 div 的真 DOM，塞进我盒子里"
```

不是 ref 出去搜元素，是**你把盒子写在哪个标签上，React 造完就装哪个**。
对比：`querySelector` 是满屋子搜人（可能串门），ref 是专线直达（不存在找错）——
组件复用出 10 份时各有各的盒子，这就是 React 里不用 querySelector 的原因。

### 自测

1. 三个零件各自的分工？真正执行滚动的是谁？
2. `bottomRef.current` 什么时候是 null？
3. 打字机每个字都触发一次 effect，是 bug 吗？

<details><summary>答案</summary>

1. scrollIntoView 是会滚的人（浏览器原生），ref 帮它找到目标（锚点 div），useEffect 决定什么时候喊（messages 一变）。
2. React 还没把 JSX 造成真实 DOM 的空窗期（如首次渲染瞬间）——所以要 `?.`。
3. feature：每字滚一次视口才能全程钉住；只在结束滚一次则中间过程看不到。
</details>

---

## 第 8 章 · Hook 到底是什么

### 理论：函数是失忆的，仓库在 React 手里

普通函数跑完就死，什么都不记得；而 React 每次渲染 = **把组件函数重新跑一遍**。
那 `messages` 怎么活下来的？——数据根本不存函数里，**存在 React 内部仓库**，
函数每次重跑时取回来。

> **Hook 的定义：以 `use` 开头、让你的函数"钩进"（hook into）React 内部
> 仓库和机制的特殊函数。**

| Hook | 钩进了什么 |
|---|---|
| `useState` | 仓库记忆格子 + "改了就重渲染"开关 |
| `useRef` | 仓库盒子（跨渲染不变，改了不渲染） |
| `useEffect` | 渲染流水线："渲染完之后叫我一下" |
| `useChat`（自定义） | 组合技——调用了 Hook 的函数也算 Hook |

### 铁律的原因：仓库靠"调用顺序"认人

React 不按名字发记忆，按顺序发：第 1 个 useState 给格子 1，第 2 个给格子 2……
Hook 塞进 if / 循环 / JSX 里 → 这次跑 3 个下次跑 2 个 → 顺序乱 → 拿到别人的记忆。
**所以 Hook 只能在组件顶层调用。**

### 用词纠偏（面试防翻车）

- `useRef` 这个**函数**是 Hook；它吐出的 `bottomRef` 不是 Hook，是普通对象（盒子）
- JSX 里的 `ref={...}` 是把盒子挂上去的**挂钩属性**——跟 React Hook 家族纯属撞名

### 自测

1. 用一句话定义 Hook。
2. 为什么 Hook 不能写在 if 里？
3. `bottomRef` 是 Hook 吗？

<details><summary>答案</summary>

1. 以 use 开头、把失忆的函数钩到 React 记忆仓库上的函数。
2. React 靠调用顺序给每个 Hook 分配仓库位置，条件调用会打乱顺序、错领记忆。
3. 不是。useRef 才是 Hook，bottomRef 只是它返回的普通对象。
</details>

---

## ⏳ 待办（顺延到 Harness 补全日）

- [ ] `res.body!` 的非空断言改成正经 if 检查（useChat.ts 第 41 行）——
      `!` = 拍胸脯不 = 代码保障，跟 Week 9 "不信任输入"同罪
- [ ] 错误详情带给前端（现在只有笼统 [ERROR]）

---

## 🔴 明早重考清单

1. 副作用导入（**第四考**：不拿值只执行→顺便发生的事=副作用；同款 `import './index.css'`）
2. TextDecoder 为什么只建一次（有记忆/半个字/接棒员）
3. res"信封不是信"的到货时间差
4. 前端第四层 = App.tsx 组装层（不是 assets）
5. system prompt 放后端的安全理由
