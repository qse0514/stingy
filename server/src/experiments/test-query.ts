// 🗄️ 一次性实验脚本：绕过模型，直接调 queryExpenses（二分法：先确认厨房能做菜）
import { queryExpenses } from '../services/tools/queryExpenses.js';
import { pool } from '../services/db.js';

const cases: [string, string][] = [
  ['\u7a7a\u53c2\u6570\uff08\u9ed8\u8ba4 30 \u5929\u660e\u7ec6\uff09', '{}'],
  ['\u6309\u5206\u7c7b\u6c47\u603b', '{"group_by":"category"}'],
  ['\u53ea\u67e5\u9910\u996e', '{"category":"\u9910\u996e"}'],
  ['\u53ea\u67e5\u4eca\u5929', '{"days":1}'],
  ['\u2620\ufe0f \u975e\u6cd5\u5206\u7c7b\uff08\u767d\u540d\u5355\u8be5\u5ffd\u7565\u5b83\uff09', '{"category":"xyz"}'],
  ['\u2620\ufe0f \u6ce8\u5165 group_by\uff08\u767d\u540d\u5355\u8be5\u8d70\u660e\u7ec6\u8def\uff09', '{"group_by":"category); DROP TABLE expenses--"}'],
  ['\u2620\ufe0f days \u586b 99999\uff08\u5e94\u88ab\u5939\u5230 365\uff09', '{"days":99999}'],
  ['\u2620\ufe0f \u574f JSON', '{oops'],
];

for (const [name, args] of cases) {
  console.log(`\n\u2500\u2500\u2500 ${name}  args=${args}`);
  console.log(await queryExpenses(args));
}

await pool.end();
