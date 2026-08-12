// ⚛️ 逻辑层：仪表盘数据的拉取 + 月份切换（和 useChat 同一个分层规矩：组件不碰 fetch）
import { useEffect, useState } from 'react';
import type { StatsSummary } from '../types/stats';

// ⚛️ 'YYYY-MM' 的月份加减：借 Date 的进位（0 月自动变去年 12 月），不手搓跨年逻辑
function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y!, mo! - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ⚛️ 客户端的"当前月"：只用来定初始值和禁用右箭头（UI 层面）；
//    数据的诚实由服务端保证（isCurrentMonth 服务端自己判，不信这里）
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function useStats() {
  const [month, setMonth] = useState<string>(thisMonth()); // ⚛️ 'YYYY-MM'，初始 = 当前月
  const [stats, setStats] = useState<StatsSummary | null>(null); // null = 还在加载
  const [error, setError] = useState<string | null>(null);

  // ⚛️ 切月重新拉。挂载时跑第一次（month 初始值就是当前月）
  useEffect(() => {
    let alive = true; // ⚛️ 组件卸载后 setState 会白费还报警，用这个开关拦住
    // ⚛️ ⭐ 切月瞬间置回 null 走"加载中"—— 别让旧月数据挂在新月标题下面
    setStats(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/stats/summary?month=${month}`);
        if (!res.ok) throw new Error(`stats ${res.status}`); // 🟡 4xx/5xx 也要走 catch（fetch 不认它们是错）
        const data = (await res.json()) as StatsSummary;
        if (alive) setStats(data);
      } catch (err) {
        console.error('loadStats failed:', err); // 🟡 真相给日志
        if (alive) setError('统计加载失败，请稍后重试');
      }
    })();
    return () => { alive = false; };
  }, [month]);

  // ⚛️ 右箭头禁用条件：已经在当前月，不能看未来；左箭头不设下限（历史月没数据就全空，诚实显示）
  const atCurrentMonth = month === thisMonth();
  const prevMonth = () => setMonth((m) => shiftMonth(m, -1));
  const nextMonth = () => setMonth((m) => (m === thisMonth() ? m : shiftMonth(m, 1)));

  return { stats, error, month, atCurrentMonth, prevMonth, nextMonth };
}
