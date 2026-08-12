// 🤖 独立实验脚本：Tool Calling 完整循环（Agent Loop 版，不走 Express）
// 🤖 跑法：server 目录下 npx tsx src/test-tools.ts
import 'dotenv/config'; // 🟢 side effect import（昨天刚毕业的那位）
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

// 🤖 ① 工具菜单：只有菜名和介绍，没有厨房——模型永远看不到实现
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_time',
      description: '获取当前的日期和时间', // 🤖 模型靠这句话决定要不要申请它
      parameters: { type: 'object', properties: {} }, // 🤖 这个工具不需要原料
    },
  },
];

// 🟢 ② 厨房：工具的真正实现，普通函数而已，在【我们后端】执行
function getTime(): string {
  return new Date().toLocaleString('zh-CN');
}

// 🟢 ③ 派单员：按申请表上的名字找对应实现
function executeTool(name: string, args: string): string {
  switch (name) {
    case 'get_time':
      return getTime();
    default:
      // 🤖 Week 9 老规矩"不信任输入"：模型也可能填错表（编造工具名）
      return `未知工具: ${name}`;
  }
}

const MAX_ROUNDS = 6; // 🤖 保险丝：防模型无限申请工具——每轮都是真金白银的 token

async function main() {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    // 🔬 对照实验：加上生产环境的 system prompt，看工具还调不调
    { role: 'system', content: '你是 Stingy，一个精打细算的记账助手。用简短、口语化的中文回复。' },
    { role: 'user', content: '现在几点了？' },
  ];

  // 🤖 ④ Agent Loop：Thought → Action → Observation，直到模型说人话为止
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const res = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages, // 🤖 全量历史：失忆症患者每轮重看全部记录（含申请表和回执）
      tools,    // 🤖 菜单每轮都递——它连"自己有哪些工具"也记不住
    });

    const reply = res.choices[0].message;
    messages.push(reply); // 🤖 模型的话（含申请表）原样进历史，少一句它就懵

    // 🤖 ⑤ 循环出口：没有申请表 = 模型吐人话了，收工
    if (!reply.tool_calls) {
      console.log(`✅ 第${round}轮 · 最终回答: ${reply.content}`);
      return;
    }

    // 🤖 ⑥ 有申请表：逐张执行（模型一轮可以同时申请多个工具）
    for (const call of reply.tool_calls) {
      if (call.type !== 'function') continue; // 🔵 类型收窄：目前只有 function 一种
      console.log(`🔧 第${round}轮 · 申请表: ${call.function.name}(${call.function.arguments})`);

      const result = executeTool(call.function.name, call.function.arguments);
      console.log(`📬 执行结果: ${result}`);

      messages.push({
        role: 'tool',          // 🤖 第四种 role：工具回执
        tool_call_id: call.id, // 🤖 回执对应哪张申请表（一轮多张时靠它配对）
        content: result,
      });
    }
    // 🟢 不 return：回到 for 顶部，带着回执再问一轮
  }

  console.log('⚠️ 达到轮数上限，保险丝熔断'); // 🤖 Harness 的责任：兜底
}

main();
