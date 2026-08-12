// 🗄️ 数据库连接池：Week 7 老本行，整个 server 共用这一个池子
import 'dotenv/config'; // 🟢 副作用导入！下面 createPool 立即读 process.env，.env 必须先装进来
import mysql from 'mysql2/promise'; // 🟢 /promise 版本才能用 async/await

// 🗄️ 池子 vs 单连接：池子预开几条线路循环复用，省掉每次请求的握手开销
export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10, // 🗄️ 最多同时 10 条线路，用完排队等
});

// 🔬 自测入口：npx tsx src/services/db.ts —— 先证明 DB 通了，再往工具里接
// 🟢 import.meta.url 判断"是否被直接执行"（ESM 版的 __main__）
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const [rows] = await pool.query('SELECT COUNT(*) AS n FROM expenses');
  console.log('✅ 数据库连通，expenses 表现有记录数:', rows);
  await pool.end();
}
