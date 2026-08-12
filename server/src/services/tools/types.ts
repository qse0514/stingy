import type OpenAI from 'openai';

// 🔵 ⭐ 工具运行时的上下文：工具本身不知道自己被谁、在什么情况下调用，这里补给它
//    加它的直接原因：addExpense 建提案时要写 trace_id，而它只拿得到 args 字符串
export interface ToolContext {
  traceId: string; // 🔎 本次请求的案件编号
  agent: string;   // 🤖 哪个 Agent 在调
  seq: number;     // 🚦 本次请求中，这是第几次调用【这一个】工具（分多轮灌数据的计数）
  batch: number;   // 🚦 模型这一轮一共交了几张申请表（一轮灌一叠的计数）
}

// 🔵 一个工具 = 菜单 + 厨房，装在同一个对象里
//    ⭐ 这个绑定是刻意的：注册的时候两个一起进来，不可能只注册一半
//       （D1 踩过的坑：改了实现忘了改 description，模型还按旧说明书申请）
export interface ToolDef {
  // 🤖 菜单：递给模型看的声明。用 ChatCompletionFunctionTool（窄类型，带 .function.name）
  //    而不是 ChatCompletionTool（联合类型，还包含 custom tool，取不到 .function）
  spec: OpenAI.Chat.ChatCompletionFunctionTool;
  // 🟢 厨房：真实现，在我们后端执行。参数永远是模型给的 JSON 字符串（不是对象）
  //    🔵 不需要 ctx 的工具（比如 getTime）照样能赋值进来 —— 少收几个参数是合法的
  run: (args: string, ctx: ToolContext) => Promise<string> | string;
}
