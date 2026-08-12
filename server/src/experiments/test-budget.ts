// 🔬 实验：预算功能（W12 D4 · set_budget / query_budget / 记账回执捎带提醒）
//    验四块：
//      A 工具校验（坏 JSON / 非法分类 / 非法金额）
//      B upsert（首设 / 覆盖要念"原为"）
//      C ⭐ 记账回执捎带提醒（未超支说"还剩"、超支说"超出预算"、分类没预算退"总体"）
//      D ⭐ 对账规则③重审（调过 set_budget 后说"记下了"不算谎报）+ 对照组（规则③还活着）
//
//    ⭐ 自包含：budgets 只动四个分类，开场备份这几行、finally 还原；
//      造的账目 note 带"预算实验"前缀，清理用 LIKE；假案卷 exp-budget- 前缀同理
//    ⚠️ 不变量 9：对照组那条断言依赖真库（hasRecentConfirmed），按真库当下状态分两支
import { pool } from '../services/db.js';
import { setBudgetTool, queryBudgetTool, budgetReminder } from '../services/tools/budget.js';
import { addExpenseTool } from '../services/tools/addExpense.js';
import { judge } from '../services/audit.js';
import { hasRecentConfirmed } from '../services/pending.js';
import { logEvent } from '../services/trace.js';
import type { ToolContext } from '../services/tools/types.js';

const NOTE = '预算实验';       // 🔬 账目标记：清理用 LIKE 认它
const FAKE = 'exp-budget-';    // 🔬 假案卷前缀
const TOUCHED = ['餐饮', '交通', '医疗', '总体']; // 🔬 会动到的预算分类，只备份/还原这几行

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`  ✅ ${name}：${detail}`); }
  else { fail++; console.log(`  ❌ ${name}：${detail}`); }
}

// 🔬 给 addExpenseTool 的最小上下文：seq/batch 都压在风控线以下，不触发 HITL
function ctx(): ToolContext {
  return { traceId: `${FAKE}add`, agent: 'exp-budget', seq: 1, batch: 1 };
}

async function monthSpentFor(category: string): Promise<number> {
  const [rows] = await pool.query(
    `SELECT IFNULL(SUM(amount), 0) AS total FROM expenses
     WHERE deleted_at IS NULL AND category = ?
       AND created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
    [category],
  );
  return Number((rows as { total: string }[])[0]?.total ?? 0);
}

async function main() {
  // ── ① 备份要动到的预算行（budgets 按分类唯一，还原 = 删掉再插回原值）────
  const [bak] = await pool.query(
    'SELECT category, amount FROM budgets WHERE category IN (?, ?, ?, ?)',
    TOUCHED,
  );
  const backup = bak as { category: string; amount: string }[];
  console.log(`\n💾 备份预算 ${backup.length} 行（只动 ${TOUCHED.join('/')}）`);
  await pool.query('DELETE FROM budgets WHERE category IN (?, ?, ?, ?)', TOUCHED);

  try {
    // ── A 工具校验 ──────────────────────────────────────────────────
    const r1 = await setBudgetTool.run('不是json', ctx());
    check('A1 坏 JSON', r1.includes('参数不是合法 JSON'), r1);

    const r2 = await setBudgetTool.run('{"category":"奢侈品","amount":100}', ctx());
    check('A2 非法分类拒绝', r2.startsWith('未设置'), r2);

    const r3 = await setBudgetTool.run('{"category":"餐饮","amount":-5}', ctx());
    check('A3 非法金额拒绝', r3.includes('金额无效'), r3);

    // ── B upsert ────────────────────────────────────────────────────
    const r4 = await setBudgetTool.run('{"category":"餐饮","amount":3000}', ctx());
    check('B1 首设', r4.startsWith('已设置预算') && !r4.includes('原为'), r4);

    const spentNow = await monthSpentFor('餐饮');
    const under = (spentNow + 1000).toFixed(2); // 🔬 保证盖过当月已花：断言 C1 才确定"还剩"
    const r5 = await setBudgetTool.run(`{"category":"餐饮","amount":${under}}`, ctx());
    check('B2 覆盖念"原为"', r5.includes('原为 3000.00'), r5);

    const r6 = await queryBudgetTool.run('', ctx());
    check('B3 query_budget 能看到', r6.includes('餐饮') && r6.includes('预算'), r6.split('\n')[0] ?? r6);

    // ── C 记账回执捎带提醒 ──────────────────────────────────────────
    // C1 预算 = 已花 + 1000，再记 50 → 没超，回执要说"还剩"
    const r7 = await addExpenseTool.run(`{"amount":50,"category":"餐饮","note":"${NOTE}-未超"}`, ctx());
    check('C1 未超支带"还剩"', r7.startsWith('已记账') && r7.includes('还剩'), r7);

    // C2 预算压到 0.01（已花 ≥ 50 必超）→ 再记 60 → 回执要说"超出预算"
    await setBudgetTool.run('{"category":"餐饮","amount":0.01}', ctx());
    const r8 = await addExpenseTool.run(`{"amount":60,"category":"餐饮","note":"${NOTE}-超支"}`, ctx());
    check('C2 超支带警告', r8.startsWith('已记账') && r8.includes('超出预算'), r8);

    // C3 ⭐ 分类没预算 → 退"总体"：交通无预算，总体 0.01，记 70 → 总体必超
    await setBudgetTool.run('{"category":"总体","amount":0.01}', ctx());
    const r9 = await addExpenseTool.run(`{"amount":70,"category":"交通","note":"${NOTE}-总体"}`, ctx());
    check('C3 退"总体"预算', r9.includes('本月总支出') && r9.includes('超出预算'), r9);

    // C4 对照组：都没预算 → 回执保持原样（不带任何提醒）
    //    ⚠️ 不能查"不含'预算'"：账目标记名自带"预算实验"两字会被备注原样带进回执 ——
    //       第一次跑就是这么挂的（断言自己和测试数据撞名）。改查提醒专属措辞
    await pool.query('DELETE FROM budgets WHERE category IN (?, ?, ?, ?)', TOUCHED);
    const r10 = await addExpenseTool.run(`{"amount":80,"category":"医疗","note":"${NOTE}-无预算"}`, ctx());
    check('C4 无预算回执原样', r10.startsWith('已记账') && !r10.includes('还剩') && !r10.includes('超出预算'), r10);
    const r11 = await budgetReminder('医疗');
    check('C5 budgetReminder 扑空返回 null', r11 === null, String(r11));

    // ── D 对账规则③重审 ────────────────────────────────────────────
    // D1 调过 set_budget 后说"预算记下了" —— 修后不算谎报（修前 CLAIM_ADD 会命中）
    const t1 = `${FAKE}01`;
    await logEvent(t1, { round: 1, agent: 'exp-budget', type: 'tool_call', toolName: 'set_budget', result: '已设置预算："餐饮"每月预算 2000.00 元。' });
    const v1 = await judge(t1, '好的，餐饮预算 2000 记下了');
    check('D1 设预算后"记下了"合法', v1.ok, v1.reason);

    // D2 对照组：零工具还说"记下了" —— 规则③必须还活着
    //    ⚠️ 不变量 9：规则③会查真库 hasRecentConfirmed，按真库当下状态分两支断言
    const t2 = `${FAKE}02`;
    await logEvent(t2, { round: 1, agent: 'exp-budget', type: 'no_tool_call' });
    const v2 = await judge(t2, '好的，记下了');
    const recent = await hasRecentConfirmed();
    if (recent) {
      check('D2 对照组（窗口内被容忍支）', v2.ok, `真库最近有已确认提案 #${recent.id}，规则③按设计放行：${v2.reason}`);
    } else {
      check('D2 对照组（规则③还活着支）', !v2.ok && v2.reason.includes('谎报'), v2.reason);
    }
  } finally {
    // ── 还原：账目按标记清、预算删掉插回备份、假案卷按前缀清 ─────────
    await pool.query('DELETE FROM expenses WHERE note LIKE ?', [`${NOTE}%`]);
    await pool.query('DELETE FROM budgets WHERE category IN (?, ?, ?, ?)', TOUCHED);
    for (const b of backup) {
      await pool.query('INSERT INTO budgets (category, amount) VALUES (?, ?)', [b.category, b.amount]);
    }
    await pool.query('DELETE FROM traces WHERE trace_id LIKE ?', [`${FAKE}%`]);

    // 🔬 清场自检：说清理了不等于清理了
    const [left] = await pool.query('SELECT COUNT(*) n FROM expenses WHERE note LIKE ?', [`${NOTE}%`]);
    const leftN = Number((left as { n: number }[])[0].n);
    const [bLeft] = await pool.query('SELECT COUNT(*) n FROM budgets WHERE category IN (?, ?, ?, ?)', TOUCHED);
    const bLeftN = Number((bLeft as { n: number }[])[0].n);
    check('E 清场还原', leftN === 0 && bLeftN === backup.length, `实验账目剩 ${leftN} 行；预算还原 ${bLeftN}/${backup.length} 行`);

    console.log(`\n📊 ${pass} 过 / ${fail} 失败`);
    await pool.end();
  }
}

main();
