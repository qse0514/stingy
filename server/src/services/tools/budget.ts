// 🗄️ 预算功能（W12 D4）：设置每月预算 + 查询使用情况 + 给记账回执捎带提醒
//    ⭐ 核心设计：超支提醒【捎带在 add_expense 的回执尾部】，不等用户主动问 ——
//       回执是模型的必经之路（不读没法往下写），提醒一定会被转达给用户。
//       这是"AI 记账"对 Excel 的真正优势：记的那一下顺便告诉你钱花到哪一步了
//    ⭐ 额度按自然月计（created_at >= 本月 1 号），表里不存月份 —— 少存一列就少一种漂移
import { pool } from '../db.js';
import { CATEGORIES } from './categories.js';
import type { ToolDef } from './types.js';

// 🗄️ 特殊分类"总体"：不分类别的当月总额度。跟七类共用同一张表、同一套 upsert
export const OVERALL = '总体';
const VALID_BUDGET_CATEGORIES = [...CATEGORIES, OVERALL];

// 🗄️ 额度上限对齐 DECIMAL(10,2) 的最大值：不挡在这，INSERT 会在严格模式下直接炸
const MAX_BUDGET = 99_999_999;

// 🔵 库里 budgets 的一行（amount 是 string —— mysql2 把 DECIMAL 读成字符串，防浮点）
interface BudgetRow {
  category: string;
  amount: string;
}

// 🗄️ 读一个分类的预算；没设置过返回 null
async function readBudget(category: string): Promise<BudgetRow | null> {
  const [rows] = await pool.query(
    'SELECT category, amount FROM budgets WHERE category = ?',
    [category],
  );
  return (rows as BudgetRow[])[0] ?? null;
}

// 🗄️ 本月已花：category 传 null = 全部分类合计（给"总体"用）
//    ⚠️ 必须带 deleted_at IS NULL —— 删掉的账不算开销（软删的老规矩）
//    ⭐ W12 D4 export：统计接口（stats.ts）算预算进度用同一份，不写第二份 SUM
export async function monthSpent(category: string | null): Promise<number> {
  const where = ['deleted_at IS NULL', "created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')"];
  const params: unknown[] = [];
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  const [rows] = await pool.query(
    `SELECT IFNULL(SUM(amount), 0) AS total FROM expenses WHERE ${where.join(' AND ')}`,
    params,
  );
  return Number((rows as { total: string }[])[0]?.total ?? 0);
}

// 🤖 一个分类的使用情况，念成一句人话（query_budget 和记账提醒共用同一份措辞）
function statusLine(label: string, spent: number, limit: number): string {
  return spent > limit
    ? `${label}：本月已花 ${spent.toFixed(2)} 元，超出预算（${limit.toFixed(2)} 元）${(spent - limit).toFixed(2)} 元`
    : `${label}：本月已花 ${spent.toFixed(2)} 元 / 预算 ${limit.toFixed(2)} 元，还剩 ${(limit - spent).toFixed(2)} 元`;
}

// 🤖 ⭐ 给 add_expense 捎带的那一句提醒。找不到可用预算返回 null（回执保持原样）
//    优先用这笔的分类预算；该分类没设过，退而用"总体"预算
//    ⚠️ try/catch 全吞：提醒是搭车的，它自己坏掉不许弄死记账回执（同观测层的规矩）
export async function budgetReminder(category: string): Promise<string | null> {
  try {
    const own = await readBudget(category);
    const b = own ?? (await readBudget(OVERALL));
    if (!b) return null;
    const spent = await monthSpent(b.category === OVERALL ? null : b.category);
    const limit = Number(b.amount);
    const label = b.category === OVERALL ? '本月总支出' : `本月"${b.category}"`;
    return spent > limit
      ? `注意：${statusLine(label, spent, limit)}，请提醒用户控制。`
      : `${statusLine(label, spent, limit)}。`;
  } catch (err) {
    console.error('budgetReminder failed:', err); // 🟢 真相给日志，回执照发
    return null;
  }
}

async function setBudget(args: string): Promise<string> {
  // 🟡 ① 老规矩：先防坏 JSON
  let parsed: { category?: unknown; amount?: unknown };
  try {
    parsed = args ? JSON.parse(args) : {};
  } catch {
    return '参数不是合法 JSON，请重新调用并传入 category 和 amount。';
  }

  // 🟡 ② 校验：跟 update_expense 同一个立场 —— 用户在做精确设置，猜错比不设更坏，
  //    所以非法分类【拒绝】而不是归"其他"（对比 add_expense 那边宁可粗一点）
  const category = String(parsed.category);
  if (!VALID_BUDGET_CATEGORIES.includes(category)) {
    return `未设置：分类"${category}"不在允许范围内。合法分类：${CATEGORIES.join('/')}，或"${OVERALL}"表示当月总预算。`;
  }
  const amount = Number(parsed.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_BUDGET) {
    return `金额无效（收到：${String(parsed.amount)}），需要一个大于 0 的数字（单位：元/月）。请向用户确认金额。`;
  }

  try {
    // 🗄️ ③ 先读旧值 —— 回执要说"原为 X"，upsert 完就读不到旧的了（同 update_expense 取文案）
    const before = await readBudget(category);
    // 🗄️ ④ upsert：唯一键 uk_category 兜住并发，同分类永远只有一行
    await pool.query(
      'INSERT INTO budgets (category, amount) VALUES (?, ?) ON DUPLICATE KEY UPDATE amount = VALUES(amount)',
      [category, amount],
    );
    // 🤖 回执把"改前 → 改后"念出来；顺手带上当月即时状态，模型能一并转达
    const spent = await monthSpent(category === OVERALL ? null : category);
    const label = category === OVERALL ? '当月总预算' : `"${category}"每月预算`;
    const prev = before ? `（原为 ${Number(before.amount).toFixed(2)} 元）` : '';
    return `已设置预算：${label} ${amount.toFixed(2)} 元${prev}。${statusLine('当前', spent, amount)}。`;
  } catch (err) {
    console.error('set_budget DB error:', err); // 🟢 真相给日志
    return '设置失败：数据库写入出错，预算没有设置上。请告知用户稍后重试。'; // 🤖 给模型的模糊说法
  }
}

async function queryBudget(args: string): Promise<string> {
  let parsed: { category?: unknown };
  try {
    parsed = args ? JSON.parse(args) : {};
  } catch {
    return '参数不是合法 JSON，请重新调用。';
  }
  // 🟡 分类选填；非法值当没填（查询宁可多给，同 queryExpenses 的立场）
  const category = VALID_BUDGET_CATEGORIES.includes(String(parsed.category))
    ? String(parsed.category)
    : null;

  try {
    const [rows] = await pool.query(
      category
        ? 'SELECT category, amount FROM budgets WHERE category = ? ORDER BY id'
        : 'SELECT category, amount FROM budgets ORDER BY id',
      category ? [category] : [],
    );
    const list = rows as BudgetRow[];
    if (list.length === 0) {
      return category
        ? `"${category}"还没有设置预算。可以用一句话设置，例如"给${category === OVERALL ? '本月总支出' : category}设每月 2000 预算"。`
        : '还没有设置任何预算。可以用一句话设置，例如"给餐饮设每月 2000 预算"。';
    }
    // 🗄️ 逐个分类算"本月已花"。预算条数最多 8 条（七类+总体），循环查询开销可忽略
    const lines: string[] = [];
    for (const b of list) {
      const spent = await monthSpent(b.category === OVERALL ? null : b.category);
      lines.push(statusLine(b.category, spent, Number(b.amount)));
    }
    return `本月预算使用情况：\n${lines.join('\n')}`;
  } catch (err) {
    console.error('query_budget DB error:', err);
    return '查询数据库失败，请告知用户稍后重试。';
  }
}

export const setBudgetTool: ToolDef = {
  spec: {
    type: 'function',
    function: {
      name: 'set_budget',
      description:
        '设置或修改某个分类的每月预算。用户说"给餐饮设个 2000 预算""每月最多花 5000"这类话时调用。同一分类再次设置会覆盖旧额度。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: `预算的分类。必须从以下选项中选一个：${CATEGORIES.join('/')}；用户说的是不分类别的总预算时填"${OVERALL}"。`,
            enum: VALID_BUDGET_CATEGORIES, // 🤖 白名单跟记账共用 + 多一个"总体"
          },
          amount: {
            type: 'number',
            description: '每月预算额度，单位：元，只填正数。',
          },
        },
        required: ['category', 'amount'],
      },
    },
  },
  run: setBudget,
};

export const queryBudgetTool: ToolDef = {
  spec: {
    type: 'function',
    function: {
      name: 'query_budget',
      description:
        '查询预算的使用情况（每类的额度、本月已花、剩余/超支）。用户问"预算还剩多少""这个月超没超"时调用。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: '只查某一个分类的预算。用户没指定分类时就不要填这个参数。',
            enum: VALID_BUDGET_CATEGORIES,
          },
        },
        required: [],
      },
    },
  },
  run: queryBudget,
};
