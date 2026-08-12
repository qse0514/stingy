import { pool } from '../db.js';
import { CATEGORIES } from './categories.js';
import type { ToolDef } from './types.js';

// 🗄️ 保险丝③：数据量上限。查出来的行要塞进 history 每轮重发 —— 行数 = 钱
const MAX_ROWS = 30;

// 🗄️ export 仅为了实验脚本能直接调它（跳过模型，直捅源头）
export async function queryExpenses(args: string): Promise<string> {
  // 🟡 ① 同样先防坏 JSON（参数全选填，模型可能干脆卡个空字符串过来）
  let parsed: { category?: unknown; days?: unknown; group_by?: unknown; deleted?: unknown };
  try {
    parsed = args ? JSON.parse(args) : {};
  } catch {
    return '参数不是合法 JSON，请重新调用。';
  }

  // 🗄️ ② days：模型只给天数，日期边界我们自己算（夹在 1~365，防它填 99999）
  const rawDays = Number(parsed.days);
  const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(Math.floor(rawDays), 365) : 30;

  // 🗄️ ③ category 白名单：不合法就当作"没筛选"，而不是把脏字符串带进 SQL
  const category = CATEGORIES.includes(String(parsed.category)) ? String(parsed.category) : null;

  // 🗄️ ⭐ W12 D1 软删：两条路二选一，没有"活的死的一起查"的模式
  //    ⭐ deleted=true 是恢复的【眼睛】：没有它，已删的编号无处可查，
  //       restore_expense 就只能靠猜 —— 真出过事故：模型猜了个 #31 去恢复
  //       （"可逆"必须是产品里的动作：光有按钮不够，还得能看见要对什么按）
  //    ⚠️ === true：只认真正的布尔 true，模型填字符串 "true" 或其他脏值一律当没填
  const onlyDeleted = parsed.deleted === true;

  // 🗄️ ④ WHERE 部分：这些都是"值"，所以 ? 占位符完全胜任
  //    ⭐ 用 CURDATE() 而不是 NOW()：CURDATE() 是今天 00:00，NOW() 是此刻
  //    ⚠️ 旧写法 NOW() - INTERVAL 1 DAY 是"过去 24 小时"，不是"今天"：
  //       凌晨 1 点查"今天"会把昨天白天全部搅进来，而参数说明写的是"今天填 1"
  //    现在：days=1 → CURDATE()-0 = 今天 00:00；days=7 → 含今天共 7 个自然日
  //    ⚠️ 软删条件不带 ? —— 它不是“值”，是我们手写的二选一结构
  const where = [
    onlyDeleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL',
    'created_at >= CURDATE() - INTERVAL ? DAY',
  ];
  const params: unknown[] = [days - 1];
  if (category) {
    where.push('category = ?');
    params.push(category);
  }
  const whereSql = where.join(' AND ');

  try {
    // 🗄️ ⑤ 白名单选路：两条 SQL 都是手写死的，模型的字符串一个字也进不来
    //    （GROUP BY 后面是列名，属于 DDL 定义出来的结构；? 占位符只能填值，在这个位置根本不工作）
    if (parsed.group_by === 'category') {
      const [rows] = await pool.query(
        `SELECT category, COUNT(*) AS cnt, SUM(amount) AS total
         FROM expenses WHERE ${whereSql}
         GROUP BY category ORDER BY total DESC`,
        params,
      );
      const list = rows as { category: string; cnt: number; total: string }[];
      if (list.length === 0) {
        return onlyDeleted
          ? `最近 ${days} 天没有已删除的记录。`
          : `最近 ${days} 天没有记账记录。`;
      }

      const lines = list.map((r) => `${r.category}：${r.total} 元（${r.cnt} 笔）`);
      const sum = list.reduce((acc, r) => acc + Number(r.total), 0);
      // 🗄️ ⭐ W12 D4 B6：汇总路也要按 onlyDeleted 分支 —— 明细路早有"均未计入统计"抬头，
      //    汇总路漏了：deleted:true + group_by 时旧文案长得跟真开销一模一样，
      //    模型会把已删账目的合计当真实开销报给用户
      return onlyDeleted
        ? `最近 ${days} 天【已删除记录】分类汇总（均未计入统计，合计 ${sum.toFixed(2)} 元）：\n${lines.join('\n')}`
        : `最近 ${days} 天分类汇总（合计 ${sum.toFixed(2)} 元）：\n${lines.join('\n')}`;
    }

    // 🗄️ ⑥ 明细路：LIMIT 写死在 SQL 里，不给模型提供"改大一点"的参数
    const [rows] = await pool.query(
      `SELECT id, amount, category, note, DATE_FORMAT(created_at, '%Y-%m-%d') AS d
       FROM expenses WHERE ${whereSql}
       ORDER BY created_at DESC LIMIT ${MAX_ROWS}`,
      params,
    );
    const list = rows as { id: number; amount: string; category: string; note: string | null; d: string }[];
    if (list.length === 0) {
      return onlyDeleted
        ? `最近 ${days} 天没有已删除的记录。`
        : `最近 ${days} 天${category ? `的"${category}"分类` : ''}没有记账记录。`;
    }

    // 🤖 ⭐ 行首必须带 #id：改/删/恢复只能按编号动手，而编号只能从这个回执里来
    //    ⚠️ 之前 SELECT 查了 id 却没拼进这行，模型根本看不到编号 —— 那整条链就断了
    const lines = list.map((r) => `#${r.id} ${r.d} ${r.category} ${r.amount} 元${r.note ? `（${r.note}）` : ''}`);
    const sum = list.reduce((acc, r) => acc + Number(r.amount), 0);
    const more = list.length === MAX_ROWS ? `（只显示最近 ${MAX_ROWS} 笔）` : '';
    // 🗄️ 已删清单的抬头要说清"未计入统计"，否则模型会把这个合计当成真开销报给用户
    return onlyDeleted
      ? `最近 ${days} 天已删除 ${list.length} 笔（均未计入统计，# 后面是编号，恢复时用它）：\n${lines.join('\n')}`
      : `最近 ${days} 天共 ${list.length} 笔，合计 ${sum.toFixed(2)} 元${more}（# 后面是编号，修改或删除时用它）：\n${lines.join('\n')}`;
  } catch (err) {
    console.error('query_expenses DB error:', err); // 🟢 真相给日志
    return '查询数据库失败，请告知用户稍后重试。'; // 🤖 给模型的模糊说法
  }
}

export const queryExpensesTool: ToolDef = {
  spec: {
    type: 'function',
    function: {
      name: 'query_expenses',
      description: '查询已记录的消费。当用户问花了多少钱、查账、看明细或要统计时调用。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: '只查某一个分类。用户没指定分类时就不要填这个参数。',
            enum: CATEGORIES,   // 🤖 跟记账那边共用同一份白名单，避免两头走偏
          },
          days: {
            type: 'number',
            // 🤖 让它填"天数"而不是"日期区间"：模型算日历容易错，日期计算交给后端
            description: '往回查多少天。"今天"填 1，"本周"填 7，"本月"填 30。不填默认查最近 30 天。',
          },
          group_by: {
            type: 'string',
            description: '填 category 表示按分类汇总（用户问"各类各花了多少""哪类最费钱"时用）；不填则返回逐笔明细。',
            enum: ['category'],   // 🤖 只一个合法值，不给它自由发挥的空间
          },
          deleted: {
            type: 'boolean',
            // 🤖 ⭐ 恢复的眼睛：用户要找回删掉的账、问删过什么时，先用它拿编号
            description: '填 true 表示只查已删除的记录（用户要恢复/找回删掉的账、或问删过什么时用）。不填只查正常记录。',
          },
        },
        required: [],   // 🤖 全部选填："我最近花了多少"这种问法应该能直接查
      },
    },
  },
  run: queryExpenses,
};
