import { pool } from '../db.js';
import { CATEGORIES } from './categories.js';
import { MAX_AMOUNT } from './addExpense.js'; // 🚦 ⭐ 风控阈值只有一份，从记账那边借
import { readExpense, describeExpense, checkId } from './expenseRow.js';
import type { ToolDef } from './types.js';

async function updateExpense(args: string): Promise<string> {
  // 🟡 ① 老规矩：先防坏 JSON
  let parsed: { id?: unknown; amount?: unknown; category?: unknown; note?: unknown };
  try {
    parsed = args ? JSON.parse(args) : {};
  } catch {
    return '参数不是合法 JSON，请重新调用并传入 id。';
  }

  // 🟡 id 校验走公共那一份（checkId）—— 不在这里重写一道
  //    返回的是字符串就说明没过，那句话本身就是给模型的回执
  const checked = checkId(parsed.id);
  if (typeof checked === 'string') return checked;
  const id = checked;

  // 🗄️ ② 组 SET 子句。⭐ 列名全部来自这段手写代码，模型的字符串一个字也进不到 SQL 结构里
  //    （引号是那个开关：没引号=列名，有引号=值。? 占位符只能填值，填不了列名）
  const sets: string[] = [];
  const params: unknown[] = [];

  if (parsed.amount !== undefined) {
    const amount = Number(parsed.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return `金额无效（收到：${String(parsed.amount)}），需要一个大于 0 的数字（单位：元）。`;
    }
    // 🚦 ⭐⭐ 这一段是补一个【新开的路径把旧关卡绕过去】的洞：
    //    add_expense 里超过 5000 会转提案等人确认，但如果这里放行，
    //    模型只要"先记 10 元（自动过）→ 再改成 100 万（自动过）"就绕开了整个 HITL。
    //    ⚠️ 修法不是在这里再实现一遍风控（那就是两处重复），
    //       而是【把这条路堵死，逼回已有关卡】—— 删了重记，重记必然撞上确认流程
    if (amount > MAX_AMOUNT) {
      return `未修改（#${id}）：不能通过修改把金额改到 ${amount} 元（超过 ${MAX_AMOUNT} 元）。请让用户删除这笔后重新记账，大额记账会走确认流程。`;
    }
    sets.push('amount = ?');
    params.push(amount);
  }

  if (parsed.category !== undefined) {
    const category = String(parsed.category);
    // 🗄️ ⭐ 跟 add_expense 的处理【故意不同】：那边非法分类归"其他"（宁可粗一点，
    //    也别阻断记账）；这边非法就拒绝 —— 用户是在做精确修正，猜错比不改更坏
    if (!CATEGORIES.includes(category)) {
      return `未修改（#${id}）：分类"${category}"不在允许范围内。合法分类：${CATEGORIES.join('/')}。`;
    }
    sets.push('category = ?');
    params.push(category);
  }

  if (parsed.note !== undefined) {
    // 🗄️ 空字符串 = 用户要清空备注 → 存 NULL（跟"没传这个参数"是两件事）
    const note = String(parsed.note).trim();
    sets.push('note = ?');
    params.push(note === '' ? null : note.slice(0, 255));
  }

  // 🟡 ③ 三个字段一个都没给 = 这次调用没意义，让它重问用户
  if (sets.length === 0) {
    return `未修改（#${id}）：没有指定要改什么。amount / category / note 至少给一个。`;
  }

  // 🗄️ ④ 先读旧值 —— 回执要说"改前 → 改后"，改完就读不到旧的了
  //    ⚠️ 这里读一次不违反 D5 那条"多一次查询就多一个窗口"：
  //       真正的【判断】仍然在下面那条 UPDATE 的 WHERE 里（compare-and-set）。
  //       这次 SELECT 只负责取文案。读一次拿话说 ≠ 读一次做判断
  const before = await readExpense(id);
  if (!before) {
    return `找不到这笔（#${id}）。请先用 query_expenses 查到正确的编号，不要猜编号。`;
  }
  if (before.deleted_at) {
    return `找不到这笔（#${id}）：它已被删除。如需修改，请先调用 restore_expense 恢复，再改。`;
  }

  try {
    const [res] = await pool.query(
      // 🗄️ deleted_at IS NULL 留在这里 —— 已删的那笔不许被偷偷改内容
      `UPDATE expenses SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      [...params, id],
    );
    // 🗄️ ⭐ 实测过的三分（mysql2 默认开了 FOUND_ROWS，这两个数字含义不同）：
    //    (0,0) = 没匹配到行 · (1,0) = 匹配到了但值本来就一样 · (1,1) = 真改了
    const { affectedRows, changedRows } = res as { affectedRows: number; changedRows: number };

    if (affectedRows === 0) {
      // 🗄️ 上面 SELECT 到 UPDATE 之间的空隙里被别人删了 —— 窗口存在但无害，WHERE 兜住了
      return `未修改（#${id}）：这笔刚刚被删除或已不存在，本次没有改动。`;
    }
    if (changedRows === 0) {
      // 🔁 ⭐ 幂等回执：结果状态是对的，而且没有重复动作。跟"这笔刚才已经记过了"同一个套路
      return `已修改（#${id}）：内容本来就是 ${describeExpense(before)}，跟要改成的一样，本次没有重复修改。`;
    }
    const after = await readExpense(id); // 🗄️ 读回改后的样子，回执里念给用户听
    return `已修改（#${id}）：${describeExpense(before)} → ${after ? describeExpense(after) : '（读回失败）'}`;
  } catch (err) {
    console.error('update_expense DB error:', err); // 🟢 真相给日志
    return `修改失败（#${id}）：数据库写入出错，本次没有改动。请告知用户稍后重试。`; // 🤖 给模型的模糊说法
  }
}

export const updateExpenseTool: ToolDef = {
  spec: {
    type: 'function',
    function: {
      name: 'update_expense',
      description:
        '修改一笔【已经记过】的消费（改金额/分类/备注）。用户说记错了、写错金额、分类不对、要改备注时调用。必须先用 query_expenses 查到这笔的编号。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            // 🤖 ⭐ 堵死"猜编号"：编号只能来自查询结果，这句话是防它凭空编一个
            description: '要修改的那笔的编号，必须来自 query_expenses 的查询结果。不确定就先去查，不要猜。',
          },
          amount: {
            type: 'number',
            description: '改成这个金额，单位：元，只填正数。不需要改金额时不要传这个参数。',
          },
          category: {
            type: 'string',
            description: '改成这个分类。不需要改分类时不要传这个参数。',
            enum: CATEGORIES, // 🤖 跟记账那边共用同一份白名单
          },
          note: {
            type: 'string',
            description: '改成这个备注。传空字符串表示清空备注。不需要改备注时不要传这个参数。',
          },
        },
        required: ['id'], // 🤖 只有 id 必填；后三个至少给一个（这条在后端校验，Schema 表达不了）
      },
    },
  },
  run: updateExpense,
};
