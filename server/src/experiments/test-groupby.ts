// 🗄️ 一次性实验脚本：用真数据证明 GROUP BY 列名 vs 字符串常量的区别
import { pool } from '../services/db.js';
import { queryExpenses } from '../services/tools/queryExpenses.js';

console.log('\n=== ✅ GROUP BY category （不带引号 = 列名）===');
const [byColumn] = await pool.query(
  'SELECT category, COUNT(*) AS 行数, SUM(amount) AS 合计 FROM expenses GROUP BY category',
);
console.table(byColumn);

console.log("\n=== ❌ GROUP BY 'category' （带引号 = 字符串常量）===");
// 🗄️ 注意：这里不能再 SELECT category 了，MySQL 会报 1055 —— 这本身就是铁证（见下文）
const [byConstant] = await pool.query(
  "SELECT COUNT(*) AS 行数, SUM(amount) AS 合计 FROM expenses GROUP BY 'category'",
);
console.table(byConstant);

console.log("\n=== ❌ GROUP BY ? （占位符传 'category'，结果跟上面一模一样）===");
const [byPlaceholder] = await pool.query(
  'SELECT COUNT(*) AS 行数, SUM(amount) AS 合计 FROM expenses GROUP BY ?',
  ['category'],
);
console.table(byPlaceholder);

console.log('\n=== 🗄️ 库里到底有什么（对账用）===');
const [all] = await pool.query('SELECT id, amount, category, note FROM expenses ORDER BY id');
console.table(all);

// ── ⭐ W12 D4 B6：deleted:true + group_by 的汇总文案必须声明"未计入统计" ───
//    修前汇总路文案长得跟真开销一模一样，模型会把已删账目的合计当真实开销报给用户
console.log('\n=== 🗄️ W12 D4 B6：已删除记录的分类汇总文案 ===');
const B6_NOTE = 'exp-groupby-b6';
await pool.query(
  "INSERT INTO expenses (amount, category, note, deleted_at) VALUES (12.34, '其他', ?, NOW())",
  [B6_NOTE],
);
const out = await queryExpenses('{"deleted":true,"group_by":"category"}');
console.log(out);
const okB6 = out.includes('已删除') && out.includes('未计入统计');
console.log(okB6 ? '✅ B6：汇总文案含"已删除"且声明"未计入统计"' : '🔴 B6 FAIL：汇总文案长得跟真开销一样');
// 🔬 对照组：不带 deleted 的汇总路文案不变（证明没把正常汇总改坏）
const outNormal = await queryExpenses('{"group_by":"category"}');
const okB6Ctrl = !outNormal.includes('已删除') && !outNormal.includes('未计入统计');
console.log(okB6Ctrl ? '✅ B6 对照组：正常汇总文案不变' : `🔴 B6 对照组 FAIL：正常汇总被改坏了 → ${outNormal.slice(0, 60)}`);
await pool.query('DELETE FROM expenses WHERE note = ?', [B6_NOTE]);

await pool.end();
