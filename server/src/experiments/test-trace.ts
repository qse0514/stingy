// 🔬 一次性实验脚本：直捅 trace 模块，不经过模型、不碰 llm.ts
//    要证明的三件事：① 能写 ② 能按案件编号翻回来 ③ 并发交叉也能拆开
//    跑法：npm run exp:trace   （可反复跑，固定 id 每次先清）
import { pool } from '../services/db.js';
import { logEvent, getTrace, type TraceRow } from '../services/trace.js';

// 🔬 用固定假 id，方便反复跑和事后清理（真实的是 randomUUID）
const A = 'demo-A';
const B = 'demo-B';
const C = 'demo-C';

// 🔬 打印成"案卷"的样子
function printTrace(name: string, rows: TraceRow[]) {
  console.log(`\n📁 案卷 ${name}（${rows.length} 条事件）`);
  for (const r of rows) {
    const head = `  ├─ round ${r.round}  ${r.type.padEnd(13)}`;
    if (r.type === 'tool_call') {
      console.log(`${head} ${r.tool_name}(${r.tool_args}) → ${r.result}  ${r.duration_ms}ms`);
    } else if (r.type === 'llm_call') {
      console.log(`${head} ${r.duration_ms}ms  ${r.tokens} token`);
    } else {
      console.log(head);
    }
  }
}

// 🔬 洗干净再开始：实验数据不许留在库里过夜
await pool.query('DELETE FROM traces WHERE trace_id IN (?, ?, ?)', [A, B, C]);

// 🔬 ⭐ 故意交替写：模拟三个用户同时在用 Stingy，事件在库里是交叉落地的
await logEvent(A, { round: 1, type: 'llm_call', durationMs: 1200, tokens: 480 });
await logEvent(B, { round: 1, type: 'llm_call', durationMs: 980, tokens: 210 });
await logEvent(A, { round: 1, type: 'tool_call', toolName: 'add_expense', toolArgs: '{"amount":30,"category":"餐饮"}', result: '已记账（#14）：餐饮 30.00 元', durationMs: 45 });
await logEvent(C, { round: 1, type: 'llm_call', durationMs: 760, tokens: 190 });
await logEvent(B, { round: 1, type: 'tool_call', toolName: 'get_time', toolArgs: '{}', result: '2026/8/4 16:00:00', durationMs: 1 });
await logEvent(A, { round: 1, type: 'tool_call', toolName: 'query_expenses', toolArgs: '{"days":30}', result: '最近 30 天共 4 笔，合计 100.00 元', durationMs: 12 });
// ⭐ C 这条是今天的重点：模型一个工具都没申请 —— 缺席也留痕
await logEvent(C, { round: 1, type: 'no_tool_call' });
await logEvent(A, { round: 2, type: 'llm_call', durationMs: 900, tokens: 620 });
await logEvent(A, { round: 2, type: 'no_tool_call' });
await logEvent(A, { round: 2, type: 'final' });
await logEvent(B, { round: 2, type: 'final' });
await logEvent(C, { round: 1, type: 'final' });

// 🔬 ① 先看"原始流水"——这就是现在 console.log 给我们的视野：三个人的事全糊在一起
console.log('══════ 原始流水（按落库顺序，等同于现在的 console.log 视野）══════');
const [all] = await pool.query(
  'SELECT trace_id, round, type, tool_name FROM traces WHERE trace_id IN (?, ?, ?) ORDER BY id',
  [A, B, C],
);
console.table(all);

// 🔬 ② 再按案件编号各自翻出来——同一批数据，瞬间拆成三份干净案卷
console.log('\n══════ 按 trace_id 翻案卷（缺陷③ 治好了的样子）══════');
printTrace('A · 记账 + 查账', await getTrace(A));
printTrace('B · 只问时间', await getTrace(B));
printTrace('C · 模型没调任何工具 ⭐', await getTrace(C));

// 🔬 ③ 预演对账：程序（不是人眼）判断这次到底有没有真的记账
for (const [name, id] of [['A', A], ['C', C]] as const) {
  const rows = await getTrace(id);
  const didAdd = rows.some((r) => r.type === 'tool_call' && r.tool_name === 'add_expense');
  console.log(`\n🔎 案卷 ${name}：实际调用过 add_expense ？ → ${didAdd}`);
}

await pool.end();
