// 🔬 实验：改 / 删 / 恢复 三个新工具 + 软删对旧代码的影响（W12 D1 · ②）
//    ⭐ 一律走 executeTool(name, argsJSON, ctx) —— 跟 agent.ts 里生产的调用【逐条一致】，
//       不去调模块内部函数。D5 那个"实验环境跟真实环境不一致"的错犯了四次，这次不犯
//    ⭐ 自包含：自己造数据（note 带 exp-crud 前缀）、自己清数据（清理用 LIKE）
import { pool } from '../services/db.js';
import { executeTool } from '../services/tools/index.js';
import { logEvent } from '../services/trace.js';
import { judge, reflect } from '../services/audit.js';
import { hasRecentConfirmed } from '../services/pending.js';
import type { ToolContext } from '../services/tools/types.js';

const MARK = 'exp-crud';                 // 🔬 造的数据都带这个印子，清理时用 LIKE 认它
const TRACE = `${MARK}-${Date.now()}`;   // 🔬 本次实验的假案卷编号
const ctx: ToolContext = { traceId: TRACE, agent: MARK, seq: 1, batch: 1 };

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} → ${detail}`); }
}
// 🔬 大部分断言都是"回执里该有哪几个词"，包一层省得重复写
function expect(name: string, receipt: string, ...must: string[]) {
  const missing = must.filter((m) => !receipt.includes(m));
  check(`${name}（含 ${must.join(' / ')}）`, missing.length === 0, receipt);
}

async function main() {
  // ── 造一笔属于实验自己的账 ────────────────────────────────────────
  const [ins] = await pool.query(
    "INSERT INTO expenses (amount, category, note) VALUES (28, '餐饮', ?)",
    [`${MARK} 星巴克拿铁`],
  );
  const id = (ins as { insertId: number }).insertId;
  console.log(`\n🔬 造了一笔 #${id}：餐饮 28.00 元\n`);

  // ── ① 改：正常改金额 ──────────────────────────────────────────────
  const r1 = await executeTool('update_expense', JSON.stringify({ id, amount: 35 }), ctx);
  expect('① 改金额', r1, '已修改', '28.00', '35.00');

  // ── ② 改：同一个值再来一次 → 幂等（changedRows=0）────────────────
  const r2 = await executeTool('update_expense', JSON.stringify({ id, amount: 35 }), ctx);
  expect('② 重复改同值 = 幂等', r2, '已修改', '没有重复修改');

  // ── ③ 改：大额不许从这条路走（⭐ 防绕过 HITL）──────────────────────
  const r3 = await executeTool('update_expense', JSON.stringify({ id, amount: 99999 }), ctx);
  expect('③ 大额被挡回', r3, '未修改', '超过');
  const [chk3] = await pool.query('SELECT amount FROM expenses WHERE id = ?', [id]);
  check('③b 金额没被改动', (chk3 as { amount: string }[])[0].amount === '35.00', '库里被改了！');

  // ── ④ 改：编号不存在 ─────────────────────────────────────────────
  const r4 = await executeTool('update_expense', JSON.stringify({ id: 99999999, amount: 5 }), ctx);
  expect('④ 找不到的编号', r4, '找不到');

  // ── ⑤ 删 ────────────────────────────────────────────────────────
  const r5 = await executeTool('delete_expense', JSON.stringify({ id }), ctx);
  expect('⑤ 删除', r5, '已删除', '35.00', '星巴克拿铁');
  const [d1] = await pool.query('SELECT deleted_at FROM expenses WHERE id = ?', [id]);
  const firstDeletedAt = String((d1 as { deleted_at: Date }[])[0].deleted_at);

  // ── ⑥ 删：再删一次 → 幂等，且【原始删除时间不许被冲掉】───────────
  await new Promise((r) => setTimeout(r, 1100)); // 🔬 等 1 秒多，时间戳变了才测得出有没有被覆盖
  const r6 = await executeTool('delete_expense', JSON.stringify({ id }), ctx);
  expect('⑥ 重复删除 = 幂等', r6, '已删除', '没有重复删除');
  const [d2] = await pool.query('SELECT deleted_at FROM expenses WHERE id = ?', [id]);
  check(
    '⑥b 原始删除时间没被覆盖（COALESCE 生效）',
    String((d2 as { deleted_at: Date }[])[0].deleted_at) === firstDeletedAt,
    `${firstDeletedAt} → ${String((d2 as { deleted_at: Date }[])[0].deleted_at)}`,
  );

  // ── ⑦ 软删后查账查不到它（旧代码那 2 处补丁）────────────────────────
  const q1 = await executeTool('query_expenses', JSON.stringify({ days: 1 }), ctx);
  check('⑦ 查账里已看不到这笔', !q1.includes(`#${id} `), q1);

  // ── ⑦b ⭐ 恢复的眼睛：deleted=true 能看到它（事故修复：没这双眼睛，已删的
  //    编号无处可查，模型只能猜 —— 实测它猜了个 #31 去恢复）
  const q1d = await executeTool('query_expenses', JSON.stringify({ days: 1, deleted: true }), ctx);
  check('⑦b 已删清单里能看到它', q1d.includes(`#${id} `) && q1d.includes('已删除'), q1d);

  // ── ⑧ 已删的那笔不许被偷偷改内容 ─────────────────────────────────
  const r8 = await executeTool('update_expense', JSON.stringify({ id, amount: 50 }), ctx);
  expect('⑧ 已删的不能改', r8, '找不到', '已被删除');

  // ── ⑨ 删掉的那笔，十分钟内可以重新记（跟 rejected 不去重同理）──────
  const r9 = await executeTool(
    'add_expense',
    JSON.stringify({ amount: 35, category: '餐饮', note: `${MARK} 星巴克拿铁` }),
    ctx,
  );
  // 🔁 补丁没打的话，这里会回"这笔刚才已经记过了"（拿被删的那笔去重）
  check('⑨ 删掉的可以重新记', r9.startsWith('已记账') && !r9.includes('已经记过'), r9);

  // ── ⑩ 恢复 ──────────────────────────────────────────────────────
  const r10 = await executeTool('restore_expense', JSON.stringify({ id }), ctx);
  expect('⑩ 恢复', r10, '已恢复', '重新计入');
  const q2 = await executeTool('query_expenses', JSON.stringify({ days: 1 }), ctx);
  check('⑩b 查账里又出现了', q2.includes(`#${id} `), q2);

  // ── ⑪ 恢复：对一笔没被删过的再恢复一次 ────────────────────────────
  const r11 = await executeTool('restore_expense', JSON.stringify({ id }), ctx);
  // ⭐【不是幂等，是打错目标】（事故修复）：旧版这里回"已恢复…本来就没被删除"
  //    → "已"开头 → 模型和对账双双当成了成功
  expect('⑪ 恢复未删的 → 未恢复', r11, '未恢复', '不处于删除状态');
  check('⑪b 回执不以"已"开头（对账协议）', !r11.startsWith('已'), r11);

  // ── ⑫⭐ 对账回归：旧规则会不会被新工具误伤 ──────────────────────────
  //    生产里 tool_call 事件是 agent.ts 写的，这里手工补一条，让案卷长得跟真的一样
  console.log('\n🔎 对账回归（规则③⑤ 的 !attemptedEdit 补丁）：');
  const tOk = `${TRACE}-ok`;
  // ⭐ 用“已记”—— 它才是 CLAIM_ADD 词表里真有的词。
  //    ⚠️ 第一版写的是“已经帮你改好了”，实测发现它一个词都没命中，
  //       那条断言无论补丁在不在都会绿 —— 跟 D5 那个判分正则没验证是同一个错
  const REPLY_EDIT = '好了，那笔已记为 35 元。';
  await logEvent(tOk, { round: 1, agent: MARK, type: 'tool_call', toolName: 'update_expense', result: '已修改（#1）：餐饮 28.00 元 → 餐饮 35.00 元' });
  const v1 = await judge(tOk, REPLY_EDIT);
  check('⑫ 正常修改不被误报', v1.ok, v1.reason);

  // 🔬 对照组：同一句话 + 空案卷（真的一次工具都没调）→ 必须被对账判成谎报
  //    它存在的唯一目的：证明 REPLY_EDIT 确实能踩响规则③。不做对照就不知道
  //    上面那条断言到底测了什么（第一版用的话压根没命中 CLAIM_ADD，是假通过）
  //    ⚠️⭐ W12 D1 下午规则③补丁后有了【环境耦合】：真库里 10 分钟内有
  //    已确认落库的提案时，这句话是合法的（补丁的故意行为）——
  //    所以按当下真库状态分两支，两支都是新语义的确定性断言，不是碰运气
  const liveRecent1 = await hasRecentConfirmed();
  const v1ctrl = await judge(`${TRACE}-ctrl1`, REPLY_EDIT);
  if (liveRecent1) {
    check('⑫-对照 确认窗口内被容忍（规则③补丁语义）', v1ctrl.ok, v1ctrl.reason);
  } else {
    check('⑫-对照 这句话确实能踩响规则③', !v1ctrl.ok, '空案卷下竟然判一致 → 上面那条断言是假的');
  }

  const tBad = `${TRACE}-bad`;
  await logEvent(tBad, { round: 1, agent: MARK, type: 'tool_call', toolName: 'delete_expense', result: '找不到这笔（#99999999）。请先用 query_expenses 查到正确的编号。' });
  const v2 = await judge(tBad, '好了，那笔已经帮你删掉了。');
  // 🔬 不只看 !ok，还要看是不是规则⑥判的 —— 判对了但理由不对也算假通过
  check('⑬ 删除谎报被抓到（规则⑥）', !v2.ok && v2.reason.includes('改/删/恢复'), v2.reason);

  // ⭐ 规则⑤ 的补丁：它要查真库，必须库里真有一笔「10 分钟内已确认」的提案才会触发
  //    → 实验自己造一条（带 MARK，最后用 LIKE 清）。不造就又是一条假断言
  //    ⭐ W12 D4 B1 后 hasRecentConfirmed 改 JOIN 真账表按 expenses.created_at 判确认时刻 ——
  //    幽灵 expense_id（旧版填 1）会扑空，必须配一条真 expenses 行（不变量 9 又一次应验）
  const [r5e] = await pool.query(
    "INSERT INTO expenses (amount, category, note) VALUES (9999, '购物', ?)",
    [`${MARK} 对照用`],
  );
  await pool.query(
    "INSERT INTO pending_expenses (trace_id, amount, category, note, reason, status, expense_id) VALUES (?, 9999, '购物', ?, '实验造数据', 'confirmed', ?)",
    [TRACE, `${MARK} 对照用`, (r5e as { insertId: number }).insertId],
  );
  // 🤖 "失败"同时在 ADMIT_FAIL 和 ADMIT_EDIT_FAIL 两份词表里 —— 正好用来测交叉
  const REPLY_DEL_FAIL = '那笔删除失败了，没能删掉。';
  const tOk2 = `${TRACE}-ok2`;
  await logEvent(tOk2, { round: 1, agent: MARK, type: 'tool_call', toolName: 'delete_expense', result: '找不到这笔（#99999999）。' });
  const v3 = await judge(tOk2, REPLY_DEL_FAIL);
  // ⭐ 它诚实报告了失败 → 应该判一致。补丁前会被规则⑤拿那条无关的提案误报
  check('⑭ 诚实报告删除失败不被误报', v3.ok, v3.reason);

  // 🔬 对照组：同一句话 + 空案卷 → 规则⑤ 必须拿那条提案报谎报
  const v3ctrl = await judge(`${TRACE}-ctrl2`, REPLY_DEL_FAIL);
  check('⑭-对照 这句话确实能踩响规则⑤', !v3ctrl.ok, '空案卷下竟然判一致 → 上面那条断言是假的');

  // ── ⑮⑯⭐ 本次事故的两条回归（restore 打空 + 零工具纠正话术）────────
  console.log('\n🔎 事故回归：');

  // ⑮ 事故原现场：restore 打空（回"未恢复"），模型却报"已经恢复回来了"
  //    旧回执是"已恢复"开头 → succeededEdit=true → 规则⑥永远不触发（被骗）
  //    新回执"未恢复"开头 → 现在必须能抓到
  const tNoop = `${TRACE}-noop`;
  await logEvent(tNoop, { round: 1, agent: MARK, type: 'tool_call', toolName: 'restore_expense', result: '未恢复（#31）：购物 50000.00 元 当前不处于删除状态，本次没有改动。' });
  const v4 = await judge(tNoop, '好嘞！已经把那笔恢复回来了。');
  check('⑮ 事故原现场现在能被抓到', !v4.ok && v4.reason.includes('改/删/恢复'), v4.reason);

  // ⑮b 诚实版：同一个案卷，如实说"那笔没删过" → 不该报（词表新补的词）
  const v4b = await judge(tNoop, '那笔本来就没删过，不需要恢复呀。');
  check('⑮b 诚实转述打空不被误报', v4b.ok, v4b.reason);

  // ⑯ 零工具路径的纠正话术：要换成"你没调工具，什么都没发生"那套
  //    而不是老套"以上面工具回执为准"（零工具路上根本没有回执可依）
  //    ⚠️⭐ 先把自己造的 confirmed 提案清掉 —— 规则③补丁会被它安抚，
  //    reflect 就不拦了（W12 D1 下午真挂过：23/24，就是这里）；
  //    然后同样按真库当下状态分两支断言
  await pool.query('DELETE FROM pending_expenses WHERE note LIKE ?', [`${MARK}%`]);
  const liveRecent2 = await hasRecentConfirmed();
  const corr = await reflect(`${TRACE}-empty`, '好嘞！已记好了，放心吧。', MARK);
  if (liveRecent2) {
    // 🔴 规则③的已知代价窗口：确认后 10 分钟内吹牛会被放过（出路是 D4 LLM-as-judge）
    check('⑯ 确认窗口内不拦（规则③补丁语义）', corr === null, corr ?? 'null');
  } else {
    check(
      '⑯ 零工具路径用专属纠正话术',
      !!corr && corr.includes('没有调用任何工具') && !corr.includes('以上面工具回执'),
      corr ?? '（竟然没拦）',
    );
  }

  // ── 自清理：清理用 LIKE，不用 = ──────────────────────────────────
  const [del] = await pool.query('DELETE FROM expenses WHERE note LIKE ?', [`${MARK}%`]);
  const [delT] = await pool.query('DELETE FROM traces WHERE trace_id LIKE ?', [`${MARK}-%`]);
  const [delP] = await pool.query('DELETE FROM pending_expenses WHERE note LIKE ?', [`${MARK}%`]);
  const n = (r: unknown) => (r as { affectedRows: number }).affectedRows;
  console.log(`\n🧹 已清理：expenses ${n(del)} 行 / traces ${n(delT)} 行 / pending ${n(delP)} 行`);

  console.log(`\n📊 ${pass} 过 / ${fail} 失败`);
  await pool.end();
}

main();
