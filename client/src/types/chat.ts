// 🚦 加了 'system'：给【对话中途发生的系统事件】用
//    比如"用户点了确认" —— 那不是用户说的，也不是模型说的
export type Role = 'user' | 'assistant' | 'system'

// 🚦 HITL：一笔待用户确认的记账提案（后端 [CONFIRM] 暗号里寄过来的形状）
//    ⭐ 前端【只】拿着 id 去确认，金额分类是给人看的，不回寄给后端
export interface PendingExpense {
    id: number
    amount: number
    category: string
    note: string | null
    reason: string   // 🚦 为什么需要确认，直接显示给用户
}

// 🚦 一张提案卡片的当前状态：等待 → 确认中 → 已确认/已拒绝/出错
//    没它的话，用户点完按钮界面毫无反应，会以为没点上（然后再点一次）
export type PendingStatus = 'pending' | 'busy' | 'confirmed' | 'rejected' | 'error'

export interface Message {
    role: Role
    content: string
    // 🚦 选填：这条 AI 消息附带的待确认提案。普通消息没有这个字段
    pending?: PendingExpense[]
    // 🚦 每张提案各自的状态，按提案 id 索引
    pendingStatus?: Record<number, PendingStatus>
}

// 🗄️ 侧栏的一行会话（后端 GET /api/conversations 寄来的形状）
//    ⭐ 历史归后端管了：前端只拿着 id 去要，自己不再是历史的持有者
export interface Conversation {
    id: number
    title: string
    updatedAt: string
}
