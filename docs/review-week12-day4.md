# Week 12 Day 4 · Stingy 综合评审工单（交给修复会话）

> 评审范围：对照 `docs/architecture.md` 逐文件核读了 server/src 全部业务代码（controller、agent、agents、pending、audit、conversation、trace、tools/ 六工具）+ schema.sql + client/src/hooks/useChat.ts。
> 评审时状态：前后端 `tsc --noEmit` 均 0；库状态健康（活账 10 行 442310.00 / pending 全终态 / traces 93 卷）。
> Express 版本：5.2.1（async handler 抛错会被框架兜住，下面 I2 的定性依赖这一点）。
> ⚠️ 修复规矩（老三条）：每条修复配实验或对照断言；改回执文案必须同步 audit.ts 词表和 architecture.md 协议表；修完跑全量回归（见第五节）。

## 一、architecture.md 校对结论

**总体：准确。** 流水线 12 步、五张表分工、对账规则表、HITL 流程、九条不变量，与代码逐一对上。需要小修的只有三处（见第六节），都是"补充"不是"纠错"。

## 二、🔴 Bug（按严重度排）

### B1 `hasRecentConfirmed` 用【提案创建时间】判"最近确认" —— 自检会把诚实草稿改写成谎话

- **位置**：`server/src/services/pending.ts` `hasRecentConfirmed()`（`created_at > NOW() - INTERVAL 10 MINUTE`）
- **问题**：`created_at` 是提案**创建**时刻，不是**确认**时刻。而 TTL 允许提案在 24 小时内被确认 —— 只要用户在提案创建 10 分钟后才点确认，这个函数就查不到这次确认。
- **事故链（最坏情形，规则③方向）**：
  1. 提案创建 30 分钟后用户点确认 → `syncMemoryReceipt` 正确回写"已记账"进记忆
  2. 用户下一轮问"记好了吗" → 模型凭记忆**诚实**起草"已记账（#N）" —— 零工具调用
  3. 规则③：CLAIM_ADD 命中 → 查 `hasRecentConfirmed()` → 扑空（提案创建已超 10 分钟）→ 判"谎报：零工具却声称已记账"
  4. reflect 注入零工具纠正话术："你还没有执行，如实承认" → **模型把诚实草稿改写成"还没记上"**
  5. reconcile 规则⑤本可抓这句反向谎报 → 同一个函数再次扑空 → **零告警**
  - 结局：用户被告知"还没记上"，可能重记一遍（10 分钟幂等窗口也早过了）→ 真实的重复记账。
  - ⭐ 这是 trace 34623773 事故的镜像变体：W12 D1 修好了"确认后 10 分钟内"的情形，但"确认发生在创建 10 分钟后"的情形从未被覆盖 —— exp:confirmsync 里提案都是造完立刻确认的，测不到这条时间轴。
- **修法（推荐，不改表）**：确认时刻 = expenses 落库时刻。改用 JOIN：
  ```sql
  SELECT p.id, p.expense_id FROM pending_expenses p
  JOIN expenses e ON e.id = p.expense_id
  WHERE p.status = 'confirmed' AND e.created_at > NOW() - INTERVAL ? MINUTE
  ORDER BY p.id DESC LIMIT 1
  ```
  （备选：pending_expenses 加 `confirmed_at` 列 —— 动 schema.sql，改动面大，本次不必。）
- **验证**：新实验或在 exp:confirmsync 里加一支：造提案后 `UPDATE pending_expenses SET created_at = NOW() - INTERVAL 30 MINUTE`，再确认，再 `judge(trace, '记好了，已入账')` → 期望 ok（修前会误报）；对照组：不确认直接 judge → 期望仍报谎报（证明没把规则③修死）。

### B2 "已拒绝执行"回执违反开头词协议 —— 规则⑥被它骗过

- **位置**：`server/src/services/agent.ts` 工具预算超限的回执：`已拒绝执行：本次请求的工具调用次数已达上限…`
- **问题**：回执开头词是协议：规则⑥用 `startsWith('已')` 判改/删/恢复成功。预算超限的 update/delete/restore 调用，回执以"已"开头 → 被当成**成功**。
- **事故链**：模型连调 6 次 delete，第 6 次被预算拒绝且前 5 次全部"找不到这笔" → `succeededEdit` 因第 6 次的"已拒绝执行"误判为 true → 规则⑥沉默 → 模型说"都删好了"无人抓。
- **修法**：改回执开头，不以"已"打头，例如：`超过上限，本次未执行：本次请求的工具调用次数已达上限（5 次）。请向用户说明并让用户逐笔确认。`（"超过上限"已在 ADMIT_FAIL 词表内，模型如实转述时规则①不会误报。）改完把这个开头词记进 architecture.md 协议表（不变量 4）。
- **验证**：exp 里直接 `logEvent` 造一卷"delete 全失败 + 一条已拒绝执行"，`judge(trace, '都删好了')` → 期望报谎报（修前沉默）。

### B3 规则② 混合结局误报：一笔成功 + 一笔失败，诚实回复被判"反向谎报"

- **位置**：`server/src/services/audit.ts` 规则②：`succeededAdd && admitted && !pendingAdd`
- **问题**：两笔 add，一笔"已记账"一笔"写入数据库失败" → 诚实回复必然同时含"记好了"和"没记上"（admitted=true）→ 规则②命中 → 误报。W12 D1 给"成功+待确认"混合打过 `!pendingAdd` 补丁，"成功+失败"这个组合漏了 —— 同一课的第二只脚：**每加一种结局，所有旧规则都要重审一遍**。
- **修法**：补对称条件。`const failedAdd = addCalls.some((r) => !r.result?.startsWith('已记账') && !r.result?.startsWith('待确认'));` 规则②加 `&& !failedAdd`。
- **验证**：exp 造一卷两条 add_expense（一成一败），`judge(trace, '第一笔记好了，第二笔没记上')` → 期望 ok（修前误报）；对照组：单笔成功 + 回复"没记上" → 期望仍报反向谎报。

### B4 前端不检查 `res.ok` —— 后端 4xx/5xx 时静默空气泡

- **位置**：`client/src/hooks/useChat.ts` `sendMessage`（fetch /api/chat 之后只查了 `res.body`）
- **问题**：后端返回 400/404/500 JSON（如会话不存在、body 校验失败）时，前端照样按 SSE 读流 → 没有任何 `data:` 行 → 循环安静结束 → 空 AI 气泡永远空着，无提示。
- **修法**：fetch 后加 `if (!res.ok) { setMessages((prev) => updateLast(prev, '⚠️ 请求失败，请重试')); return; }`（细分 404 可提示"会话不存在，请新建对话"）。
- **验证**：手测：DevTools 里把 conversationId 改成 99999 发一条 → 期望气泡显示错误而不是空白。

### B5 前端 30 秒是【总】超时，压不住多轮 Agent Loop

- **位置**：`client/src/hooks/useChat.ts` `TIMEOUT_MS = 30_000`，定时器从发送起计，收到数据不重置
- **问题**：Agent Loop 最多 5 轮非流式 LLM 调用 + 工具 + 最终流式轮，一次"查账再改两笔"完全可能超 30 秒。前端到点 abort → 显示"响应超时"，**但后端不知情，照常干完并把回复落进记忆** → 用户以为失败重发一遍 → 幂等窗口若已过就是重复记账；而且切回会话会看到一条"凭空出现"的完整回复。
- **修法**：改成**空闲超时**：读流循环里每收到一块就 `clearTimeout + setTimeout` 重置。语义从"30 秒内必须干完"变成"30 秒没吐任何字才算死"。
- **验证**：手测一条会连调多个工具的长请求（如"查一下最近账，把打车那笔改成 35，再删掉星巴克那笔"），确认不再误报超时。

### B6 `deleted:true + group_by:'category'` 组合：汇总文案不说"已删除"

- **位置**：`server/src/services/tools/queryExpenses.ts` 汇总路的返回文案
- **问题**：明细路对已删记录有"均未计入统计"抬头，汇总路没有 —— `deleted:true` 时汇总返回"最近 N 天分类汇总（合计 X 元）"，模型可能把已删账目的合计当真实开销报给用户。
- **修法**：汇总路文案按 `onlyDeleted` 分支：`最近 N 天【已删除记录】分类汇总（均未计入统计，合计 X 元）`。
- **验证**：exp:groupby 加一支：造一笔删掉的账，`queryExpenses('{"deleted":true,"group_by":"category"}')` → 断言返回含"已删除""未计入统计"。

## 三、🟡 改进建议（非 bug，顺手修或攒着）

| # | 位置 | 内容 |
|---|---|---|
| I1 | useChat `decidePending` | 409 时不分原因直接把卡片标成 confirmed/rejected —— 但 409 也可能是"已过期"或"被对方处理成相反状态"。应读 `body.reason` 展示真实终态 |
| I2 | controller `appendMessage(user)` 在 try 外 | DB 抖动时 Express 5 会兜住不炸进程，但此时 SSE 头已设置，前端拿到的是穿 SSE 衣服的 500 → 配合 B4 一起：挪进 try，走 [ERROR] 通道 |
| I3 | pending.ts `hasRecentConfirmed` | 不分会话全局查（单用户产品可接受）。将来多会话并发用时要带 conversation 维度 —— 先记录不修 |
| I4 | pending.ts `syncMemoryReceipt` | `content LIKE` 全表扫 messages（无索引）。当前量级无感，量大后是慢查询 —— 先记录不修 |
| I5 | messages 表 | 唯一无限增长且无清理策略的表（HISTORY_LIMIT 只是读窗口）。将来要归档策略 —— 先记录不修 |
| I6 | conversations | 没有删除/重命名接口，侧栏只增不减 —— 归入功能建议 |

## 四、已知取舍（不要当新 bug 修）

- 规则③弱规则（词表外报喜抓不到）、规则⑤可能误报 —— architecture.md 第九节已记录，出路 LLM-as-judge。
- Reflection 出口 B（跑满 5 轮无草稿不自检）—— 学员 W12 D4 拍板**不修**，reconcile 兜底。
- 确认后 10 分钟内凭空吹"记好了"会被规则③放过 —— W12 D1 显式取舍。
- HITL 卡片刷新丢失 —— 归入功能建议（提案中心），不在本工单。

## 五、修复后的回归要求

1. `npx tsc --noEmit` 前后端均 0。
2. 全量实验：`exp:crud`（24/24）、`exp:confirmsync`（2/2 + B1 新增支）、`exp:afterconfirm`、`exp:reconcile`、`exp:prune`（5/5）、`exp:memory`（11/11）、`exp:groupby`（+B6 新增支）。
3. 每条 B 级修复配一个对照组断言（证明没把规则修死），照"每条补丁配一个对照组"的规矩。
4. 改了回执文案（B2）→ 同步 audit.ts 注释 + architecture.md 不变量 4。
5. 修完同步 docs/architecture.md（学员规矩：每次改码必同步）。

## 六、architecture.md 需要同步的点（修复会话顺手改）

1. 不变量 4 协议表：补上预算超限回执的开头词（B2 修完后的新词），并注明"以'已'开头 = 成功"这条判定的完整例外清单。
2. 不变量 5 "messages 截断对齐到 user 边界"：补一句"头部由 buildHistory 对齐，尾部由'先存 user 再重建'的调用顺序保证"—— 现状正确但文档没说尾部靠什么。
3. schema.sql expenses 注释"查账 SQL 带 deleted_at IS NULL 的实际只有 2 处"：updateExpense 的 UPDATE WHERE 里还有一处（性质是防改已删行，不是查账），补一笔免得未来人数不对。
