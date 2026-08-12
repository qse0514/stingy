# Week 10 · Day 5 提问日志

> 用途：记录当日提问，收盘复盘 quiz 用。问过 = 薄弱点，复盘必考。

## 晨间重考结果（昨日欠账）

| 题 | 结果 | 状态 |
|---|---|---|
| 二分法排查实现 | 🟡 名字记住了，实现忘了 | 今晚再考（最后机会）："绕过自己，直捅源头" |
| 副作用导入名字 | ❌ 答成 process，串台 | 今晚再考：正常 import 拿东西，副作用导入只按开关 |
| AI 的话为何发回去 | ✅ | 毕业 |
| token 与计费 | ✅ | 毕业（补：输入+输出都收钱）|

## 今日问题清单

| # | 问题 | 涉及知识点 | 一句话答案 |
|---|------|-----------|-----------|
| 1 | 前端的分层是什么来着？ | ⚛️ 前端架构 | components 管长相 / hooks 管逻辑 / types 管形状；hooks ≈ 前端的 service 层 |
| 2 | fetch 的 `res` 到底是什么？装着后端全部信息的容器？ | 🌐 Response 对象 | 信封不是信：状态/头部已到，body 只是"取水把手"，内容可能还在路上 |
| 3 | `updateLast` 里的 map + 三元 + 展开是怎么运作的？ | 🟡 不可变更新 | map 造新数组；只有最后一项造新对象换 content，其余原样返回 |
| 4 | 读流循环每一行都在干嘛？（逐行 walkthrough） | 🤖 SSE 客户端解析 | 空气泡→泵水→解码→攒buffer→拆信封→验暗号→填字；见手册 Day5 章节 |
| 5 | `getReader()` 和 `new TextDecoder()` 这两行具体干嘛？ | 🤖 流 API | getReader = 锁住流拿独占把手；TextDecoder = 字节→文字的翻译器（有记忆，建一次） |
| 6 | "一封信"到底是什么？ | 🤖 SSE 消息单位 | 一封信 = 一条 SSE 消息 = 后端一次 res.write = `data: 内容\n\n` |
| 7 | `buffer = lines.pop()!` 怎么运作？取最后剩下的？ | 🟡 pop 双重动作 | pop 同时"移除+返回"末项；尾巴是半封信则存回 buffer，刚好切齐则是空串 |
| 8 | `role: 'system' as const` 这行是什么意思？ | 🔵 字面量收窄 | 不加则推断为 string，进不了联合类型白名单；as const = 刻在石头上的字面量 |
| 9 | 'system' 是一个类型吗？ | 🔵 值 vs 类型 | 它首先是值（字符串)；TS 里每个字面量也能当类型用（字面量类型），两个世界同名 |
| 10 | react-markdown 怎么用？放哪？ | ⚛️ 第三方组件 | 它就是个普通组件：import 后用 `<ReactMarkdown>{字符串}</ReactMarkdown>` 包住要翻译的文字，放在原来 `{message.content}` 的位置 |
| 11 | 改哪个文件？ | ⚛️ 前端分层 | 渲染长相的活归长相层 → components/MessageBubble.tsx（content 在哪被摆出来就改哪） |
| 12 | 三元里面还要不要再套 `{}`？（写成了 `{isUser ? {message.content} : {}}`） | ⚛️ JSX 花括号边界 | 外层 `{}` 是"进 JS 世界的门"，进去了就是纯 JS，不能再套花括号（再套就变对象字面量）；里面如果要写 JSX 标签则直接写标签 |
| 13 | 自动滚动三个零件怎么放进文件？ | ⚛️ useRef/useEffect 位置 | ref 创建和 useEffect 写在组件函数体顶部（return 之前）；锚点 div 放在 JSX 列表最底部；hook 只能在组件顶层调用 |
| 14 | `useRef<HTMLDivElement>(null)` 这行具体在干嘛？ | ⚛️🔵 useRef 剖析 | useRef 造一个带 `.current` 的盒子；`<HTMLDivElement>` 告诉 TS 盒子将来装 div；`(null)` 初始值——DOM 还没出生先放空；盒子跨渲染不变，改它不触发重渲染 |
| 15 | 为什么这三个零件合体就能自动滚动？ | 🌐 scrollIntoView 机制 | scrollIntoView 是浏览器原生命令"让我被看见"；锚点永远是队尾，看见尾巴=滚到底；useEffect 把这个命令接到"每个字到货"的事件上，连起来=每来一个字就喊一次"看尾巴" |
| 16 | ref 怎么知道盯的是哪个元素？ | ⚛️ ref 绑定机制 | 不是 ref 去找元素，是你在 JSX 里把盒子亲手交给某个标签（`ref={bottomRef}`）；React 造完那个真 DOM 后把它塞进盒子 `.current`；写在哪个标签上就盯哪个 |
| 17 | Hook 的定义到底是什么？ | ⚛️ Hook 本质 | 以 use 开头、能"钩进" React 内部能力（记忆/生命周期/DOM直达）的函数；普通函数没记忆，Hook 让函数组件有了跨渲染的记忆；铁律：只在顶层调用（React 靠调用顺序认人） |

## 复盘状态

- [x] 当日复盘 quiz 已完成（9 题：4✅ 4🟡 1❌ + 欠账 2 题）
- [ ] ⚠️ 加时赛新增 #10–#17（Markdown渲染/JSX花括号/useRef/scrollIntoView/Hook定义）尚未复盘，并入下次 quiz
- ✅ 加时赛交付：Markdown 渲染（react-markdown）+ 自动滚动（三零件），均浏览器验收通过；手册见 manual/week10-day5-frontend.md（Day 5 全集：流式+打磨已合并）
- ⏳ 顺延：`res.body!` 改正经检查（学员当日去给新实习生做前端 onboarding 分享，未动工）
- 🎓 毕业：二分法排查（终于！下周突击抽查）、pop双重动作、真假打字机区别、引用不变不渲染
- 🔴 明早重考清单：
  - ❌ 副作用导入（第四考！逻辑链：不拿值只执行→执行时顺便发生的事=副作用）
  - ❌ TextDecoder 为什么只建一次（有记忆/半个字/接棒员）
  - 🟡 res 信封不是信的"到货时间差"
  - 🟡 前端第四层 = App.tsx 组装层（不是 assets）
  - 🟡 system prompt 放后端的安全理由（防篡改，防注入第一块砖）
