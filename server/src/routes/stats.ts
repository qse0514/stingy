// 🗄️ 统计路由（W12 D4）：挂在 /api/stats 下（index.ts 里挂前缀）
import { Router } from 'express';
import { handleStatsSummary } from '../controllers/stats.js';

const router = Router();

router.get('/summary', handleStatsSummary); // 🗄️ 仪表盘一屏的全部数据

export default router;
