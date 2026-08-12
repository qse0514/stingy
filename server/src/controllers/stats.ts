// 🗄️ 统计接口的控制器（W12 D4 · S1+）：一个只读 GET，唯一的参数是 month
import type { Request, Response } from 'express';
import { getStatsSummary, currentMonth } from '../services/stats.js';

// 🟡 月份格式白名单：YYYY-MM，月份只认 01~12（'2026-13' 在这一步就挡回去）
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export const handleStatsSummary = async (req: Request, res: Response) => {
  try {
    // 🟡 缺省 = 当前月，由服务端算（别信客户端时钟）；给了就必须合法，不合法不猜
    const raw = req.query.month;
    let month: string;
    if (raw === undefined) {
      month = await currentMonth();
    } else if (typeof raw === 'string' && MONTH_RE.test(raw)) {
      month = raw;
    } else {
      return res.status(400).json({ error: 'month 参数格式应为 YYYY-MM' });
    }

    return res.json(await getStatsSummary(month));
  } catch (err) {
    console.error('stats summary failed:', err); // 🟢 真相给日志
    return res.status(500).json({ error: '统计暂时不可用，请稍后重试' }); // 🤖 给前端的白名单人话
  }
};
