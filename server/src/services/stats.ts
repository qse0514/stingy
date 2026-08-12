// 🗄️ 统计层（W12 D4 · S1 月度仪表盘 → S1+ 报表）：给前端仪表盘的只读聚合
//    ⭐ 全程零 LLM、零写库 —— 统计是"看一眼"的事，不该走"问一句"的聊天链路
//    ⭐ 所有 SQL 都带 deleted_at IS NULL：软删的账不算开销（和 queryExpenses 同一条规矩）
//    ⭐ S1+：接口吃 month 参数（YYYY-MM），四块数据全部跟着所选月走；
//      月份边界仍交给 MySQL 算（DATE_ADD/DATE_SUB），JS 不手搓日期（时区坑）
import { pool } from './db.js';
import { monthSpent, OVERALL } from './tools/budget.js';

// 🔵 仪表盘一屏要的全部数据，一个接口一次给齐（前端不用发四次请求）
export interface StatsSummary {
  monthTotal: number;                                          // 所选月总支出
  prevMonthTotal: number;                                      // 所选月的上一个月（环比语义跟着 month 参数走）
  byCategory: { category: string; total: number; cnt: number }[]; // 所选月分类汇总
  daily: { day: string; total: number }[];                     // 所选月逐日支出
  // 🗄️ ⭐ S1+ 取舍：budgets 表只存当前额度没有历史，历史月的进度条画不诚实 ——
  //    所以预算进度只在当前月计算，历史月返回 []
  budgets: { category: string; amount: number; spent: number }[];
  recent: { id: number; amount: number; category: string; note: string | null; day: string }[]; // 所选月全部流水
  // 🔵 前端靠它区分"历史月隐藏预算卡"和"当前月没设预算"（budgets 为 [] 时两种含义不同）
  isCurrentMonth: boolean;
}

// 🗄️ 当前月 'YYYY-MM'：拿 MySQL 的 CURDATE() 算 —— monthSpent 的"本月"就是它的时钟，
//    isCurrentMonth 判定和预算进度必须用同一个时钟（Node 和 MySQL 时区可能不一致）
//    ⭐ export 给 controller 当缺省值用（缺省月份服务端算，不信客户端时钟）
export async function currentMonth(): Promise<string> {
  const [rows] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m') AS m");
  return (rows as { m: string }[])[0]!.m;
}

export async function getStatsSummary(month: string): Promise<StatsSummary> {
  // 🗄️ 所选月起点：拼 '-01' 后作为 SQL【参数】传入（? 占位符，不做字符串内插 SQL）；
  //    下月/上月起点由 MySQL 的 DATE_ADD/DATE_SUB 从它推算
  const monthStart = `${month}-01`;

  const isCurrentMonth = (await currentMonth()) === month;

  // 🗄️ 所选月总支出：统计层自己的 SUM，带完整月份边界
  //    ⚠️ 不复用 monthSpent(null)：它写死当前月，且被记账回执提醒共用 —— 不许动它
  const [totalRows] = await pool.query(
    `SELECT IFNULL(SUM(amount), 0) AS total FROM expenses
     WHERE deleted_at IS NULL
       AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 MONTH)`,
    [monthStart, monthStart],
  );
  const monthTotal = Number((totalRows as { total: string }[])[0]?.total ?? 0);

  // 🗄️ 环比的分母：所选月的【上一个月】总支出（上月 1 号 ≤ created_at < 所选月 1 号）
  const [prevRows] = await pool.query(
    `SELECT IFNULL(SUM(amount), 0) AS total FROM expenses
     WHERE deleted_at IS NULL
       AND created_at >= DATE_SUB(?, INTERVAL 1 MONTH) AND created_at < ?`,
    [monthStart, monthStart],
  );
  const prevMonthTotal = Number((prevRows as { total: string }[])[0]?.total ?? 0);

  // 🗄️ 所选月分类汇总：花最多的排最上面
  const [catRows] = await pool.query(
    `SELECT category, SUM(amount) AS total, COUNT(*) AS cnt FROM expenses
     WHERE deleted_at IS NULL
       AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 MONTH)
     GROUP BY category ORDER BY total DESC`,
    [monthStart, monthStart],
  );
  const byCategory = (catRows as { category: string; total: string; cnt: number }[]).map((r) => ({
    category: r.category,
    total: Number(r.total),
    cnt: Number(r.cnt),
  }));

  // 🗄️ 所选月逐日：没记账的日子不出行，空档由前端补零画柱
  //    （原版少了上界，历史月会把后面月份搅进来 —— S1+ 顺手补上）
  const [dayRows] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, SUM(amount) AS total FROM expenses
     WHERE deleted_at IS NULL
       AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 MONTH)
     GROUP BY day ORDER BY day`,
    [monthStart, monthStart],
  );
  const daily = (dayRows as { day: string; total: string }[]).map((r) => ({
    day: r.day,
    total: Number(r.total),
  }));

  // 🗄️ ⭐ S1+ 新增：所选月全部流水（最新的在上）。LIMIT 100 兜底 ——
  //    一个月手动记账超过 100 笔再谈分页，先不为不存在的量级设计
  const [recentRows] = await pool.query(
    `SELECT id, amount, category, note, DATE_FORMAT(created_at, '%Y-%m-%d') AS day
     FROM expenses
     WHERE deleted_at IS NULL
       AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 MONTH)
     ORDER BY created_at DESC, id DESC LIMIT 100`,
    [monthStart, monthStart],
  );
  const recent = (recentRows as { id: number; amount: string; category: string; note: string | null; day: string }[]).map(
    (r) => ({ id: r.id, amount: Number(r.amount), category: r.category, note: r.note, day: r.day }),
  );

  // 🗄️ 预算进度：只在当前月算（budgets 表没有历史额度，历史月的进度条画不诚实）。
  //    spent 用 budget.ts 的同一份 monthSpent —— 仪表盘进度条和记账回执里的提醒
  //    必须永远说同一个数（monthSpent 写死当前月，正好只有当前月用它）
  const budgets: StatsSummary['budgets'] = [];
  if (isCurrentMonth) {
    const [budgetRows] = await pool.query('SELECT category, amount FROM budgets ORDER BY id');
    for (const b of budgetRows as { category: string; amount: string }[]) {
      budgets.push({
        category: b.category,
        amount: Number(b.amount),
        spent: b.category === OVERALL ? monthTotal : await monthSpent(b.category),
      });
    }
  }

  return { monthTotal, prevMonthTotal, byCategory, daily, budgets, recent, isCurrentMonth };
}
