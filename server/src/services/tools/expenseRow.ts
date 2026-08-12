// 🟢 改/删/恢复 三兄弟的公共零件：读一行 · 复述一行 · 解析 id
//    ⭐ 为什么不各自写一遍：D5 你否决"延迟上传"的理由①就是"校验逻辑会在两处重复"。
//       同一句话在这里生效 —— 三个工具的 id 校验必须只有一份
import { pool } from '../db.js';

// 🔵 库里那一行的形状。⚠️ amount 是 string —— mysql2 把 DECIMAL 读成字符串（不是 bug，是防浮点）
export interface ExpenseRow {
  id: number;
  amount: string;
  category: string;
  note: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

// 🗄️ 按 id 读一笔。⭐ 故意【不】过滤 deleted_at ——
//    调用方需要分清"这个 id 根本不存在"和"存在但已被删除"，回执要说的话不一样
export async function readExpense(id: number): Promise<ExpenseRow | null> {
  const [rows] = await pool.query('SELECT * FROM expenses WHERE id = ?', [id]);
  return (rows as ExpenseRow[])[0] ?? null;
}

// 🟢 日期格式化。⚠️ 不用 toISOString()：它按 UTC 切，东八区凌晨那几笔会显示成前一天
function ymd(d: Date | null): string {
  if (!d) return '';
  const t = new Date(d);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

// 🤖 ⭐ 给模型看的一句复述。改/删都必须把动过的东西念出来 ——
//    回执是它的必经之路（不读没法往下写），所以它一定会把这句转达给用户，
//    人当场就看见动了什么。这是"可逆"能被发现的唯一保证
//    ⭐ Number(amount) 只在这个给人看的出口转；进库的路上永远不转（浮点精度）
export function describeExpense(r: ExpenseRow): string {
  return `${r.category} ${Number(r.amount).toFixed(2)} 元${r.note ? `，${r.note}` : ''}（${ymd(r.created_at)}）`;
}

// 🟡 id 校验的【唯一一份】：必须是正整数。小数、负数、字符串、缺失全挡在这
//    返回 number = 通过；返回 string = 给模型的错误回执（照原样 return 出去）
//    ⭐ update 需要自己 parse（它还要取 amount/category/note），所以这里拆两层：
//       规则在 checkId，拆包装在 parseId。三个工具用的是同一条规则
export function checkId(raw: unknown): number | string {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return `编号无效（收到：${String(raw)}）。请先用 query_expenses 查到这笔的编号，不要猜编号。`;
  }
  return id;
}

// 🟡 只需要 id 的工具（删/恢复）用这个：拆包 + 校验一步到位
export function parseId(args: string): number | string {
  let parsed: { id?: unknown };
  try {
    parsed = args ? JSON.parse(args) : {};
  } catch {
    return '参数不是合法 JSON，请重新调用并传入 id。';
  }
  return checkId(parsed.id);
}
