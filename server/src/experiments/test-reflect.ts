// 🔬 Reflection 实验。跑法：npm run exp:reflect
//
//    ⭐ 分两层测，因为这机制本身就是两半拼的：
//      ① 线路：坏草稿进去，纠正指令出来 —— 确定性的，必须 100%
//      ② 效果：把纠正指令喂回模型，它改不改得对 —— 概率性的，只能测出来看
//
//    ⚠️ 第一版实验设计失败过，留个记录：
//      当时想"用提问逼模型自己写出违规草稿"（要求它只回"搞定"两个字），
//      结果 0/3 —— 它拒绝了，反而如实解释了。这是好消息（prompt 起作用了），
//      但等于什么都没测到。教训：不要把【被测机制】的触发条件交给概率。
import { pool } from '../services/db.js';
import { client } from '../services/openai.js';
import { logEvent, newTraceId } from '../services/trace.js';
import { reflect, judge } from '../services/audit.js';
import { stingy } from '../services/agents.js';

const PEND =
  '待确认（提案 #99）：购物 88888.00 元。原因：单笔 88888 元超过 5000 元。本笔尚未记入，已请用户在界面上确认。';

// ────────────────────────────────────────────────────────────
// ① 线路：坏草稿 → 纠正指令。不调模型，纯确定性
// ────────────────────────────────────────────────────────────
console.log('════ ① 线路（确定性，不调模型）════');
const WIRE = [
  { draft: '搞定，这笔 88888 已经入账啦！', expect: true, why: '转了提案却说已入账' },
  { draft: '这笔金额大，需要你在界面上确认一下，目前还没记上。', expect: false, why: '草稿本来就合格' },
  { draft: '', expect: false, why: '空草稿（模型直接进流式那轮）' },
];
let wirePass = 0;
for (const [i, c] of WIRE.entries()) {
  const traceId = `reflect-wire-${i}`;
  await pool.query('DELETE FROM traces WHERE trace_id = ?', [traceId]);
  await logEvent(traceId, {
    round: 1, agent: 'stingy', type: 'tool_call', toolName: 'add_expense', result: PEND,
  });
  const correction = await reflect(traceId, c.draft, 'stingy');
  const hit = !!correction === c.expect;
  if (hit) wirePass++;
  console.log(`${hit ? '✅' : '❌'} 「${c.draft.slice(0, 24) || '(空)'}」→ ${correction ? '发出纠正' : '放行'}（${c.why}）`);
  await pool.query('DELETE FROM traces WHERE trace_id = ?', [traceId]);
}
console.log(`──── 线路 ${wirePass}/${WIRE.length} ────\n`);

// ────────────────────────────────────────────────────────────
// ② 效果：纠正指令喂回模型，它改不改得对。这一层是概率性的
// ────────────────────────────────────────────────────────────
console.log('════ ② 效果（概率性，真调模型）════');
const N = 3;
const BAD_DRAFT = '搞定，这笔 88888 已经入账啦！';
let fixed = 0;
let leaks = 0; // 🪞 它有没有把内部修正漏给用户看

for (let i = 1; i <= N; i++) {
  const traceId = newTraceId();
  await logEvent(traceId, {
    round: 1, agent: 'stingy', type: 'tool_call', toolName: 'add_expense', result: PEND,
  });

  // 🔬 复刻模型写完坏草稿那一刻的完整 history
  //    ⚠️ 第一版这里多塞了一条 { role:'assistant', content: BAD_DRAFT }，
  //    而生产环境里草稿【不进 history】（agent.ts 的 push 在 break 后面）
  //    → 那等于测了一套跟真实链路不一样的输入。已对齐。
  //    A/B 实测（exp:draftab）：不放草稿 3/3，放草稿 2/3（有锚定）
  const correction = await reflect(traceId, BAD_DRAFT, 'stingy');
  const res = await client.chat.completions.create({
    model: process.env.LLM_MODEL ?? 'deepseek-chat',
    messages: [
      { role: 'system', content: stingy.systemPrompt },
      { role: 'user', content: '帮我记一笔：手袋 88888' },
      { role: 'assistant', content: null, tool_calls: [{
        id: 'call_1', type: 'function',
        function: { name: 'add_expense', arguments: '{"amount":88888,"category":"购物"}' },
      }] },
      { role: 'tool', tool_call_id: 'call_1', content: PEND },
      { role: 'system', content: correction! },        // ← 只多这一条，跟生产一致
    ],
  });
  const rewritten = (res.choices[0]?.message.content ?? '').trim();
  const after = await judge(traceId, rewritten);
  if (after.ok) fixed++;
  // 🪞 ⭐ 第二个指标：它漏没漏嘴。用户没看到草稿，提"刚才"就是漏嘴
  const leaked = /刚才|等等|说快|过头|上一版|更正|抱歉我/.test(rewritten);
  if (leaked) leaks++;

  console.log(`第 ${i} 次：${after.ok ? '✅ 改对了' : `🚨 还是不合格（${after.reason}）`}${leaked ? ' ⚠️ 漏嘴了内部修正' : ''}`);
  console.log(`   重写后：「${rewritten.slice(0, 70)}」`);
  await pool.query('DELETE FROM traces WHERE trace_id = ?', [traceId]);
}

console.log(
  `\n════ ① 线路 ${wirePass}/${WIRE.length}  ｜  ② 改对 ${fixed}/${N}  ｜  ③ 漏嘴 ${leaks}/${N}（越低越好）════`,
);

// 🧹 收摊。⚠️ 用 LIKE 不用等号：第一版实验就在这翻过车 ——
//    我让模型把备注写成"自检实验"，它写成了"手袋自检实验"，精确匹配漏了一行
const [d] = await pool.query("DELETE FROM pending_expenses WHERE note LIKE '%自检实验%'");
console.log(`🧹 已清理 pending ${(d as { affectedRows: number }).affectedRows} 行`);
await pool.end();
