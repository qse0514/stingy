# Stingy 架构与实现总览（Single Source of Truth）

> 本文是给【未来会话 / 未来的自己】看的项目参照物：改任何模块前先读对应小节。
> 与 `docs/manual/` 的分工：manual 讲"为什么这么设计"（教学），本文讲"现在长什么样"（速查）。
> ⚠️ 规矩：改了架构（新模块 / 新协议 / 新表 / 新暗号）必须同步更新本文，顺序同 `schema.sql`——先改文档再改码会漂移，先改码就当天补文档。
> ⭐ W12 D1 起学员明确要求：**每次改动代码都要同步本文**，不限于架构级改动。
> 最后核实：2026-08-11（W12 D4 综合评审修复工单 B1-B6/I1/I2 合入，全量回归通过）

## 一、技术栈与启动

| 层 | 技术 | 位置 |
|---|---|---|
| 前端 | Vite + React + TypeScript + Tailwind CSS v4（ChatGPT 式布局：深色侧栏 + 限宽阅读带；vite 代理 /api→3001） | `client/` |
| 后端 | Express + TypeScript（ESM，NodeNext，import 带 `.js` 后缀） | `server/` |
| 数据库 | MySQL 8（连接池 `mysql2/promise`） | `server/sql/schema.sql` 是 DDL 唯一真源 |
| LLM | DeepSeek（OpenAI SDK 兼容），非流式探路 + 流式收尾 | `server/src/services/openai.ts` |
| 前后端通信 | 聊天走 SSE（POST + ReadableStream 手动解析），其余普通 JSON | — |

- 环境变量在 `server/.env`（`DEEPSEEK_API_KEY` / `PORT=3001` / `DB_*`）。
- 实验脚本：`server/src/experiments/test-*.ts`，`npm run exp:<name>` 跑，自造数据自清理。
- 类型检查：`cd server && npx tsc --noEmit`、`cd client && npx tsc --noEmit`，预期都是 0。

## 二、目录地图（只列会改到的）

```
server/src/
├── index.ts                 # 挂路由：/api/chat + /api/conversations + /api/stats
├── routes/
│   ├── chat.ts              # POST / (SSE 聊天)、/confirm、/reject（HITL，不经过模型）
│   ├── conversations.ts     # GET /、POST /、GET /:id/messages、⭐ S1++ DELETE /:id（硬删会话）
│   └── stats.ts             # ⭐ W12 D4：GET /summary?month=YYYY-MM（仪表盘一屏的全部数据，只读）
├── controllers/chat.ts      # ⭐ 编排者：校验→发traceId→存user消息→buildHistory→runAgent→
│                            #   流式转发→persistTranscript→[CONFIRM]→[DONE]→reconcile
├── controllers/stats.ts     # 🗄️ W12 D4：统计接口控制器（S1+：month 参数正则校验 YYYY-MM，
│                            #   不合法 400；缺省 = 当前月，服务端自己算不信客户端时钟）
├── services/
│   ├── agent.ts             # ⭐ Agent 引擎 runAgent(config, messages, traceId)：
│   │                        #   Thought→Action→Observation 循环 + reflect + 最终流式轮
│   ├── agents.ts            # Agent 名册（stingy / stingyReadonly / stingyPromptOnly）
│   ├── conversation.ts      # 记忆层：messages 表的读写 + buildHistory 重建历史
│   ├── stats.ts             # 🗄️ W12 D4 统计层（S1+：吃 month 参数，四块数据全跟所选月走）：
│   │                        #   月总/环比(所选月 vs 它的上一月)/分类/逐日/当月全部流水 recent(LIMIT 100)；
│   │                        #   预算进度只在当前月算（budgets 无历史额度，历史月返 []），响应带 isCurrentMonth；
│   │                        #   预算进度复用 budget.ts 的 monthSpent —— 和回执提醒永远同一个数，
│   │                        #   月总不复用它（monthSpent 写死当前月，不许动），统计层自己带月份边界 SUM
│   ├── pending.ts           # HITL：提案的建/查/确认/拒绝（confirm-and-set 抢锁）
│   ├── audit.ts             # 对账 judge/reconcile + 自检 reflect（同一套规则两个时机）
│   ├── trace.ts             # 观测层：traceId 发号、logEvent、getTrace、滚动清理
│   ├── db.ts / openai.ts    # 连接池 / LLM 客户端
│   └── tools/
│       ├── index.ts         # 工具总台：ALL 数组 + pickTools(权限) + executeTool(派单)
│       ├── types.ts         # ToolDef（spec菜单+run厨房）、ToolContext（traceId/agent/seq/batch）
│       ├── addExpense.ts    # 记账：校验→幂等查重→HITL 风控→写库（MAX_AMOUNT=5000 在这 export）
│       │                    #   ⭐ W12 D4：成功回执尾部捎带预算提醒（开头词协议不动）
│       ├── budget.ts        # ⭐ W12 D4 预算：set_budget（同分类 upsert）/ query_budget /
│       │                    #   budgetReminder（分类没预算退"总体"；自己挂了返回 null 不碍回执）
│       ├── queryExpenses.ts / updateExpense.ts / deleteExpense.ts（含 restore）/ getTime.ts
│       └── categories.ts    # 七类白名单：餐饮/交通/购物/娱乐/居家/医疗/其他
client/src/
├── hooks/useChat.ts         # ⭐ 前端聊天全部逻辑：会话管理、SSE 读流拆信封、HITL 确认/拒绝
├── hooks/useStats.ts        # 🗄️ W12 D4：仪表盘数据拉取（S1+：月份 state + prev/nextMonth，
│                            #   切月重新 fetch，切月瞬间 stats 置 null 走"加载中"）
├── components/              # ChatWindow / MessageBubble / ChatInput / ConfirmCard / ConversationList
│                            #   （⭐ S1++：顶部分段导航「💬 对话 / 📊 报表」各占一半，看报表时
│                            #   下半区 opacity-50 调暗；会话行悬停出 × 钮 + window.confirm 二次确认）
│                            #   + StatsPanel（⭐ W12 D4 S1++ 报表：顶部月份切换器 + 四卡栅格
│                            #   grid-cols-3：本月概览 col-span-2（头卡+预算卡合并，含日均/月底预测，
│                            #   预测仅当前月）/ 分类占比 col-span-1（donut 竖排，圆心总额+笔数）/
│                            #   逐日柱状图与「N 月流水」各 col-span-3；空月份整页收敛成单卡，
│                            #   "没有记账"只说一次；图表仍全零依赖手写）
└── types/chat.ts + stats.ts # Message / Conversation / PendingExpense / StatsSummary
```

⭐ W12 D4 主区双视图：App.tsx 里一个 `view: 'chat' | 'stats'` 局部 state（不上路由库），
侧栏顶部分段导航切换（⭐ S1++：「💬 对话」切回聊天且保持当前会话，「📊 报表」切报表；
原混在列表里的报表按钮已删），选会话/新对话自动切回聊天。
⭐ S1++ 会话删除：侧栏悬停出 × → confirm → DELETE /api/conversations/:id；后端同一连接事务里
先删 messages 再删 conversations（schema 无外键，级联靠手动，顺序反了留孤儿）；硬删不软删 ——
会话是模型记忆不是账本，expenses 软删规矩不适用；traces/expenses 不受影响，pending 提案留 24h TTL
自然失效；前端删的是当前会话时先断流再清屏回新对话。非法 id 400 / 不存在 404 / 成功 204。
视觉区分（S1+ ⑦）：报表视图底色 bg-gray-50 + 白卡 shadow-sm（容器 max-w-4xl），聊天视图保持纯白；
看报表时侧栏下半区 opacity-50。
统计链路全程零 LLM：useStats → GET /api/stats/summary?month= → services/stats.ts 纯 SQL 聚合（全部带 deleted_at IS NULL）。
月份协议：右箭头在当前月禁用（不能看未来），左箭头不设下限（历史月没数据就全空，诚实显示）；
历史月预算卡整卡不渲染（前端靠 isCurrentMonth 判，不靠 budgets 是否为空 —— 那分不清"隐藏"和"没设"）。

## 三、一次聊天请求的完整流水线

```
前端 useChat.sendMessage
  │  POST /api/chat { conversationId, message }   ← W12 D1 新合同：历史不再由前端寄
  ▼
controller.handleChat
  ① 校验 conversationId/message，404 不存在的会话（不默默新建）
  ② startTrace() 发案件编号（每 20 次开卷滚动清理 traces，只留 200 卷）
  ③ appendMessage(user)          ← 先落库再重建，全挂了用户的话也不丢
  │                                ⭐ W12 D4 I2：在 try 内 —— SSE 头已设，DB 抖动走 [ERROR] 通道
  ④ buildHistory(conversationId) ← 从 messages 表重建 OpenAI 形状历史（含申请表+回执），
  │                                取最近 30 条并对齐到 user 边界（防孤儿申请表/回执）
  ▼
runAgent(stingy, history, traceId)
  ⑤ Agent Loop（≤5 轮、≤5 次工具调用，非流式）：
  │    模型要工具 → executeTool(name, args, {traceId, agent, seq, batch})
  │    申请表+回执 push 进 history（本轮上下文）和 transcript（待落库记忆）
  │    模型不要工具 → 存 draft（⚠️ 草稿故意不进 history：锚定效应 3/3 vs 2/3）→ break
  ⑥ reflect(traceId, draft)：确定性规则审草稿，不合格就注入 system 纠正指令
  ⑦ 最终流式轮：故意不传 tools（这轮只许说人话）→ 返回 { stream, transcript }
  ▼
controller 续
  ⑧ for await 转发 SSE：data: JSON.stringify(text)\n\n，同时攒 fullText
  ⑨ persistTranscript(transcript) + appendMessage(assistant, fullText)  ← 记忆落库
  ⑩ listPendingByTrace(traceId) → 有提案就发 data: [CONFIRM] [...]\n\n
  ⑪ data: [DONE]\n\n → res.end()
  ⑫ reconcile(traceId, fullText)  ← 在 res.end() 之后：监督者不是守门员
```

SSE 暗号（前端 `useChat` 按 `startsWith` 拆）：`[DONE]`（正常结束）、`[ERROR] 人话`（白名单文案）、`[CONFIRM] JSON数组`（待确认提案，渲染 ConfirmCard）。

⭐ W12 D4 前端两处防线（useChat.sendMessage）：
- **B4** fetch 后先查 `res.ok`：后端 4xx/5xx 回的是 JSON 不是 SSE 流，不查就是永远空着的空气泡（404 提示"会话不存在"，其余"请求失败"）。
- **B5** 30 秒是【空闲超时】不是总超时：读流循环每收到一块就重置倒计时 —— 长 Agent Loop（多轮非流式+工具）不再被误杀；总超时 abort 后后端不知情照常干完并落记忆，用户重发就是重复记账。

## 四、六张表与三类"历史"的分工

| 表 | 是什么 | 生命周期 |
|---|---|---|
| `expenses` | 业务真账（`deleted_at` 软删） | 永久 |
| `budgets` | ⭐ W12 D4 每月预算（分类唯一键，upsert；七类+"总体"） | 永久 |
| `pending_expenses` | HITL 提案（status: pending→confirmed/rejected 单向；`expense_id` 回填是对账证据） | 永久 |
| `traces` | 【给人看的案卷】一行一事件 | 滚动清理，只留最近 200 卷（整卷删，防腰斩造假证据） |
| `conversations` / `messages` | 【给模型重看的记忆】 | 不清理（清了=失忆） |

⭐ 三类"历史"容易混，职责完全不同：
1. **前端 `messages` state** —— 只是显示副本，真身在库里；`role:'system'` 的确认回执只给人看。
2. **`messages` 表** —— 模型的记忆，`buildHistory` 从这重建；工具回执（role='tool'）也存（#38 失忆事故的根治）。
3. **`traces` 表** —— 观测证据，对账 `judge` 只信它 + 真库，不信模型的嘴。

## 五、HITL 流（高风险记账）

```
add_expense 判定 risk（>5000 元 / 一轮≥3笔 / 累计≥3笔）
  → createPending 冻结数字，回执 "待确认（提案 #N）…本笔尚未记入"
  → controller 流末尾 [CONFIRM] → 前端 ConfirmCard
  → 用户点击 → POST /api/chat/confirm|reject { id }（⭐ 全程无 LLM，模型不在这条路径上）
  → confirmPending：一句 UPDATE 抢锁（status+TTL 24h 同一句 SQL，防双击/防过期）
     → INSERT expenses → 回填 expense_id
```

幂等防线（`addExpense.findRecentSame`，10 分钟窗口，`note <=> ?` null-safe）：完全相同的一笔 10 分钟内已落库 → 回执"已记账（#id）…未重复记入"；还在 pending → 回执"待确认…没有重复提交"。rejected 和已软删的故意不去重（用户改主意应该能记）。

## 六、对账 + 自检（audit.ts，一套规则两个时机）

- `judge(traceId, text)`：纯判断。事实来自案卷（traces）+ 真库（`hasRecentConfirmed`），说法来自 text。
- `reflect`：流式**之前**审草稿，不合格注入纠正指令让模型重写（机器查错，模型措辞）。
- `reconcile`：`res.end()` **之后**审最终回复，不合格记 mismatch 事件——只告警不拦人。

规则速查（改回执文案必须同步这里，回执开头词是协议不是文案）：

| # | 抓什么 | 依据 |
|---|---|---|
| ④ | 转了提案但没请用户确认 | 回执 `待确认` 开头 + ASK_CONFIRM 词表 |
| ① | add 失败却没承认 | 回执非 `已记账` 开头 + ADMIT_FAIL 词表 |
| ② | add 成功却说没记上 | 回执 `已记账` 开头 + ADMIT_FAIL；⭐ W12 D4 B3 混合结局让位：`!pendingAdd && !failedAdd`（"成功+待确认"、"成功+失败"下诚实回复必然同时含两种说法） |
| ⑥ | 改/删/恢复全失败却没承认 | 回执 `已` 开头判成功 + ADMIT_EDIT_FAIL |
| ③ | 零工具却声称记上了（弱规则，词表猜） | CLAIM_ADD；⭐ W12 D4 前提加 `!attemptedBudget`（调过 set_budget 后说"记下了"合法） |
| ⑤ | 零工具却说"没记上"，而真库里最近有已确认落库的提案 | `hasRecentConfirmed`（查真库）；同样加了 `!attemptedBudget` |

⭐ W12 D4 B1：`hasRecentConfirmed`（规则③⑤共用）的"最近"按【确认时刻】算 —— JOIN 真账表拿 `expenses.created_at` 判（确认时刻 = 落库时刻），不看提案创建时间。旧版看提案 `created_at`，TTL 允许 24 小时内确认 → 用户在创建 10 分钟后才点确认时永远扑空，规则③把诚实的"记好了"判谎报、reflect 再把诚实草稿纠成谎话（trace 34623773 的镜像变体）。代价：它从此依赖 expenses 行真实存在，实验造 confirmed 提案必须配真 expenses 行（不变量 9，`exp:reconcile` 场景A 与 `exp:crud` 规则⑤造数据处已改）。验证：`exp:confirmsync` 支0（回拨提案 created_at 30 分钟后确认 + 对照组）。

⭐ W12 D4 预算回执也是协议的一部分：set_budget 成功以"已设置预算"开头、失败以"未设置"/"金额无效"/"设置失败"开头；add_expense 成功回执尾部可能捎带预算提醒（"还剩…"或"超出预算…"），只追加在尾部，开头词不动；confirm 回写的"已记账"回执同理。

## 七、多 Agent / 权限模型

权限 = 工具清单，不是 prompt 劝告（实测劝告可被说服）。`pickTools(...)` 决定一个 Agent 手上有哪几把钥匙；`runAgent` 不知道人格，人格和权限全在 `AgentConfig`（agents.ts）。换 Agent = controller 里换第一个参数。

## 八、踩过坑换来的不变量（改码前先对照）

1. **可信通道是工具回执**。往 messages 塞"系统事实"或改 systemPrompt 都实测无效（0/3）；模型只信自己伸手要来的东西。
2. **错误文本一旦进上下文就成了锚**。草稿永远不进 history / 记忆（3/3 vs 2/3 实测）；纠正时整句重写，别追加。
3. **能做成确定性的绝不交给模型判断**（风控阈值、幂等、对账规则、截断策略全是确定性代码）。
4. 回执**开头词**是对账协议：`已记账` / `待确认` / `已修改|已删除|已恢复`；失败词也要落在 ADMIT_* 词表内。改文案 = 改协议，两边同步。
   ⭐ W12 D4 B2 明确"以'已'开头 = 成功"这条判定的完整例外清单：它只用于规则⑥（改/删/恢复三工具的回执），
   任何【非成功】回执一律不得以"已"打头 —— 已踩过两次：restore 打空曾回"已恢复…本来就没被删除"（W12 D1，改为"未恢复"开头）；
   预算超限拒绝曾回"已拒绝执行"（W12 D4 B2，改为 **`超过上限，本次未执行`** 开头，落在 ADMIT_FAIL 内，见 agent.ts）。
5. traces 清理按**整卷**删；messages 截断对齐到 **user 边界**——两处同一个道理：不能腰斩。
   ⭐ W12 D4 补注：user 边界的对齐是两半合起来的 —— **头部**由 buildHistory 截断时对齐，**尾部**由 controller
   "先 appendMessage(user) 再 buildHistory"的调用顺序保证（重建时最后一条必是刚存的 user 消息）。
6. 观测层（logEvent / pruneTraces）自己坏掉不许弄死业务；对账放在 `res.end()` 之后。
7. 阈值只有一份：`MAX_AMOUNT` 从 addExpense export，别处 import。
8. 前端寄来的任何数值不可信：confirm 只收提案 id，金额在提案创建时已冻结。
9. **给对账规则加环境依赖（查真库/查时间）时，测这条规则的实验也在爆炸半径里**：
   W12 D1 规则③加了 `hasRecentConfirmed()` 前置查询，`exp:crud` 断言⑯被自造的
   confirmed 提案安抚而挂（23/24）；断言⑫-对照当时没炸只是确认窗口碰巧已过。
   修法：实验先清自造提案，断言按真库当下状态分两支（窗口内验"被容忍"、窗口外验"被拦"）。

## 九、已知薄弱点（诚实清单）

- 规则③是弱规则：词表外的报喜（零工具 + "搞定啦"）抓不到；且 W12 D1 下午起它先查真库 —— 确认后 10 分钟内凭空吹的"记好了"也会被放过（`exp:crud` ⑫⑯ 已改为按窗口分支断言，见不变量 9）。出路是 W12 D4 LLM-as-judge。
- 规则⑤存在已知误报可能（问的是另一笔而恰好最近有确认），接受——只告警不拦人。
- HITL 提案无列表页，刷新后找不回未处理的卡片。
- ~~HITL 确认结果不进模型记忆~~ → W12 D1 下午已修：confirm/reject 时①整句重写 messages 里那张"待确认"回执（拔锚）+ ②会话末尾追加成对的【申请表+新回执】（真相必须同时是可信通道和最新一句），见 `pending.ts` syncMemoryReceipt 与 devlog week12-day1；验证脚本 `npm run exp:confirmsync`。
