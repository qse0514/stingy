import 'dotenv/config'; // 🟢 副作用导入：下面立即读 process.env，.env 必须先装进来
//    ⚠️ 不加这行也能跑 —— 因为 index.ts / db.ts 恰好先装了。但那是靠导入顺序撑着的运气，
//    实验脚本换一下 import 顺序就会拿到 undefined 的 key。每个读 env 的模块自己负责
import OpenAI from 'openai';

// 🤖 ⭐ 整个项目只有这一个 client，一个 API key
//    这个文件本身就是那条原则的证据：**Agent 数量 ≠ API 数量**
//    W12 的 4 个车队经理全部共用它 —— 区别只在各自的 system prompt 和 tools 清单
export const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});
