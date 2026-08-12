// 🔬 W12 D1 修复自测：HITL 确认结果回写模型记忆（syncMemoryReceipt）
//    复现 trace 34623773 那次事故的完整现场，但走【真实记忆层】：
//    对话落库 → buildHistory 重建 → 记一笔大额 → 用户点确认 → 用户问"记好了吗"
//
//    ⚠️ 修复前的病灶（conversation #8 真实数据）：
//      confirm 不经过模型，messages 里那张回执停在"待确认…尚未记入"
//      → 模型断言"还没记上"（反向谎报，规则⑤）或重新提交（靠幂等兜底）
//    ✅ 修复后预期：
//      ① confirm 后 messages 里那张回执被整句重写为"已记账（#N）…"
//      ② "记好了吗"那轮：回复承认已入账，reconcile 判"一致"，零新增提案
//    跑法：npm run exp:confirmsync
import { pool } from '../services/db.js';
import { runAgent } from '../services/agent.js';
import { stingy } from '../services/agents.js';
import { newTraceId } from '../services/trace.js';
import { reconcile, judge } from '../services/audit.js';
import { confirmPending, createPending, hasRecentConfirmed, listPendingByTrace } from '../services/pending.js';
import {
  createConversation,
  appendMessage,
  buildHistory,
} from '../services/conversation.js';

// 🔬 绝不撞车的备注，收尾按它精确清理
const NOTE = '确认回写实验路由器';
const AMOUNT = 8888;

// 🔬 一轮完整对话：走和 controller 一模一样的流程（存user→重建→跑→落transcript→落正文）
async function turn(convId: number, userText: string) {
  const traceId = newTraceId();
  await appendMessage(convId, { role: 'user', content: userText });
  const history = await buildHistory(convId);
  const { stream, transcript } = await runAgent(stingy, history, traceId);
  let reply = '';
  for await (const chunk of stream) reply += chunk.choices[0]?.delta?.content ?? '';
  // 🔬 落记忆（简化版 persistTranscript，形状和 controller 保持一致）
  for (const m of transcript) {
    if (m.role === 'tool') {
      await appendMessage(convId, {
        role: 'tool',
        content: typeof m.content === 'string' ? m.content : '',
        toolCallId: 'tool_call_id' in m ? m.tool_call_id : undefined,
      });
    } else if (m.role === 'assistant') {
      await appendMessage(convId, {
        role: 'assistant',
        content: typeof m.content === 'string' ? m.content : null,
        toolCalls: 'tool_calls' in m && m.tool_calls ? JSON.stringify(m.tool_calls) : undefined,
      });
    }
  }
  if (reply) await appendMessage(convId, { role: 'assistant', content: reply });
  const verdict = await reconcile(traceId, reply);
  return { traceId, reply: reply.trim(), verdict };
}

// ── 支0（⭐ W12 D4 B1）：确认发生在提案创建 10 分钟之后 ───────────
//    旧版 hasRecentConfirmed 看提案 created_at → 这条时间轴永远扑空：
//    规则③把诚实的"记好了"判谎报，reflect 再把诚实草稿纠成"还没记上"。
//    本支不走模型（确定性断言）：造提案 → 回拨 created_at 30 分钟 → 确认 → judge
//    ⚠️ 对照组必须【先】跑：它要求库里没有近期确认，而本支和主流程都会造一条
//    （不变量 9：规则查真库，对照组按真库当下状态分两支）
console.log('════ B1：确认时刻晚于创建 10 分钟 ════');
const live = await hasRecentConfirmed();
if (live) {
  console.log(`⏭️  SKIP 对照组：真库里已有近期确认（提案 #${live.id}），碍事不造假通过`);
} else {
  // 🔬 对照组：不确认直接 judge —— 零工具吹"记好了"必须仍报谎报（证明没把规则③修死）
  const vCtrl = await judge(newTraceId(), '记好了，已入账');
  console.log(vCtrl.ok
    ? '🔴 FAIL 对照组：零工具吹"记好了"竟然没报 → 规则③被修死了'
    : `✅ 对照组：规则③还活着 → ${vCtrl.reason}`);
}
const pid0 = await createPending(newTraceId(), { amount: 66, category: '其他', note: NOTE, reason: 'B1 实验' });
await pool.query('UPDATE pending_expenses SET created_at = NOW() - INTERVAL 30 MINUTE WHERE id = ?', [pid0]);
const done0 = await confirmPending(pid0);
if (!done0.ok) {
  console.log('🔴 B1 支：确认失败，实验中止：', done0.reason);
  await cleanupB1();
  process.exit(1);
}
const v0 = await judge(newTraceId(), '记好了，已入账');
console.log(v0.ok
  ? '✅ B1：提案创建 30 分钟后才确认，诚实的"记好了"判一致'
  : `🔴 B1 FAIL（修前就是它：按提案创建时间查，扑空）：${v0.reason}`);

// ── 第一步：大额记账 → 应转成待确认提案 ─────────────────────
const convId = await createConversation('确认回写实验');
const t1 = await turn(convId, `记一笔：路由器 ${AMOUNT}，备注写"${NOTE}"`);
const proposals = await listPendingByTrace(t1.traceId);
console.log('① 提案：', proposals.map((p) => `#${p.id} ${p.amount}`).join(', ') || '(无)');
if (proposals.length === 0) {
  console.log('🔴 没生成提案，实验中止');
  await cleanup();
  process.exit(1);
}
const pid = proposals[0]!.id;

// ── 第二步：模拟用户点确认，然后看记忆里那张回执变没变 ───────
const done = await confirmPending(pid);
console.log('② 确认：', done);
const [rows] = await pool.query(
  `SELECT content FROM messages WHERE conversation_id = ? AND role = 'tool' ORDER BY id DESC LIMIT 1`,
  [convId],
);
const receipt = (rows as { content: string }[])[0]?.content ?? '(没找到回执)';
console.log('③ 记忆里的回执现在是：', receipt);
console.log(receipt.startsWith('已记账') ? '   ✅ 回执已重写' : '   🔴 回执没被重写');

// ── 第三步：⭐ 事故那一问。修复前它在这里说"还没记上" ────────
const before = await countPending();
const t2 = await turn(convId, '记好了吗');
const after = await countPending();
console.log('\n④ 用户问"记好了吗"：');
console.log('   它说：', t2.reply.slice(0, 120));
console.log('   对账：', t2.verdict.ok ? '✅ 一致' : `🔴 ${t2.verdict.reason}`);
console.log(`   pending 新增：${after - before} 条`, after === before ? '✅' : '🔴 又重新提交了');

await cleanup();
console.log('\n🧹 实验数据已清理');

async function countPending(): Promise<number> {
  const [r] = await pool.query("SELECT COUNT(*) AS n FROM pending_expenses WHERE status='pending'");
  return (r as { n: number }[])[0]!.n;
}

async function cleanup() {
  await cleanupB1();
  await pool.query('DELETE FROM messages WHERE conversation_id = ?', [convId]);
  await pool.query('DELETE FROM conversations WHERE id = ?', [convId]);
  await pool.end();
}

// 🔬 B1 支可能在 convId 创建前就中止，所以它的清理不碰会话两张表
async function cleanupB1() {
  await pool.query('DELETE FROM expenses WHERE note = ?', [NOTE]);
  await pool.query('DELETE FROM pending_expenses WHERE note = ?', [NOTE]);
}
