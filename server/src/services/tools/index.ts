// 🟢 工具总台：登记所有工具 + 按名字派单 + 按权限发菜单
import { getTimeTool } from './getTime.js';
import { addExpenseTool } from './addExpense.js';
import { queryExpensesTool } from './queryExpenses.js';
import { updateExpenseTool } from './updateExpense.js';
import { deleteExpenseTool, restoreExpenseTool } from './deleteExpense.js';
import { setBudgetTool, queryBudgetTool } from './budget.js';
import type { ToolDef, ToolContext } from './types.js';

// 🟢 全部登记在这一个数组里。加新工具 = 新建一个文件 + 这里加一项，一处改动
//    （以前要改两处：tools 数组 和 executeTool 的 switch —— 少改一处就是个静默的 bug）
const ALL: ToolDef[] = [
  getTimeTool,
  addExpenseTool,
  queryExpensesTool,
  updateExpenseTool,     // 🗄️ W12 D1
  deleteExpenseTool,     // 🗄️ W12 D1（软删）
  restoreExpenseTool,    // 🗄️ W12 D1（让"可逆"变成一个真动作，而不只是 SQL 里的一种可能）
  setBudgetTool,         // 🗄️ W12 D4（预算：同分类 upsert）
  queryBudgetTool,       // 🗄️ W12 D4（预算使用情况，纯读）
];

// 🔵 合法工具名的联合类型，从上面的数组【手写同步】一份
//    ⚠️ 为什么不自动推导：推导出来是 string，拼错就编译不出错。写死才有白名单效果
export type ToolName =
  | 'get_time'
  | 'add_expense'
  | 'query_expenses'
  | 'update_expense'
  | 'delete_expense'
  | 'restore_expense'
  | 'set_budget'
  | 'query_budget';

// 🟢 名字 → 实现的索引表，用来派单
const byName = new Map(ALL.map((t) => [t.spec.function.name, t]));

// 🟢 ⭐ 权限隔离就是这个函数：一个 Agent 能拿到哪几张菜单，在这里决定
//    不给它某个工具 → 它的申请表上就永远没有这一项 → 它手上没有这把钥匙
//    （对比 system prompt 里写"请不要查账"—— 那是劝告，能被说服）
export function pickTools(...names: ToolName[]) {
  return names.map((n) => {
    const tool = byName.get(n);
    // 🔵 不用 ! 骗编译器：真取不到说明 ToolName 和 ALL 数组不同步了，那是我们自己的 bug。
    //    启动时直接炸，比运行时静静少给模型一个工具好得多
    if (!tool) throw new Error(`工具未登记: ${n}（ToolName 和 ALL 数组不同步）`);
    return tool.spec;
  });
}

// 🟢 派单员：按申请表上的名字找对应实现
export async function executeTool(name: string, args: string, ctx: ToolContext): Promise<string> {
  const tool = byName.get(name);
  // 🤖 Week 9 老规矩：模型也会填错表，不炸
  if (!tool) return `未知工具: ${name}`;
  return tool.run(args, ctx); // 🟢 run 可能是同步的，await 一个非 Promise 也没问题
}
