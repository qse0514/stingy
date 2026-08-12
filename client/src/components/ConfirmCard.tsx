// 🚦 HITL 的 UI 出口：一张待确认提案卡片
//    ⭐ 纯展示组件 —— 它不知道 fetch、不知道后端、不知道提案是怎么来的
//       用户点了 → 调 props 里的函数，剩下的事跟它无关（跟 ChatInput 的 onSend 同一个套路）
import type { PendingExpense, PendingStatus } from '../types/chat';

interface ConfirmCardProps {
  item: PendingExpense;
  status: PendingStatus;
  // 🚦 accept=true 确认，false 拒绝。逻辑住在 useChat 里
  onDecide: (id: number, accept: boolean) => void;
}

function ConfirmCard({ item, status, onDecide }: ConfirmCardProps) {
  const busy = status === 'busy';
  const done = status === 'confirmed' || status === 'rejected';

  return (
    // 🎨 黄框：跟普通灰气泡区分开，一眼看出"这里要你动手"
    <div className="mt-2 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm">
      <div className="font-medium text-gray-900">
        {item.category} {item.amount.toFixed(2)} 元
        {item.note && <span className="text-gray-500">（{item.note}）</span>}
      </div>
      {/* 🚦 把"为什么要确认"直接摆给用户 —— 不解释理由的拦截会让人以为是 bug */}
      <div className="mt-1 text-xs text-amber-700">需要确认：{item.reason}</div>

      {done ? (
        // 🚦 终态：按钮撤掉，只留结论。留着按钮会让人以为还能再点
        <div className="mt-2 text-xs font-medium text-gray-600">
          {status === 'confirmed' ? '已记入' : '已放弃，未记账'}
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onDecide(item.id, true)}
            disabled={busy}          // 🚦 置忙就禁掉：防手抖双击（后端还有第二道）
            className="rounded-lg bg-blue-500 px-3 py-1 text-white disabled:opacity-50"
          >
            {busy ? '处理中…' : '确认记账'}
          </button>
          <button
            onClick={() => onDecide(item.id, false)}
            disabled={busy}
            className="rounded-lg bg-gray-200 px-3 py-1 text-gray-700 disabled:opacity-50"
          >
            不记
          </button>
          {status === 'error' && (
            <span className="self-center text-xs text-red-600">出错了，请重试</span>
          )}
        </div>
      )}
    </div>
  );
}

export default ConfirmCard;
