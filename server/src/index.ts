import 'dotenv/config'
import express from 'express';
import cors from 'cors';
import chatRouter from './routes/chat.js'; // 🟢 ⚠️ 注意是 .js，待会儿解释
import conversationsRouter from './routes/conversations.js'; // 🗄️ 记忆层：会话三个接口
import statsRouter from './routes/stats.js'; // 🗄️ W12 D4：仪表盘统计（只读）


const app = express();

app.use(cors()); //允许跨域
app.use(express.json()); //解析JSON body

app.use('/api/chat', chatRouter); //api/chat 的请求全交给 chatRouter
app.use('/api/conversations', conversationsRouter); // 🗄️ 会话列表/新建/历史
app.use('/api/stats', statsRouter); // 🗄️ W12 D4：月度仪表盘

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Stingy server running on http://localhost:${PORT}`);
});







