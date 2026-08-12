# 工单：仪表盘增强 S1+（W12 D4 下午拍板 · 交新会话执行）

> 背景：S1 月度仪表盘（`GET /api/stats/summary` + 四卡面板）当天上午已验收上线。
> 学员看过真机截图后拍板了本工单的 7 项改动。**本工单 = 全部决策已定，执行会话不需要再问方案**。
> 规矩：只做工单里的事；注释用 emoji 前缀（🎨 UI / ⚛️ React 逻辑 / 🗄️ SQL / 🔵 类型 / 🟡 校验 / 🤖 给模型的话术）；
> 服务端 import 相对路径带 `.js`；前后端类型手写同步；图表继续**零依赖手写**，不引图表库。

## 拍板记录（执行时不要翻案）

| # | 决定 | 备注 |
|---|---|---|
| ② | 月份切换：`month` 参数吃四块数据；**预算进度卡只在当前月显示** | budgets 表没有历史额度（只存当前值），历史月的进度条画不诚实，隐藏是显式取舍 |
| ① | 流水列表显示**所选月份的全部流水**，不是"最近 N 笔" | 切到 7 月时流水必须也是 7 月的，不能数据打架 |
| ⑤ | 饼图**替代**分类横条图卡片 | 老师推荐 donut 与横条并列，学员拍板替代。排行信息转入饼图图例保留 |
| ⑥ | 改名：侧栏入口「📊 报表」；页面顶部标题就是月份切换器本身 | "本月统计"会被月份切换杀死 |
| ⑦ | 统计页与聊天页做**视觉区分**，不动导航结构、不上路由库 | 学员明确：说的是视觉区分度，不是架构 |
| ④ | 修柱状图底部横线被顶起的 bug | 病因已定位，见 T3 |
| ③ | 逐日图空状态给引导文案 | 纯展示层 |

---

## T1 后端：stats 接口演进（唯一动后端的一块）

**`server/src/services/stats.ts`**

- `getStatsSummary(month: string)`：签名加必填参数 `month`（格式 `YYYY-MM`，controller 校验完才进来）。
- 现在的 `MONTH_START` / `PREV_MONTH_START` 两个 `CURDATE()` 常量废弃，改为由参数算边界：
  - 所选月起点：`?-01`（拼 `${month}-01` 作为 SQL 参数传入，不做字符串内插 SQL）
  - 下月起点：`DATE_ADD(?, INTERVAL 1 MONTH)`；上月起点：`DATE_SUB(?, INTERVAL 1 MONTH)`
  - 月总/分类/逐日三条 SQL 全部改成 `created_at >= 起点 AND created_at < 下月起点`（原逐日 SQL 少了上界，顺手补上）
- `monthTotal` 不再复用 `monthSpent(null)`（它写死当前月，且被记账回执提醒共用，**不许动它**）——统计层自己写一条带月份边界的 SUM。
- 环比语义变为：**所选月 vs 它的上一个月**（`prevMonthTotal` 跟着参数走）。
- 新增 `recent`：所选月份全部流水，`SELECT id, amount, category, note, DATE_FORMAT(created_at,'%Y-%m-%d') AS day FROM expenses WHERE deleted_at IS NULL AND 月份边界 ORDER BY created_at DESC, id DESC`。上限 `LIMIT 100` 兜底。
- `budgets`：仅当 `month` 等于当前月（服务端自己判）才计算返回，历史月返回 `[]`。响应加一个 `isCurrentMonth: boolean` 字段，前端靠它区分"历史月隐藏预算卡"和"当前月没设预算"。
- ⚠️ 所有新 SQL 照旧带 `deleted_at IS NULL`。

**`server/src/controllers/stats.ts`**

- 读 `req.query.month`；缺省 = 当前月（服务端算，别信客户端时钟）。
- 🟡 校验：正则 `^\d{4}-(0[1-9]|1[0-2])$`，不合法返回 400 `{ error: 'month 参数格式应为 YYYY-MM' }`。

**`server/src/routes/stats.ts`**：不动，还是 `GET /summary`。

## T2 前端：类型与 hook

**`client/src/types/stats.ts`**（与后端手写同步）

- `StatsSummary` 加 `recent: { id: number; amount: number; category: string; note: string | null; day: string }[]` 和 `isCurrentMonth: boolean`。

**`client/src/hooks/useStats.ts`**

- hook 接受月份：内部 `useState` 存 `month`（`'YYYY-MM'`，初始 = 当前月），暴露 `month / prevMonth() / nextMonth()`（或 `setMonth`，二选一，实现者定）。
- `useEffect` 依赖 `[month]`，切月重新 fetch `/api/stats/summary?month=...`；切月瞬间把 `stats` 置回 `null` 走"加载中"，别让旧月数据挂在新月标题下面。
- `alive` 开关的老规矩保留。

## T3 前端：StatsPanel 改造

**月份切换器（顶部，替代原"本月总支出"卡的月份字样）**

- `← 2026年8月 →` 居中；右箭头在当前月**禁用**（不能看未来）；左箭头不设下限（历史月没数据就是全空，诚实显示）。
- 头卡文案"X 月总支出（不含已删除）"跟随所选月；环比小字"上月 ¥…"含义自动跟随（T1 已改语义）。

**预算进度卡**

- `stats.isCurrentMonth === false` → 整卡不渲染（连"还没设置预算"的引导都不给，那是当前月的话术）。

**饼图卡（替代原"本月分类排行"横条卡）**

- 零依赖：一个 div 用 CSS `conic-gradient` 画环形（中间叠一个白色圆做 donut 也行，实现者定，不引库）。
- Tailwind 类名进不了 gradient，另建一份十六进制色表，**与 `CATEGORY_COLORS` 同序同色**：
  餐饮 `#fb923c` / 交通 `#38bdf8` / 购物 `#f472b6` / 娱乐 `#a78bfa` / 居家 `#34d399` / 医疗 `#f87171` / 其他 `#a1a1aa`。
- 右侧图例保留排行信息：色点 + 分类名 + `¥金额（N 笔 · XX%）`，按金额降序（`byCategory` 本来就是降序）。
- 空数据：显示"这个月还没有记账"。

**流水列表卡（新增，放最底）**

- 标题「当月流水」；行 = 日期（`day` 后两位 + "日"）/ 分类（色点复用色表）/ 备注（空显示 "—"，过长 truncate）/ 金额右对齐。
- 空数据同样给一句引导。

**逐日柱状图两处**

- ④ bug 修复：横轴标签 span 现在空串零高度、有字的列被 `items-end` 顶高。给**每一列**的标签 span 固定高度（如 `h-3 leading-3`），空不空都占同一格，底线自然齐。
- ③ 空状态：`stats.daily.length === 0` 时整个图区换成一句引导文案（如"这个月还没有记账，去聊天里说一句就有了"）；有数据但很少时不加处理（占位灰柱已存在）。

## T4 前端：改名 + 视觉区分

- `ConversationList.tsx`：侧栏入口「📊 本月统计」→「📊 报表」。
- `App.tsx`：顶栏副标题 `'本月统计'` → `'报表'`。
- 🎨 视觉区分（只做这一层，不动导航）：报表视图的主区背景改 `bg-gray-50`，四张卡改成 `bg-white shadow-sm`（边框可留可去，实现者定）；聊天视图保持纯白。目标：一眼分清"我在看报表"还是"我在聊天"。

## 验收（全部要机器证据，口头"好了"不算）

1. `npx tsc --noEmit` 前后端都 0 错。
2. `curl '…/api/stats/summary?month=2026-07'` 的 `monthTotal` 与直接 SQL `SELECT SUM(amount) … WHERE deleted_at IS NULL AND 7月边界` 对得上；`month=2026-13` 返回 400。
3. 浏览器真机：切上月→预算卡消失、流水/头卡/饼图/柱状图全部跟着变；切回当前月→预算卡回来；右箭头在当前月禁用。
4. 柱状图对齐：取有字列与无字列各一根柱子，`offsetTop + offsetHeight` 相等（控制台量，别目测）。
5. 截图存档。

## 收尾（项目规矩）

- 同步 `docs/architecture.md`：stats 接口的 month 参数与 recent 字段、StatsPanel 五卡结构、改名。
- 当天 devlog 补一行交付记录。
