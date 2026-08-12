// 🗄️ 实验：把 'category' 换成任何一串字，结果完全一样 —— 证明它跟列名毫无关系
import { pool } from '../services/db.js';

for (const g of ["'category'", "'banana'", "'\u968f\u4fbf\u4e00\u4e32\u5b57'", '666']) {
  const [r] = await pool.query(
    `SELECT COUNT(*) AS \u884c\u6570, SUM(amount) AS \u5408\u8ba1 FROM expenses GROUP BY ${g}`,
  );
  console.log(`GROUP BY ${g}`.padEnd(24), '\u2192', JSON.stringify(r));
}

// 🗄️ 对照组：不带引号的列名，这才是真分组
const [real] = await pool.query(
  'SELECT category, COUNT(*) AS \u884c\u6570 FROM expenses GROUP BY category',
);
console.log('\nGROUP BY category (\u5217\u540d) \u2192', JSON.stringify(real));

await pool.end();
