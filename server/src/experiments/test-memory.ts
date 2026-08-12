// 🔬 实验：记忆层（W12 D1 · ③ Memory）—— 零 LLM 调用，全是确定性断言
//    验四件事：
//      A buildHistory 重建的形状符合 OpenAI 合同（申请表 parse 回数组、回执带 tool_call_id）
//      B ⭐ 截断永不腰斩：刀落在工具轮中间时，整轮让位，首条必是 user
//      C listDisplayMessages 只给 user/assistant 正文（tool 和纯申请表行不给人看）
//      D 侧栏排序跟着 updated_at 走（appendMessage 会 bump）
//    ⭐ 自包含：title 带 exp-mem 前缀，清理用 LIKE
import { pool } from '../services/db.js';
import {
  createConversation,
  listConversations,
  listDisplayMessages,
  appendMessage,
  buildHistory,
} from '../services/conversation.js';

const MARK = 'exp-mem';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} → ${detail}`); }
}

// 🔬 造一轮"删账"的完整三件套：申请表 + 回执 + 收尾人话（形状抄真实生产的）
async function appendToolRound(convId: number, callId: string, receipt: string) {
  await appendMessage(convId, {
    role: 'assistant',
    content: null, // 🤖 交申请表时通常不带正文
    toolCalls: JSON.stringify([
      { id: callId, type: 'function', function: { name: 'delete_expense', arguments: '{"id":38}' } },
    ]),
  });
  await appendMessage(convId, { role: 'tool', content: receipt, toolCallId: callId });
}

async function main() {
  // ── A 形状断言 ────────────────────────────────────────────────────
  const conv = await createConversation(`${MARK} 形状`);
  await appendMessage(conv, { role: 'user', content: '删掉那笔麦当劳' });
  await appendToolRound(conv, 'call_exp_1', '已删除（#38）：餐饮 40.00 元，麦当劳');
  await appendMessage(conv, { role: 'assistant', content: '删掉啦！' });

  const h = await buildHistory(conv);
  check('A1 条数', h.length === 4, `${h.length} ≠ 4`);
  check('A2 首条是 user', h[0]?.role === 'user', String(h[0]?.role));
  const applyForm = h[1] as { role: string; tool_calls?: { id: string }[] };
  check(
    'A3 申请表 parse 回了数组',
    applyForm.role === 'assistant' && Array.isArray(applyForm.tool_calls) && applyForm.tool_calls[0].id === 'call_exp_1',
    JSON.stringify(applyForm),
  );
  const receipt = h[2] as { role: string; tool_call_id?: string; content?: string };
  check(
    'A4 ⭐ 回执活过了"请求边界"（#38 根治的证据）',
    receipt.role === 'tool' && receipt.tool_call_id === 'call_exp_1' && !!receipt.content?.includes('#38'),
    JSON.stringify(receipt),
  );

  // ── B 截断断言：故意让刀落在工具轮中间 ────────────────────────────
  //    30 条上限。造 33 条：3 条旧的 + 之后正好 30 条，且第 4~5 条是一轮工具的
  //    申请表+回执 —— 切最近 30 条会把这一轮的 user 切掉，剩下孤儿申请表开头
  const conv2 = await createConversation(`${MARK} 截断`);
  await appendMessage(conv2, { role: 'user', content: '旧对话1' });      // 1
  await appendMessage(conv2, { role: 'assistant', content: '旧回复1' }); // 2
  await appendMessage(conv2, { role: 'user', content: '记一笔咖啡' });    // 3 ← 这轮的 user
  await appendToolRound(conv2, 'call_exp_2', '已记账（#99）：餐饮 25.00 元'); // 4,5 ← 刀会落在这
  await appendMessage(conv2, { role: 'assistant', content: '记好了' });  // 6
  // 7~33：再造 27 条普通对话（user/assistant 交替，user 开头）
  for (let i = 0; i < 27; i++) {
    await appendMessage(conv2, {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `填充${i}`,
    });
  }

  const h2 = await buildHistory(conv2);
  // 🔬 切最近 30 条 = 从第 4 条（申请表）开始 → 对齐规则应该把 4,5,6 都丢掉，从第 7 条(user)开始
  check('B1 首条必是 user', h2[0]?.role === 'user', String(h2[0]?.role));
  const orphanReceipts = h2.filter(
    (m, i) => m.role === 'tool' && (i === 0 || !(h2[i - 1] as { tool_calls?: unknown[] }).tool_calls),
  );
  check('B2 ⭐ 没有孤儿回执（前一条必是申请表）', orphanReceipts.length === 0, `有 ${orphanReceipts.length} 条`);
  const tailOrphan = h2[h2.length - 1] as { tool_calls?: unknown[] };
  check('B3 结尾不是孤儿申请表', !tailOrphan.tool_calls, JSON.stringify(tailOrphan));
  check('B4 条数不超上限', h2.length <= 30, `${h2.length} > 30`);

  // ── C 展示历史过滤 ────────────────────────────────────────────────
  const shown = await listDisplayMessages(conv);
  check(
    'C 人只看到 user/assistant 正文',
    shown.length === 2 && shown.every((m) => m.role !== 'tool' && m.content !== ''),
    JSON.stringify(shown),
  );

  // ── D 排序断言 ──────────────────────────────────────────────────
  //    ⚠️ DATETIME 秒级精度，两个会话同一秒建的分不出先后 ——
  //    先把 conv 的 updated_at 拨回一小时（确定性，不靠 sleep），再给它追加一条
  await pool.query('UPDATE conversations SET updated_at = NOW() - INTERVAL 1 HOUR WHERE id = ?', [conv]);
  const before = await listConversations();
  const mine = before.filter((c) => c.title.startsWith(MARK));
  check('D1 拨回后旧会话排后面', mine[0]?.id === conv2 && mine[1]?.id === conv, mine.map((c) => c.id).join(','));

  // ⚠️ conv2 也得拨回去：它最后一条填充消息是刚刚插的，跟下面 bump 同一秒
  //    → 平手时 id DESC 让 conv2 赢 → D2 假失败（第一次跑就是这么挂的，1 失败）
  //    ⭐ 跟 D1 同一个手法：确定性拨时间，不靠 sleep 碰运气
  await pool.query('UPDATE conversations SET updated_at = NOW() - INTERVAL 30 MINUTE WHERE id = ?', [conv2]);
  await appendMessage(conv, { role: 'user', content: '又说话了' }); // 🗄️ bump 回最新
  const after = await listConversations();
  const mine2 = after.filter((c) => c.title.startsWith(MARK));
  check('D2 追加消息后跳回最前', mine2[0]?.id === conv, mine2.map((c) => c.id).join(','));

  // ── 自清理：先删 messages（要用到 conversations 的 id），再删 conversations ──
  const [convRows] = await pool.query('SELECT id FROM conversations WHERE title LIKE ?', [`${MARK}%`]);
  const ids = (convRows as { id: number }[]).map((r) => r.id);
  if (ids.length > 0) {
    const [dm] = await pool.query('DELETE FROM messages WHERE conversation_id IN (?)', [ids]);
    const [dc] = await pool.query('DELETE FROM conversations WHERE title LIKE ?', [`${MARK}%`]);
    const n = (r: unknown) => (r as { affectedRows: number }).affectedRows;
    console.log(`\n🧹 已清理：messages ${n(dm)} 行 / conversations ${n(dc)} 行`);
  }

  console.log(`\n📊 ${pass} 过 / ${fail} 失败`);
  await pool.end();
}

main();
