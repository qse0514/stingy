# 工单：报表页视觉优化 + 会话删除 S1++（W12 D4 晚拍板 · 交新会话执行）

> 背景：S1+（月份切换/饼图/流水/改名「报表」）当天已验收上线。学员看真机后拍板第二轮视觉优化，并把 backlog M4 的会话删除功能并入本单。
> **除 T7 会话删除外全是前端展示层**（`/api/stats/summary` 与 `useStats` 一个字段都不加）。
> 规矩：注释 emoji 前缀；图表零依赖手写不引库；服务端 import 相对路径带 `.js`。
> 动的文件：前端 `StatsPanel.tsx` / `ConversationList.tsx` / `App.tsx` / `useChat.ts`；
> 后端（仅 T7）`routes/conversations.ts` / `controllers/chat.ts` / `services/conversation.ts`。

## 拍板记录（执行时不要翻案）

| # | 决定 | 备注 |
|---|---|---|
| ① | 上半区改**两列栅格**：概览卡 2/3 + 饼图卡 1/3 并排；逐日、流水保持全宽 | 饼图 144px 占一整行是最大浪费 |
| ② | 头卡与预算卡**合并**为「本月概览」，加**日均**与**月底预测**两行 | 纯前端计算，零后端 |
| ③ | 侧栏改**分段导航**（方案 A）：顶部「💬 对话」「📊 报表」并列 tab，替代现在混在列表里的报表按钮 | 现状报表入口长得像一条聊天记录 |
| ④-1 | donut **圆心放总金额** | 中心空洞是免费地皮 |
| ④-2 | **空月份整页收敛**成一个空状态，不摆三张各说一遍"没记账"的空卡 | 文案重复三遍 |
| ④-4 | 流水标题跟月份走：「当月流水」→「N 月流水」 | 历史月叫"当月"是说谎 |
| — | ④-3 流水按日分组、④-5 最高日标金额：**不做**（学员未选） | |
| T7 | **会话删除**（backlog M4 转正）：硬删 + 事务，悬停出 × 钮 + window.confirm 二次确认 | 会话是模型记忆，删 = 彻底遗忘；expenses 软删规矩不适用，账本数据不受影响 |
| ⑥ | 窄屏响应式：**不做，进 backlog**（已记 M2） | 子代理窄窗截图实锤会挤爆，量级到了再修 |

---

## T1 侧栏分段导航（`ConversationList.tsx` + `App.tsx`）

- `ConversationList` 顶部新增分段控件：一个圆角容器里「💬 对话」「📊 报表」两个按钮各占一半宽；
  选中态 `bg-zinc-800 text-zinc-50`，未选中 `text-zinc-400 hover:text-zinc-200`。
- 点「对话」= 切回聊天视图并**保持当前会话**（不新建、不清空）。需要 App 新传一个
  `onShowChat: () => setView('chat')`；现有 `onShowStats` 保留。原来 27-34 行那个
  「📊 报表」按钮**删掉**。
- 🎨 看报表时，下方"新对话"按钮 + 会话列表整体调暗一档（如包一层 `opacity-50`），
  强化"你已经离开聊天区了"；点任一会话仍然正常切回聊天（现有行为不变）。
- 「新对话」按钮和「对话」小标题的位置不动，都在分段控件下面。

## T2 概览卡合并 + 日均/预测（`StatsPanel.tsx`）

- 头卡与预算卡合并为一张「本月概览」：上半 = 大数字 + 环比小字；下半 = 预算条列表（样式照旧）。
- 环比行小修：`prevMonthTotal === 0` 时连"上月 ¥0"小字也不显示（没有信息量）。
- 新增一行小字：`日均 ¥X · 照此速度月底约 ¥Y`
  - 日均分母：当前月 = 今天是几号（`new Date().getDate()`）；历史月 = 该月总天数（`daysInMonth` 已算好）。
  - 预测 = 日均 × 当月总天数，**只在当前月显示**（历史月"预测"没有意义，只留日均）。
  - `monthTotal === 0` 时这行整个不显示（日均 ¥0 是废话）。
- 预算部分沿用现有规则：`isCurrentMonth === false` 不渲染预算区（含引导文案）；
  当前月没设预算仍显示那句"在对话里说一句…"引导。

## T3 两列栅格（`StatsPanel.tsx`）

- 容器 `max-w-3xl` 放宽到 `max-w-4xl`；卡片区改 `grid grid-cols-3 gap-6`：
  概览卡 `col-span-2`、饼图卡 `col-span-1`、逐日和流水各 `col-span-3`。
- 饼图卡变窄后布局改竖排：donut 居中在上（尺寸可缩到 `h-28 w-28`，实现者定），图例竖排在下。
- 月份切换器不进栅格，仍在卡片区上方居中。
- 加载中/出错分支的布局照旧（切换器常驻，正文换提示），不用栅格。

## T4 donut 圆心总金额（`StatsPanel.tsx`）

- 中心白圆里绝对定位居中两行：`¥总额`（`text-sm font-semibold text-gray-800`）+ `N 笔`（`text-[10px] text-gray-400`）。
- 总额就是 `catSum`，笔数 = `byCategory` 各 `cnt` 之和。金额过长自己缩字号或只保留整数，实现者定，别溢出圆外。

## T5 空月份整页收敛（`StatsPanel.tsx`）

判定：`stats.recent.length === 0`（流水空 = 这个月零记账）。

- **历史月**：月份切换器 + 单独一张卡「2026年7月没有记账」，其余四张卡全不渲染。
- **当前月**：月份切换器 + 概览卡（预算引导有价值，保留）+ 单独一张空状态卡
  「这个月还没有记账，去聊天里说一句就有了」，替代饼图/逐日/流水三张。
- 三张卡里现有的各自空文案（164/195/224 行）随之删掉——空状态只在一个地方说话。

## T6 标题跟月份（`StatsPanel.tsx`）

- 流水卡标题「当月流水」→ `` `${monthNum} 月流水` ``。其余卡标题不动（"逐日支出""分类占比"没说谎）。

## T7 会话删除（唯一动后端的一块）

**后端**

- `services/conversation.ts` 新增 `deleteConversation(id: number)`：事务里两条 DELETE ——
  先 `DELETE FROM messages WHERE conversation_id = ?`，再 `DELETE FROM conversations WHERE id = ?`
  （schema 没建外键，级联靠手动；顺序反了会留孤儿 messages）。用 `pool.getConnection()` +
  `beginTransaction/commit/rollback`，finally 里 `connection.release()`。
- 🗄️ **硬删，不软删**（拍板已定）：traces（按 trace_id，不引用会话）与 expenses 均不受影响；
  该会话里尚未处理的 pending 提案不追删，留给 24h TTL 自然失效（接受的尾巴，写进注释）。
- `controllers/chat.ts` 新增 `handleDeleteConversation`：🟡 `Number(req.params.id)` 非正整数还 400；
  `conversationExists` 查不到还 404（和现有接口同一个立场：不存在的 id 不能默默成功）；
  成功还 `204 No Content`；异常 500 + 🟢 真相给日志。
- `routes/conversations.ts` 加 `router.delete('/:id', handleDeleteConversation)`。

**前端**

- `useChat.ts` 新增并导出 `deleteConversation(id: number)`：`fetch` DELETE；成功后
  `loadConversations()` 刷侧栏；若删的正是 `conversationId` 当前会话 → 先 `ctrlRef.current?.abort()`
  再清屏回新对话（复用 `newConversation` 的逻辑）；失败 `console.error` + 不动 UI（侧栏还在，用户可重试）。
- `ConversationList.tsx`：每行悬停时右侧出现 × 按钮（`group` + `group-hover` 实现，平时不占位）；
  点击先 `e.stopPropagation()`（别触发选中会话），再 `window.confirm('删除该对话？记录不可恢复')`，
  确认才调 `onDelete(id)`（新 prop，App 穿线到 hook）。

## 验收（机器证据，口头"好了"不算）

1. `npx tsc --noEmit` 前后端都 0 错（T7 动了后端）。
2. 浏览器真机（8 月，有数据）：概览卡与饼图并排两列；概览卡里有环比 + 日均 + 预测 + 预算条；donut 圆心显示总额与笔数；流水标题「8 月流水」；侧栏顶部分段导航，点「对话」回聊天且当前会话还在，点「📊 报表」回报表。
3. 切到 7 月（空月）：整页只有切换器 + 一张「没有记账」卡，**页面上"没有记账"只出现一次**（控制台 `document.body.innerText.match(/没有记账/g).length === 1` 量，别目测）。
4. 会话列表在报表视图下明显变暗，回聊天恢复。
5. T7 后端：建一个测试会话后 `curl -X DELETE` 返回 204，随后 **SQL 直查** `SELECT COUNT(*) FROM messages WHERE conversation_id = 删掉的id` 必须为 0（孤儿行 = 事务没包住）；删不存在的 id 返 404；`abc` 返 400。
6. T7 前端：悬停出 × → confirm → 侧栏该行消失；删掉**当前**会话后主区变新对话空屏；取消 confirm 则什么都不发生（Network 面板零请求）。
7. 截图存档 `docs/screenshots/`。

## 收尾（项目规矩）

- 同步 `docs/architecture.md`：StatsPanel 栅格与卡片结构（五卡 → 四卡：概览合并）、侧栏分段导航、`DELETE /api/conversations/:id` 路由。
- 当天 devlog 补一行交付记录。
