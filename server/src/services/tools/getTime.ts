import type { ToolDef } from './types.js';

// 🟢 厨房：这个工具不碰数据库，不碰网络，就是问一下本机时间
function getTime(): string {
  return new Date().toLocaleString('zh-CN');
}

export const getTimeTool: ToolDef = {
  // 🤖 菜单：只有菜名和介绍，没有厨房——模型永远看不到上面那个函数
  spec: {
    type: 'function',
    function: {
      name: 'get_time',
      description: '获取当前的日期和时间',   // 🤖 模型靠这句话决定要不要申请它
      parameters: { type: 'object', properties: {} }, // 🤖 这个工具不需要原料
    },
  },
  run: getTime, // 🟢 不需要参数，直接把函数挂上来
};
