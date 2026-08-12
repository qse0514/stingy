// 🔵 仪表盘数据的形状（后端 GET /api/stats/summary 寄来的样子，两边手写同步）
export interface StatsSummary {
    monthTotal: number      // 所选月总支出
    prevMonthTotal: number  // 所选月的上一个月（环比用，语义跟着 month 参数走）
    byCategory: { category: string; total: number; cnt: number }[]
    daily: { day: string; total: number }[]   // 所选月逐日（没记账的日子后端不给行，前端补零）
    budgets: { category: string; amount: number; spent: number }[]  // ⭐ 只有当前月才有内容，历史月恒为 []
    recent: { id: number; amount: number; category: string; note: string | null; day: string }[]  // 所选月全部流水
    isCurrentMonth: boolean // ⭐ 区分"历史月隐藏预算卡"和"当前月没设预算"（都是 budgets: []）
}
