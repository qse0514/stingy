// 🟢 会话路由：记忆层的普通 JSON 接口（不是 SSE）
//    挂在 /api/conversations 下（index.ts 里挂前缀）
import { Router } from 'express';
import {
  handleCreateConversation,
  handleListConversations,
  handleGetMessages,
  handleDeleteConversation,
} from '../controllers/chat.js';

const router = Router();

router.get('/', handleListConversations);        // 🗄️ 侧栏列表
router.post('/', handleCreateConversation);      // 🗄️ 新建（前端首次发送时才调）
router.get('/:id/messages', handleGetMessages);  // 🗄️ 单个会话的展示历史
router.delete('/:id', handleDeleteConversation); // 🗄️ ⭐ W12 D4 S1++：硬删会话（彻底遗忘）

export default router;
