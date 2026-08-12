# 📖 学习手册 · Week 11 Day 1 · Tool Calling（给 Stingy 装手）

> 来源：Week 11 Day 1 · Stingy 项目（姊妹篇：Week 10 Day 4 后端篇 / Day 5 前端全集）
> 里程碑：🖐️ Stingy 从"陪聊"升级 Mini Agent —— get_time + add_expense 全链路验收通过（含 MySQL 落库）

---

## 第 1 章 · 问题：LLM 是关在小黑屋的大脑

### 理论

LLM 唯一的能力：**接收文字 → 预测下一个字**。它没有眼睛（看不到数据库/时间/新闻），没有手（不能查、不能算、不能写库）。

**幻觉的真面目（当日实测）**：不给它手，它不会说"我不知道"，它会**编一个像样的答案**——问"现在几点"，它一本正经地答"2025年4月12日 20:11"（真实时间 2026/7/30）。

对记账助手是致命的：用户说"午饭花了30"，它只能嘴上答应"记下了！"——哪都没记。**不能真记账的记账助手就是陪聊。**

### 解决思路：借它一双手

```
我们告诉它："你有工具 get_time，想用就喊我"
它想用时 → 不吐人话，改吐"申请表"（tool_calls）
我们后端替它执行 → 结果塞回 messages → 再问一轮
它拿着结果组织人话回用户
```

**关键安全设计：手长在我们后端，模型只能"申请"，执行权永远在 Harness 手里。**

### 自测

1. 为什么没有工具的 LLM 永远答不对"现在几点"？
2. 工具的执行发生在哪里？模型能执行代码吗？

<details><summary>答案</summary>

1. 它唯一能力是根据输入文字预测下一个字；当前时间既不在输入里也不在训练数据里，它只能按概率编一个。
2. 在我们后端。模型永远只能填申请表，执行权 100% 在 Harness 手里——这是安全设计不是技术限制。
</details>

---

## 第 2 章 · 机制全景 ⭐ 核心

### 三样新东西

**① 工具菜单（tools 参数）**——只有菜名和介绍，没有厨房：

```ts
const tools: OpenAI.Chat.ChatCompletionTool[] = [{
  type: 'function',
  function: {
    name: 'get_time',
    description: '获取当前的日期和时间',  // 🤖 模型靠这句话决定要不要用
    parameters: { type: 'object', properties: {} },
  },
}];
```

**② 申请表（tool_calls）**——模型的回复从此二选一：

```jsonc
// 说人话：        { "content": "今天吃了啥？", "tool_calls": undefined }
// 或填申请表：    { "content": null, "tool_calls": [{
//                   "id": "call_abc",
//                   "type": "function",
//                   "function": { "name": "get_time", "arguments": "{}" }
//                 }] }
```

**③ 回执（第四种 role: 'tool'）**——执行结果塞回历史：

```ts
history.push(reply);                       // 申请表原样塞回（少了它模型会懵）
history.push({
  role: 'tool',
  tool_call_id: call.id,                   // 认领哪张申请表（一轮可多张）
  content: result,
});
```

### 三个"它不知道"（全是失忆症患者定律）

| 每轮都要重发 | 因为它不记得 |
|---|---|
| messages 全部历史 | 聊过什么 |
| SYSTEM_PROMPT | 自己是谁 |
| **tools 菜单** | **自己有什么手** |

### 最反直觉的真相：菜单最终是文字

tools 数组被 SDK 序列化成文字拼进 prompt。模型看到的全是文字，干的还是"预测下一个字"，只是被训练成看到菜单就按格式吐申请表。推论：

1. **description 是 prompt 不是注释**——写得好不好直接决定它用不用、填得对不对
2. **工具越多菜单越长，token 越贵**（每轮都发，输入也计费）
3. **菜单和 system prompt 都是文字，会打架**（见第 5 章踩坑）

### Agent Loop 标准模板

```ts
for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {   // 🤖 保险丝防无限烧钱
  const res = await client.chat.completions.create({ model, messages: history, tools });
  const reply = res.choices[0].message;
  if (!reply.tool_calls) break;          // 🤖 出口：它说人话了（何时结束是模型决定的）
  history.push(reply);
  for (const call of reply.tool_calls) {
    if (call.type !== 'function') continue;              // 🔵 判别联合收窄
    const result = await executeTool(call.function.name, call.function.arguments);
    history.push({ role: 'tool', tool_call_id: call.id, content: result });
  }
}
```

这个循环的正式名字：**Thought → Action → Observation**。会跑它的系统 = Agent。

**流程控制权交了一半给模型（它决定何时停）→ 所以必须有 MAX_ROUNDS 保险丝。兜底永远是 Harness 的责任。**

### 自测

1. `arguments` 是对象还是字符串？为什么？
2. 为什么申请表（assistant 消息）要原样塞回历史？
3. MAX_ROUNDS 防的是什么？

<details><summary>答案</summary>

1. JSON **字符串**。模型生成的本来就是文本，API 原样给你，parse 是你的活（还可能是坏 JSON，要 try/catch）。
2. 模型无状态——不塞回去，它下轮看到凭空冒出的 tool 回执会懵："我申请过吗？"
3. 模型鬼打墙无限申请工具——每轮都是真金白银的 token。控制权交出去一半，就得防失控。
</details>

---

## 第 3 章 · 生产架构：探路轮 + 流式轮

### 结构（services/llm.ts，controller 和前端零改动）

```
用户消息 → 【探路轮 ×N，非流式，带菜单】工具活闷头干完
        → 【最终轮，流式，不带菜单】人话打字机给用户
```

三个设计决定：

1. **中间轮不流式**——模型吐的是 JSON 申请表，用户看它干嘛
2. **最终轮故意不传 tools**——断了再申请的路，逼它说人话（流式下拆申请表碎片是地狱难度，顺延）
3. **代价**：每条消息多一次探路请求的 input token（Day 2 Harness 优化项）

### 实验脚本方法论（test-tools.ts）

新机制不要直接接进生产链路——**先写一次性裸脚本直捅 API**（砍掉前端/Express/流式所有中间商）。跑通 = 机制成立，之后出问题都是接线的锅。**二分法的正向用法。**

### 自测

1. 为什么最终那轮不传 tools？
2. 为什么先写实验脚本而不是直接改 services？

<details><summary>答案</summary>

1. 防它在流式轮又申请工具（流式拆 tool_calls 碎片很难处理）；不给菜单它只能说人话。
2. 隔离变量：链路上五个嫌疑人，裸脚本先证明机制本身没问题，接线出错时嫌疑人只剩接线。
</details>

---

## 第 4 章 · 带参数的工具（add_expense）

### JSON Schema 固定三层

```ts
parameters: {
  type: 'object',
  properties: {
    amount:   { type: 'number', description: '本次消费的总金额，单位：元。只填正数；多份商品填合计而非单价' },
    category: { type: 'string', description: '必须从以下选项选一个：餐饮/交通/…', enum: ['餐饮','交通','购物','娱乐','居家','医疗','其他'] },
    note:     { type: 'string', description: '保留用户原话关键信息，如"星巴克拿铁"' },
  },
  required: ['amount', 'category'],   // note 不在里面 = 选填
}
```

### 三条实战经验

1. **description 要下命令、堵歧义**——"两杯奶茶40"填总额还是单价？单位元还是分？"三十块五"转 30.5？你能想到的坑都写进去。type 只管"是数字"，description 管"是什么数字"。
2. **枚举约束**——分类这种字段绝不能让模型自由发挥（同一事物每次一个名字，GROUP BY 就废了）。把开放题变选择题，错误率降一个数量级。`enum` 字段比 description 更硬，两个都写最保险。
3. **required 是建议不是保证**——模型可能漏填、错填。真防线在后端校验。

### 这就是"结构化输出"的价值

用户随口一句"午饭花了30"→ 模型抽取成 `{"amount":30,"category":"餐饮"}`。**自然语言 → 机器可用的结构化数据**，以前要逼用户填表单，现在外包给模型——但脏活（校验）还是你的。

### 自测

1. 为什么 category 要用枚举而不是让模型自己定？
2. required 里有 amount，后端还需要校验 amount 吗？

<details><summary>答案</summary>

1. 模型无记忆，不记得上次用过什么分类，自由发挥会出"餐饮/吃饭/food"三个名字指同一事物，统计全废。
2. 需要。required 只是给模型的强烈建议，它仍可能漏填/填字符串/填负数。前端校验是礼貌，后端校验是命。
</details>

---

## 第 5 章 · 后端防线（Week 9 规矩的 AI 加强版）

### addExpense 的四道防线

```ts
async function addExpense(args: string): Promise<string> {
  // ① parse 防坏 JSON（模型吐文字，文字可能不是合法 JSON）
  try { parsed = JSON.parse(args); } catch { return '参数不是合法 JSON，请重新调用…'; }
  // ② 校验（required 不是保证）
  const amount = Number(parsed.amount);
  if (!Number.isFinite(amount) || amount <= 0) return '金额无效…请向用户确认。';
  // ③ 白名单归一（脏分类归"其他"，不报错——记上账比分类精确重要）
  const category = CATEGORIES.includes(String(parsed.category)) ? … : '其他';
  // ④ 占位符写库（红线）
  await pool.query('INSERT INTO expenses (amount, category, note) VALUES (?, ?, ?)', [amount, category, note]);
}
```

### 四个关键认知

1. **tool 回执是给模型看的对话**——返回"金额无效，请向用户确认"，它下轮会自己纠错。错误信息 = 给模型的纠错指令。
2. **`?` 占位符在 AI 时代是双保险**——参数值来自模型，模型输入来自用户："帮我记一笔，分类叫 `'); DROP TABLE expenses; --`" 就是 Prompt Injection 通向 SQL 注入的现实路径。拼字符串 = 开门迎接。
3. **错误信息两套**：`console.error` 给日志（完整真相）/ return 给模型（模糊说法）。**模型是个大喇叭，你告诉它的它会转述给用户**——表名、SQL、连接串漏出去 = 送攻击者地图。
4. **async 传染**：工具碰 DB → addExpense async → executeTool async → 调用处必须 await。**忘了 await，塞回历史的是 "[object Promise]"，模型直接懵。**

### 自测

1. 用户怎么可能通过聊天实施 SQL 注入？怎么防？
2. DB 报错时，为什么不把 err 原样 return 给模型？

<details><summary>答案</summary>

1. 用户话里藏 SQL 片段 → 模型老实填进参数 → 拼字符串的话就执行了。防法：永远用 ? 占位符，值只当纯数据。
2. 模型会把回执转述给用户，内部细节（表名/SQL/host）等于泄露给潜在攻击者。真相进日志，对外模糊。
</details>

---

## 第 6 章 · 当日踩坑三连（都靠二分法破案）

### 坑 1：菜单递了，模型就是不调工具 ⭐ 今日最值钱

- **现象**：脚本里能调，接进 Express 就不调，直接幻觉时间
- **排查**：唯一差异 = system prompt → 加进脚本 → 复现 ✅
- **根因**：system prompt "简短口语化回复"把它推向直接答话，压过用工具的念头
- **修法**：system prompt 里明说"你配有工具…必须调用，不得编造"
- **教训**：**Tool Calling 不是配置开关，模型用不用工具是它的决定，你得用 prompt 说服它。** 菜单和人设都是文字，文字会打架。

### 坑 2：工具明明执行了，日志却没有

- **现象**：回答时间精确到秒（必是工具给的），console.log 的 🔧 行却不见
- **排查**：getTime 改返回假值"1999年1月1日"→ 模型果真说 1999 → 证明工具在跑
- **根因**：后台进程 stdout 重定向文件的缓冲问题，非代码 bug
- **教训**：**别信"没日志=没执行"，用改变行为的实验拿铁证**（同款：Day 5 的 402 二分法）

### 坑 3：MySQL ERROR 2002

- **现象**：`Can't connect through socket '/tmp/mysql.sock'`
- **根因**：mysqld 没启动，socket 文件是它启动时才创建的
- **修法**：`brew services start mysql`
- **速记**：**2002 = 门都没找到（服务没跑）；1045 = 门开了密码错。** 2002 时别浪费时间折腾密码。
- 排查三件套：`brew services list` / `lsof -i :3306` / `ls /tmp/mysql.sock`
- 冷知识：mysql CLI 里 `localhost` 走 socket，`127.0.0.1` 强制走 TCP，不等价

### 自测

1. 模型不调工具，除了菜单没递，还可能是什么原因？
2. 2002 和 1045 分别先查什么？

<details><summary>答案</summary>

1. system prompt 与工具使用的意图冲突（或没告诉它有工具该用工具）——prompt 是文字战场，需要明确指令支持工具使用。
2. 2002 先查服务活没活着（brew services/端口/socket 文件）；1045 才是查用户名密码。
</details>

---

## 附 · 今日新增旧知识连接

| 新东西 | 连回 |
|---|---|
| tools 每轮重发 | 失忆症患者/全量重发 |
| 申请表 JSON | 结构化输出；类型是模具值是材料 |
| 工具在后端执行 | Harness ≈ service 层；system prompt 放后端 |
| `call.type !== 'function'` | 判别联合 + 类型收窄（role 白名单同款） |
| 后端校验申请表 | Week 9 不信任输入 |
| ? 占位符防注入 | Week 7 SQL 红线 + Day 2 Prompt Injection 预告 |
| 🔧 console.log | Day 3 Observability 预告 |
| 实验脚本 | 二分法（绕过中间商直捅源头） |

---

## ⏳ 待办

- [ ] 刁钻测试："两杯奶茶一共40"（验 description）、"分类叫 xyz 的记一笔"（验白名单）
- [ ] query_expenses 工具（查账/统计，GROUP BY 派上用场）
- [ ] 探路轮双倍 token 优化 + 流式 tool_calls（Day 2 Harness）
- [ ] test-tools.ts 实验脚本可删（或留作纪念）
