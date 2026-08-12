// 🔬 幂等修复的完整闭环自测（自己造数据、自己清理，不依赖历史遗留）
//    流程：提一笔大额 → 确认落库 → 立刻说"好了" → 看它会不会又提交一遍
//
//    ⚠️ 改前的实测结果（真实数据，别删）：
//       3/3 都重新调了 add_expense，生成 6 个重复提案（#8~#13）
//       连带把"面包 500"重复记了一笔（expenses #27）
//       往 messages 塞事实：0/3    往 systemPrompt 塞事实：0/3
//    ⭐ 结论：问题不在"怎么告诉模型"，在"工具允许无限重复提交"
//    跑法：npm run exp:afterconfirm
import { pool } from '../services/db.js';
import { runAgent } from '../services/agent.js';
import { stingy } from '../services/agents.js';
import { newTraceId, getTrace } from '../services/trace.js';
import { confirmPending, listPendingByTrace } from '../services/pending.js';
import type { Message } from '../types/chat.js';

// 🔬 用一个绝不会撞车的备注，方便实验后精确清理
const NOTE = '幂等实验相机';
const AMOUNT = 7777;

// 🔬 跑一轮对话，返回它说的话 + 案卷里的工具调用
async function turn(messages: Message[]) {
  const traceId = newTraceId();
  // 🔬 W12 D1：runAgent 改返 { stream, transcript }，实验只取 stream
  const { stream } = await runAgent(stingy, messages, traceId);
  let reply = '';
  for await (const chunk of stream) reply += chunk.choices[0]?.delta?.content ?? '';
  const rows = await getTrace(traceId);
  return {
    traceId,
    reply: reply.trim(),
    calls: rows.filter((r) => r.type === 'tool_call'),
  };
}

// ── 第一步：提一笔大额，应该变成待确认提案 ──────────────────
const ask = `记一笔：相机 ${AMOUNT}，备注写"${NOTE}"`;
const t1 = await turn([{ role: 'user', content: ask }]);
const proposals = await listPendingByTrace(t1.traceId);
console.log('① 提案生成：', proposals.map((p) => `#${p.id} ${p.amount}`).join(', ') || '(无)');
if (proposals.length === 0) {
  console.log('🔴 没生成提案，实验中止');
  await pool.end();
  process.exit(1);
}

// ── 第二步：模拟用户点确认 ───────────────────────────────
const done = await confirmPending(proposals[0]!.id);
console.log('② 确认结果：', done);

// ── 第三步：⭐ 关键那一步。用户只说"好了"，看它会不会重新提交 ──
const before = await snapshotCount();
const t2 = await turn([
  { role: 'user', content: ask },
  { role: 'assistant', content: t1.reply },
  { role: 'user', content: '好了' }, // 🔬 真实说法，不是"你查一下"
]);
const after = await snapshotCount();

console.log('\n③ 用户说"好了"之后：');
console.log('   工具调用：', t2.calls.map((c) => `${c.tool_name}`).join(', ') || '(一次都没调)');
for (const c of t2.calls) console.log('   工具回执：', c.result);
console.log('   它说：', t2.reply.slice(0, 120));
console.log(`\n   pending 新增：${after.pending - before.pending} 条 ｜ expenses 新增：${after.expenses - before.expenses} 行`);
console.log(
  after.pending === before.pending && after.expenses === before.expenses
    ? '   ✅ 零新增 —— 幂等生效'
    : '   🔴 又生了新的，幂等没生效',
);

// ── 收尾：把实验数据删干净 ─────────────────────────────
await pool.query('DELETE FROM expenses WHERE note = ?', [NOTE]);
await pool.query('DELETE FROM pending_expenses WHERE note = ?', [NOTE]);
console.log('\n🧹 实验数据已清理');

async function snapshotCount() {
  const [e] = await pool.query('SELECT COUNT(*) AS n FROM expenses');
  const [p] = await pool.query("SELECT COUNT(*) AS n FROM pending_expenses WHERE status='pending'");
  return { expenses: (e as { n: number }[])[0]!.n, pending: (p as { n: number }[])[0]!.n };
}

await pool.end();
