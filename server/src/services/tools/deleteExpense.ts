// 🗄️ 软删 + 恢复：一对镜像，放在同一个文件里，改一边就会看见另一边
//    ⭐ 它们都不走 HITL。理由不是"软删可逆"（那是循环论证：可逆靠人进库敲 SQL，
//       而"只能进库改"正是这一格要修的病），而是：
//       ① 校验只有一处、② 天然幂等、③ 软删本身就是留痕 —— D5 要 pending 表的
//       三条真理由，在删除这件事上一条都不成立。
//    ⭐ 但"可逆"必须兑现成产品里的动作 → 所以有 restore_expense，
//       并且回执里必须把删掉的内容念出来，人才看得见
import { pool } from '../db.js';
import { parseId, readExpense, describeExpense } from './expenseRow.js';
import type { ToolDef } from './types.js';

// 🗄️ 两个工具共用的三分判读（实测过的 mysql2 语义）
//    (0,0) = 这个 id 根本没有 · (1,0) = 匹配到了但值没变 · (1,1) = 真改了
type Outcome = 'missing' | 'noop' | 'done';
function readOutcome(res: unknown): Outcome {
  const { affectedRows, changedRows } = res as { affectedRows: number; changedRows: number };
  if (affectedRows === 0) return 'missing';
  return changedRows === 0 ? 'noop' : 'done';
}

async function deleteExpense(args: string): Promise<string> {
  const id = parseId(args);
  if (typeof id === 'string') return id; // 🟡 校验没过，那句话直接当回执

  try {
    const [res] = await pool.query(
      // 🗄️ ⭐⭐ 一条语句同时做到三件事，零额外查询：
      //    COALESCE(deleted_at, NOW()) = "已经有删除时间就保留原来那个，没有才盖现在"
      //    → 重复删除时值没有变化 → changedRows=0 → 天然幂等，
      //      而且【不会把原始删除时间冲掉】（那是证据，冲掉就查不出它什么时候被删的）
      //    ⚠️ 如果写成 WHERE id=? AND deleted_at IS NULL，第二次删会得到 (0,0)，
      //       就分不清"这个 id 不存在"和"已经删过了" —— 回执要说的话完全不同
      //    ⭐ 同源于 D5："TTL 塞进同一条 UPDATE —— 多一次查询就多一个窗口"
      'UPDATE expenses SET deleted_at = COALESCE(deleted_at, NOW()) WHERE id = ?',
      [id],
    );
    const outcome = readOutcome(res);
    if (outcome === 'missing') {
      return `找不到这笔（#${id}）。请先用 query_expenses 查到正确的编号，不要猜编号。`;
    }

    // 🗄️ 软删的好处之一：行还在，所以删完照样读得到内容来复述
    const row = await readExpense(id);
    const what = row ? describeExpense(row) : `编号 ${id}`;

    if (outcome === 'noop') {
      // 🔁 幂等回执：结果状态是对的（已删），而且这次没重复动手
      return `已删除（#${id}）：${what}，之前就已经删掉了，本次没有重复删除。`;
    }
    // 🤖 ⭐ 必须把删掉的内容念出来 —— 回执是它的必经之路，它会转达给用户，
    //    人当场就看见删了什么。这是"删错了能被发现"的唯一保证
    return `已删除（#${id}）：${what}。这笔已不计入统计。如果删错了，可以恢复。`;
  } catch (err) {
    console.error('delete_expense DB error:', err); // 🟢 真相给日志
    return `删除失败（#${id}）：数据库写入出错，这笔没有删掉。请告知用户稍后重试。`;
  }
}

async function restoreExpense(args: string): Promise<string> {
  const id = parseId(args);
  if (typeof id === 'string') return id;

  try {
    const [res] = await pool.query(
      // 🗄️ ⭐ 完美镜像：把标记抹掉就是恢复。同样三分：
      //    (0,0) 没这个 id · (1,0) 本来就没被删（值已经是 NULL）· (1,1) 真恢复了
      'UPDATE expenses SET deleted_at = NULL WHERE id = ?',
      [id],
    );
    const outcome = readOutcome(res);
    if (outcome === 'missing') {
      return `找不到这笔（#${id}）。请先用 query_expenses 查到正确的编号，不要猜编号。`;
    }

    const row = await readExpense(id);
    const what = row ? describeExpense(row) : `编号 ${id}`;

    if (outcome === 'noop') {
      // ⚠️⭐ 这里【不是】幂等，别照抄 delete 那边 —— 这是真出过事故的地方：
      //    delete 的 (1,0) = 删过又删，前一次真发生过 → 幂等，回"已删除"对
      //    restore 的 (1,0) = 这笔【根本没被删过】→ 模型八成恢复错了对象
      //    同一个 (1,0)，两种含义。只有前一次操作真发生过，第二次才叫重复；
      //    对从没被操作过的对象动手，那不是幂等，是打错了目标。
      //    曾经这里回"已恢复（#31）…本来就没被删除" —— 模型和对账都把它
      //    当成了成功（对账的约定是"已"开头=成功），双双被骗
      //    ⚠️ 不能说"从未删过"：库里只有 deleted_at 一列，"从没删过"和
      //    "删过又恢复了"长得一模一样 —— 一列状态记不下历史，只能说"当前不处于"
      return `未恢复（#${id}）：${what} 当前不处于删除状态，本次没有改动。如果用户要找回的是另一笔，请用 query_expenses 带上 deleted 参数查已删除的记录，拿到正确编号再恢复。`;
    }
    return `已恢复（#${id}）：${what}，已重新计入统计。`;
  } catch (err) {
    console.error('restore_expense DB error:', err);
    return `恢复失败（#${id}）：数据库写入出错，这笔仍处于已删除状态。请告知用户稍后重试。`;
  }
}

export const deleteExpenseTool: ToolDef = {
  spec: {
    type: 'function',
    function: {
      name: 'delete_expense',
      description:
        '删除一笔记错的消费。用户说这笔不对、记重了、要删掉时调用。必须先用 query_expenses 查到这笔的编号。删除后仍可恢复。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: '要删除的那笔的编号，必须来自 query_expenses 的查询结果。不确定就先去查，不要猜。',
          },
        },
        // 🤖 ⭐ 只收一个 id，而且没有任何批量参数：
        //    绝不提供"按备注删""删某分类全部"这类入口 —— 那等于让它自己写 WHERE
        required: ['id'],
      },
    },
  },
  run: deleteExpense,
};

export const restoreExpenseTool: ToolDef = {
  spec: {
    type: 'function',
    function: {
      name: 'restore_expense',
      description:
        '恢复一笔之前删掉的消费。用户说删错了、要撤销删除、要找回那笔时调用。不确定编号时，先用 query_expenses 带 deleted 参数查已删除的记录。',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'number',
            description: '要恢复的那笔的编号。就是删除时回执里给出的那个编号。',
          },
        },
        required: ['id'],
      },
    },
  },
  run: restoreExpense,
};
