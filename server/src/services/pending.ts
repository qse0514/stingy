// 🚦 HITL（Human In The Loop）：高风险操作不直接执行，先变成一张"待用户点头"的提案
//    ⭐ 本文件的核心：模型能提案，不能执行；执行由用户那一下点击触发，全程不经过模型
import { pool } from './db.js';
import { budgetReminder } from './tools/budget.js'; // 🗄️ W12 D4：确认落库的回写回执也捎带预算提醒

export interface PendingExpense {
  id: number;
  amount: number;
  category: string;
  note: string | null;
  reason: string;   // 🤖 为什么要确认 —— 直接显示给用户
}

// 🚦 建提案：数字在这一刻冻住，之后谁也改不了（前端只能拿着 id 来确认）
export async function createPending(
  traceId: string,
  e: { amount: number; category: string; note: string | null; reason: string },
): Promise<number> {
  const [res] = await pool.query(
    `INSERT INTO pending_expenses (trace_id, amount, category, note, reason)
     VALUES (?, ?, ?, ?, ?)`,
    [traceId, e.amount, e.category, e.note, e.reason],
  );
  return (res as { insertId: number }).insertId;
}

// 🚦 查本次请求提了哪些提案 —— controller 在流末尾靠 traceId 捞它们发给前端
//    ⭐ 靠 trace_id 关联，所以不需要额外的传递机制（案件编号又白送一个用途）
export async function listPendingByTrace(traceId: string): Promise<PendingExpense[]> {
  const [rows] = await pool.query(
    `SELECT id, amount, category, note, reason
     FROM pending_expenses WHERE trace_id = ? AND status = 'pending' ORDER BY id`,
    [traceId],
  );
  // 🗄️ DECIMAL 被 mysql2 读成字符串，转成 number 再交给前端
  return (rows as { id: number; amount: string; category: string; note: string | null; reason: string }[])
    .map((r) => ({ ...r, amount: Number(r.amount) }));
}

// 🗄️ ⭐ W12 D1：提案定案后，把【模型记忆】同步成真相。两个动作缺一不可：
//    ① 把原来那张"待确认…尚未记入"的回执整句重写 —— 错误文本留在上下文里就是锚（3/3 vs 2/3 那课）
//    ② 再在会话末尾追加一对【申请表 + 新回执】—— exp:confirmsync 实测：只做①不够，
//       因为模型自己那句"还没记上，请确认"的旧正文排在回执【后面】，就近锚定赢了重写 ——
//       真相必须同时是【可信通道（工具回执）】和【最新的一句话】才压得住
//    为什么必须有它：trace 34623773 事故 —— 用户点完确认，可 confirm 路径不经过模型，
//    记忆里的最后一句仍是"尚未记入"，下一轮重建出来还是它 —— 于是模型要么断言
//    "没记上"（谎报），要么重新提交一遍（全靠 10 分钟幂等窗口兜底）
//    ⭐ 回执是它自己伸手要来的东西 = 可信通道；往对话里塞事实实测无效（0/3）
//    定位靠回执的固定前缀"待确认（提案 #N）"：提案 id 全局唯一，前缀是协议不是文案
//    （幂等重复提交的那张"这笔已经提交过"回执也是同一前缀 —— 一并重写，正好）
//    ⚠️ 追加的新回执必须成【对】：孤儿 role:'tool' 没有申请表认领，buildHistory
//    重建出来 API 直接 400 —— 所以连申请表一起补（内容是真的：系统确实执行了这笔）
async function syncMemoryReceipt(
  pendingId: number,
  newContent: string,
  callArgs: { amount: number; category: string; note: string | null },
): Promise<void> {
  try {
    // ① 找到原回执（顺便拿到它属于哪个会话 —— pending 表里只有 trace_id 没有会话 id）
    const [rows] = await pool.query(
      `SELECT id, conversation_id FROM messages WHERE role = 'tool' AND content LIKE ?`,
      [`待确认（提案 #${pendingId}）%`],
    );
    const hits = rows as { id: number; conversation_id: number }[];
    if (hits.length === 0) return; // 实验脚本造的提案没有对应记忆，合法

    // ② 整句重写旧回执（拔锚）
    await pool.query(
      `UPDATE messages SET content = ? WHERE role = 'tool' AND content LIKE ?`,
      [newContent, `待确认（提案 #${pendingId}）%`],
    );

    // ③ 会话末尾追加【申请表 + 新回执】成对的两行（让真相成为最新的一句话）
    //    id 用 hitl_#N：confirm/reject 都是 compare-and-set 一次性的，不会重复
    const convId = hits[0]!.conversation_id;
    const callId = `hitl_${pendingId}`;
    const toolCalls = JSON.stringify([
      {
        id: callId,
        type: 'function',
        function: { name: 'add_expense', arguments: JSON.stringify(callArgs) },
      },
    ]);
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id) VALUES
         (?, 'assistant', NULL, ?, NULL),
         (?, 'tool', ?, NULL, ?)`,
      [convId, toolCalls, convId, newContent, callId],
    );
  } catch (err) {
    // ⭐ 回写失败不能弄死确认本身：账已落库是事实，记忆脏了还有幂等兜底
    console.error('syncMemoryReceipt failed:', err);
  }
}

export type ConfirmResult =
  | { ok: true; expenseId: number; amount: number; category: string; note: string | null }
  | { ok: false; reason: string };

export type RejectResult =
  | { ok: true; amount: number; category: string; note: string | null }
  | { ok: false; reason: string };

// 🚦 提案时效：超过这么久没人理就不能再确认了
//    ⚠️ 不加它的后果：三个月前那张 30 万的卡片今天被误点一下，钱就进去了
const TTL_HOURS = 24;

// 🚦 失败时才查原因（affectedRows=0 把三种情况合并了）
//    ⭐ 只在失败路径上多查一次；成功路径不花这一次开销
async function explainFailure(id: number): Promise<string> {
  const [rows] = await pool.query(
    'SELECT status, created_at FROM pending_expenses WHERE id = ?',
    [id],
  );
  const row = (rows as { status: string; created_at: Date }[])[0];
  if (!row) return '提案不存在';
  if (row.status !== 'pending') return `提案已处理（${row.status}）`;
  return `提案已超过 ${TTL_HOURS} 小时，已失效`;
}

// 🚦 ⭐ 确认：把提案变成真账。三步，顺序是刻意的
export async function confirmPending(id: number): Promise<ConfirmResult> {
  // 🗄️ ① 先抢锁：把"检查"和"修改"塞进同一句 SQL
  //    两次点击同时打进来，MySQL 只让一句成功，第二句 affectedRows 就是 0
  //    （对比"先 SELECT 再判断"：那两步之间有窗口，两个请求能同时通过检查）
  //    ⭐ 时效检查也塞进这一句 —— 多一个条件，不多一个窗口
  const [upd] = await pool.query(
    `UPDATE pending_expenses SET status = 'confirmed'
     WHERE id = ? AND status = 'pending' AND created_at > NOW() - INTERVAL ? HOUR`,
    [id, TTL_HOURS],
  );
  if ((upd as { affectedRows: number }).affectedRows === 0) {
    return { ok: false, reason: await explainFailure(id) }; // 🚦 幂等：重复点击到此为止
  }

  // 🗄️ ② 抢到锁了，读回冻住的数字（不接受前端寄来的任何数值）
  const [rows] = await pool.query(
    'SELECT amount, category, note FROM pending_expenses WHERE id = ?',
    [id],
  );
  const row = (rows as { amount: string; category: string; note: string | null }[])[0];
  if (!row) return { ok: false, reason: '提案不存在' };

  try {
    // 🗄️ ③ 真写库。⚠️ 这里没有任何校验 —— 因为这些值在建提案时已经验过了
    //    校验只存在一处（addExpense），不会两份漂移
    const [ins] = await pool.query(
      'INSERT INTO expenses (amount, category, note) VALUES (?, ?, ?)',
      [row.amount, row.category, row.note],
    );
    const expenseId = (ins as { insertId: number }).insertId;

    // 🗄️ ④ 回填：这一列同时是对账证据
    //    confirmed 但 expense_id IS NULL = 确认了却没落库（崩在③了），一句 SQL 就能查出来
    await pool.query('UPDATE pending_expenses SET expense_id = ? WHERE id = ?', [expenseId, id]);

    // 🗄️ ⭐ ⑤ 回写记忆：让"已入账"活进模型下一轮重看的历史里
    //    开头用"已记账"—— 和 addExpense 成功回执同一协议，模型认得
    //    🗄️ W12 D4：尾部同样捎带预算提醒 —— 走 HITL 的恰恰是大额，最容易冲破预算的就是它们
    const reminder = await budgetReminder(row.category);
    await syncMemoryReceipt(
      id,
      `已记账（#${expenseId}）：${row.category} ${Number(row.amount).toFixed(2)} 元${row.note ? `，备注：${row.note}` : ''}。原提案 #${id} 已由用户在界面上确认，本笔已入账，不要重复提交。${reminder ?? ''}`,
      { amount: Number(row.amount), category: row.category, note: row.note },
    );

    return { ok: true, expenseId, amount: Number(row.amount), category: row.category, note: row.note };
  } catch (err) {
    console.error('confirmPending DB error:', err);
    // 🚦 ⚠️ 注意此时状态已经是 confirmed 而 expense_id 是 NULL —— 我们【故意】不回滚
    //    因为"少记一笔"比"多记一笔"好：少了用户会发现，多了没人发现
    return { ok: false, reason: '写库失败' };
  }
}

// 🔎 对账用：最近有没有【已确认且真落库】的提案
//    为什么 audit 需要它：D5 遇到的真事故 —— 模型一次工具都没调，却声称
//    "那笔没记上"，而它实际已经落库了。光看 traces 永远发现不了（那里什么都没有）
//    ⚠️⭐ W12 D4 B1 修复："最近"必须按【确认时刻】算，不是提案创建时刻。
//       TTL 允许提案 24 小时内被确认 —— 用户在创建 10 分钟后才点确认时，
//       旧版（p.created_at）永远扑空 → 规则③把诚实的"记好了"判谎报，
//       reflect 再把诚实草稿纠成"还没记上"（把真话改写成谎话）。
//       确认时刻 = expenses 落库时刻，所以 JOIN 真账表拿 e.created_at 判 ——
//       不加列不动 schema；JOIN 本身就蕴含了 expense_id IS NOT NULL。
//       ⚠️ 从此它依赖 expenses 行真实存在：实验造 confirmed 提案时必须配真 expenses 行（不变量 9）
export async function hasRecentConfirmed(
  minutes = 10,
): Promise<{ id: number; expenseId: number } | null> {
  const [rows] = await pool.query(
    `SELECT p.id, p.expense_id FROM pending_expenses p
     JOIN expenses e ON e.id = p.expense_id
     WHERE p.status = 'confirmed' AND e.created_at > NOW() - INTERVAL ? MINUTE
     ORDER BY p.id DESC LIMIT 1`,
    [minutes],
  );
  const row = (rows as { id: number; expense_id: number }[])[0];
  return row ? { id: row.id, expenseId: row.expense_id } : null;
}

// 🚦 拒绝：同样用 compare-and-set，拒过就不能再拒
//    ⭐ 也返回快照 —— 前端拿它在聊天记录里写一条【只给人看】的回执
//    （不是给模型的：D5 实测过，对话里塞的“系统事实”会被防注入规则忽略）
export async function rejectPending(id: number): Promise<RejectResult> {
  const [rows] = await pool.query(
    'SELECT amount, category, note FROM pending_expenses WHERE id = ? AND status = \'pending\'',
    [id],
  );
  const row = (rows as { amount: string; category: string; note: string | null }[])[0];

  const [upd] = await pool.query(
    `UPDATE pending_expenses SET status = 'rejected'
     WHERE id = ? AND status = 'pending'`,
    [id],
  );
  if ((upd as { affectedRows: number }).affectedRows === 0 || !row) {
    return { ok: false, reason: await explainFailure(id) };
  }
  // 🗄️ ⭐ 拒了也要回写记忆：否则模型下轮仍看见"已请用户确认"，会追着问或重提
  //    开头"未记入"落在 ADMIT_FAIL 词表内，它如实转述时对账不会误报
  await syncMemoryReceipt(
    id,
    `未记入（提案 #${id}）：${row.category} ${Number(row.amount).toFixed(2)} 元。用户已在界面上拒绝，本笔不记。除非用户重新提出，不要再提交。`,
    { amount: Number(row.amount), category: row.category, note: row.note },
  );
  return { ok: true, amount: Number(row.amount), category: row.category, note: row.note };
}
