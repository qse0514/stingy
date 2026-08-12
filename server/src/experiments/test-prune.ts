// 🔬 实验：traces 滚动清理（W12 D1 · ⑥ Observability 无上限）
//    验三件事：
//      A 清理后剩下的【案卷数】正好等于 keep
//      B ⭐ 没有案卷被腰斩 —— 活下来的每一卷事件数都是完整的 3 条
//      C 活下来的是【最新】的那几卷，不是随便几卷
//
// ⚠️⚠️ 这个实验跟别的不一样：pruneTraces 是【全表破坏性删除】，
//    它删的正是"最老的案卷"，而库里那 278 行 W11 证据就是最老的。
//    所以它不能像 test-reflect 那样"造几条自己的数据"就完事 ——
//    必须先把整张表搬走、验证搬走了、清场、测、再搬回来。
//    ⭐ 这就是 W12 D4 那条"测试用独立数据"的规矩，提前用上了。
import { pool } from '../services/db.js';
import { logEvent, pruneTraces, getTrace } from '../services/trace.js';

const BAK = 'traces_exp_bak'; // 🔬 备份表名。⚠️ 实验专用前缀，别跟业务表撞名
const FAKE = 'exp-prune-';    // 🔬 假案卷编号前缀，清理时用 LIKE 认它
const MAKE = 12;              // 🔬 造 12 卷
const EVENTS_PER_TRACE = 3;   // 🔬 每卷 3 个事件 —— 断言 B 靠这个固定值查腰斩
const KEEP = 5;               // 🔬 只留 5 卷

let pass = 0;
let fail = 0;
// 🔬 断言：只打印结果，不抛错 —— 抛了就跑不到 finally 的还原那一步
function check(name: string, ok: boolean, detail: string) {
  if (ok) { pass++; console.log(`  ✅ ${name}：${detail}`); }
  else { fail++; console.log(`  ❌ ${name}：${detail}`); }
}

async function count(sql: string): Promise<number> {
  const [rows] = await pool.query(sql);
  return Number((rows as { n: number }[])[0].n);
}

async function main() {
  // ── ① 先记下真库现状（还原后要拿它对账）─────────────────────────
  const beforeRows = await count('SELECT COUNT(*) n FROM traces');
  const beforeTraces = await count('SELECT COUNT(DISTINCT trace_id) n FROM traces');
  console.log(`\n📋 真库现状：${beforeRows} 行 / ${beforeTraces} 个案卷`);

  // ── ② 备份，然后【验证备份】──────────────────────────────────────
  //    ⭐ "说备份了不等于备份了" —— 先数一遍备份表，对不上就立刻退出，绝不往下删
  await pool.query(`DROP TABLE IF EXISTS ${BAK}`);
  await pool.query(`CREATE TABLE ${BAK} LIKE traces`);
  await pool.query(`INSERT INTO ${BAK} SELECT * FROM traces`);
  const bakRows = await count(`SELECT COUNT(*) n FROM ${BAK}`);
  if (bakRows !== beforeRows) {
    console.log(`\n🔴 备份行数不符（${bakRows} vs ${beforeRows}），已中止，真表一个字没动。`);
    await pool.end();
    process.exit(1);
  }
  console.log(`💾 已备份到 ${BAK}：${bakRows} 行（已核实）`);

  try {
    // ── ③ 清场：备份验证过了，现在可以放心清空真表 ───────────────
    //    ⭐ 自包含 = 不依赖外部状态。留着旧数据，断言 B 的"每卷 3 条"就不成立了
    await pool.query('DELETE FROM traces');

    // ── ④ 造 12 卷 × 3 事件 ────────────────────────────────────────
    for (let i = 1; i <= MAKE; i++) {
      const id = `${FAKE}${String(i).padStart(2, '0')}`;
      await logEvent(id, { round: 1, agent: 'exp-prune', type: 'llm_call' });
      await logEvent(id, { round: 1, agent: 'exp-prune', type: 'tool_call', toolName: 'get_time', result: 'x' });
      await logEvent(id, { round: 0, agent: 'exp-prune', type: 'final' });
    }
    console.log(`🔬 已造 ${MAKE} 卷 × ${EVENTS_PER_TRACE} 事件 = ${MAKE * EVENTS_PER_TRACE} 行`);

    // ── ⑤ 开清 ─────────────────────────────────────────────────────
    const deleted = await pruneTraces(KEEP);
    const expectDeleted = (MAKE - KEEP) * EVENTS_PER_TRACE;
    console.log(`\n🧹 pruneTraces(${KEEP}) 返回删除 ${deleted} 行（预期 ${expectDeleted}）\n`);

    // ── ⑥ 三条断言 ─────────────────────────────────────────────────
    const liveTraces = await count('SELECT COUNT(DISTINCT trace_id) n FROM traces');
    check('A 案卷数', liveTraces === KEEP, `剩 ${liveTraces} 卷，预期 ${KEEP}`);

    // ⭐ B 腰斩检测：这条是这个实验存在的理由。行数对不代表案卷完整
    const [grp] = await pool.query(
      'SELECT trace_id, COUNT(*) n FROM traces GROUP BY trace_id ORDER BY trace_id',
    );
    const groups = grp as { trace_id: string; n: number }[];
    const halved = groups.filter((g) => Number(g.n) !== EVENTS_PER_TRACE);
    check(
      'B 无腰斩',
      halved.length === 0,
      halved.length === 0
        ? `${groups.length} 卷全是完整的 ${EVENTS_PER_TRACE} 条`
        : `有残卷：${halved.map((g) => `${g.trace_id}(${g.n}条)`).join(', ')}`,
    );

    // C 活下来的必须是最新的 5 卷 → 08~12
    const survived = groups.map((g) => g.trace_id).join(',');
    const expected = Array.from({ length: KEEP }, (_, k) =>
      `${FAKE}${String(MAKE - KEEP + 1 + k).padStart(2, '0')}`).join(',');
    check('C 留的是最新的', survived === expected, `${survived}${survived === expected ? '' : ` ≠ ${expected}`}`);

    // 🔎 顺手证一句：被清掉的那卷，getTrace 会翻出空的（回放页将来要认这个情况）
    const gone = await getTrace(`${FAKE}01`);
    check('D 老案卷翻出空的', gone.length === 0, `getTrace(${FAKE}01) → ${gone.length} 行`);
  } finally {
    // ── ⑦ 还原：不管上面成没成，真数据必须回来 ───────────────────
    await pool.query('DELETE FROM traces');
    await pool.query(`INSERT INTO traces SELECT * FROM ${BAK}`);
    const afterRows = await count('SELECT COUNT(*) n FROM traces');
    const afterTraces = await count('SELECT COUNT(DISTINCT trace_id) n FROM traces');
    const restored = afterRows === beforeRows && afterTraces === beforeTraces;
    check('E 真库已还原', restored, `${afterRows} 行 / ${afterTraces} 卷（原 ${beforeRows} / ${beforeTraces}）`);

    if (restored) {
      await pool.query(`DROP TABLE ${BAK}`); // 🔬 自清理：确认还原成功才敢删备份
      // 🔬 兜一手：万一有假案卷漏在真表里（清理用 LIKE，因为编号是我们拼的前缀）
      await pool.query('DELETE FROM traces WHERE trace_id LIKE ?', [`${FAKE}%`]);
    } else {
      // 🔴 少记比多记好，因为少记留下了证据：还原没对上就把备份表留着
      console.log(`\n🔴 还原对不上！${BAK} 已保留，手工恢复：`);
      console.log(`   DELETE FROM traces; INSERT INTO traces SELECT * FROM ${BAK};`);
    }

    console.log(`\n📊 ${pass} 过 / ${fail} 失败`);
    await pool.end();
  }
}

main();
