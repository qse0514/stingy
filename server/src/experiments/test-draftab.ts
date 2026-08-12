// 🔬 Reflection 的 A/B：纠正指令生效，需不需要把【草稿】也放进 history？
//    跑法：npm run exp:draftab
//
//    ⚠️ 这个实验的由来（记下来，别删）：
//    学员问"是不是把整个 chat 发回去让模型 review"，为了准确回答去数了一遍
//    history 的内容，才发现 —— 生产环境里草稿【从来没进 history】：
//      agent.ts 的 history.push(reply) 写在 break 之后，只对"申请工具的回复"生效，
//      而草稿正是"不申请工具"的那个回复，被 break 跳过了。
//    而 test-reflect.ts 里我手动塞了 { role:'assistant', content: BAD_DRAFT }
//    → 那个 3/3 测的不是真实链路。这是第三次犯"实验没对齐现实"的错。
//
//    A 组 = 生产环境现状（无草稿）
//    B 组 = 我原来实验的样子（有草稿）
import { pool } from '../services/db.js';
import { client } from '../services/openai.js';
import { logEvent, newTraceId } from '../services/trace.js';
import { reflect, judge } from '../services/audit.js';
import { stingy } from '../services/agents.js';
import type OpenAI from 'openai';

const N = 3;
const PEND =
  '待确认（提案 #99）：购物 88888.00 元。原因：单笔 88888 元超过 5000 元。本笔尚未记入，已请用户在界面上确认。';
const BAD_DRAFT = '搞定，这笔 88888 已经入账啦！';
// 🔬 漏嘴检测：用户没看到草稿，提"刚才"就是漏嘴
const LEAK = /刚才|等等|说快|过头|上一版|更正|抱歉我|重新说/;

// 🔬 前四条两组共用
const base: OpenAI.Chat.ChatCompletionMessageParam[] = [
  { role: 'system', content: stingy.systemPrompt },
  { role: 'user', content: '帮我记一笔：手袋 88888' },
  {
    role: 'assistant',
    content: null,
    tool_calls: [
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'add_expense', arguments: '{"amount":88888,"category":"购物"}' },
      },
    ],
  },
  { role: 'tool', tool_call_id: 'call_1', content: PEND },
];

async function runGroup(label: string, withDraft: boolean) {
  let fixed = 0;
  let leaks = 0;
  console.log(`\n════ ${label} ════`);

  for (let i = 1; i <= N; i++) {
    const traceId = newTraceId();
    await logEvent(traceId, {
      round: 1, agent: 'stingy', type: 'tool_call', toolName: 'add_expense', result: PEND,
    });
    const correction = await reflect(traceId, BAD_DRAFT, 'stingy');

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...base,
      // 🔬 唯一的自变量就是这一条
      ...(withDraft
        ? ([{ role: 'assistant', content: BAD_DRAFT }] as OpenAI.Chat.ChatCompletionMessageParam[])
        : []),
      { role: 'system', content: correction! },
    ];

    const res = await client.chat.completions.create({ model: 'deepseek-chat', messages });
    const out = (res.choices[0]?.message.content ?? '').trim();
    const v = await judge(traceId, out);
    const leaked = LEAK.test(out);
    if (v.ok) fixed++;
    if (leaked) leaks++;

    console.log(`  ${i}. ${v.ok ? '✅ 合格' : `🚨 ${v.reason}`}${leaked ? ' ⚠️漏嘴' : ''}`);
    console.log(`     「${out.slice(0, 76)}」`);
    await pool.query('DELETE FROM traces WHERE trace_id = ?', [traceId]);
  }
  return { fixed, leaks };
}

// 🔬 A 组先跑（它是现状，先知道现状好不好）
const a = await runGroup('A 组：生产环境现状（history 里【没有】草稿）', false);
const b = await runGroup('B 组：把草稿也放进 history', true);

console.log('\n════ 汇总 ════');
console.log(`A（无草稿·现状）  改对 ${a.fixed}/${N}  漏嘴 ${a.leaks}/${N}`);
console.log(`B（有草稿）       改对 ${b.fixed}/${N}  漏嘴 ${b.leaks}/${N}`);

await pool.end();
