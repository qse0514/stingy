// 🟢 Node.js：Router = 一个迷你 app，专管一组路由
import { Router } from 'express';
import { handleChat, handleConfirm, handleReject } from '../controllers/chat.js'; // 🟢 又是 .js 规矩

const router = Router();

// 🟢 POST / —— 注意这里是 '/'，不是 '/api/chat'
// 因为 index.ts 里 app.use('/api/chat', chatRouter) 已经挂了前缀
router.post('/', handleChat);

// 🚦 HITL 两个出口：确认 / 拒绝。它们是普通 JSON 接口，不是 SSE
//    ⭐ 它们不经过 runAgent —— 这是整个 HITL 设计的关键点
router.post('/confirm', handleConfirm);
router.post('/reject', handleReject);

export default router;