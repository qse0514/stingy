// ⚛️ 会话侧栏：分段导航 + 列表 + 新对话按钮。纯展示组件，动作全部来自 props
// 🎨 ChatGPT 式深色侧栏：整条全高、黑底灰字，当前会话亮一档
import type { Conversation } from '../types/chat';

interface Props {
  conversations: Conversation[];
  currentId: number | null; // 🗄️ null = 正在写一个还没落库的新对话
  showingStats: boolean;    // 🎨 W12 D4：当前是不是在看报表（分段导航的选中态靠它）
  onSelect: (id: number) => void;
  onNew: () => void;
  onShowStats: () => void;  // 🎨 W12 D4：切到报表
  onShowChat: () => void;   // 🎨 ⭐ S1++：切回聊天视图，保持当前会话（不新建、不清空）
  onDelete: (id: number) => void; // 🗄️ ⭐ S1++：删会话（确认弹窗在本组件，真删在 hook）
}

export default function ConversationList({
  conversations, currentId, showingStats, onSelect, onNew, onShowStats, onShowChat, onDelete,
}: Props) {
  return (
    // 🎨 深色全高侧栏；列表区自己滚动（logo 只留主区顶栏那一个，这里不重复）
    <aside className="w-64 shrink-0 flex flex-col bg-zinc-950 text-zinc-300 p-3 pt-4">
      {/* 🎨 ⭐ S1++ 分段导航（方案 A）：对话/报表并列 tab —— 老的报表按钮混在列表里
          长得像一条聊天记录，现在它是和聊天平级的"区"，导航就该长成导航的样子 */}
      <div className="mb-3 flex rounded-lg bg-zinc-900 p-1 text-sm">
        <button
          onClick={onShowChat}
          className={`flex-1 rounded-md px-2 py-1.5 ${
            !showingStats ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          💬 对话
        </button>
        <button
          onClick={onShowStats}
          className={`flex-1 rounded-md px-2 py-1.5 ${
            showingStats ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          📊 报表
        </button>
      </div>

      {/* 🎨 ⭐ S1++ 看报表时下方整体调暗一档：强化"你已经离开聊天区了"
          ⚠️ min-h-0 不能丢：包了这层 div 后，内部列表的 overflow 滚动靠它才生效 */}
      <div className={`flex-1 min-h-0 flex flex-col ${showingStats ? 'opacity-50' : ''}`}>
        {/* 🎨 新对话：描边按钮，悬停亮一档 */}
        <button
          onClick={onNew}
          className="mb-3 flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800"
        >
          <span className="text-lg leading-none">＋</span> 新对话
        </button>

        <div className="px-2 pb-1 text-xs text-zinc-500">对话</div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-0.5">
          {conversations.map((c) => (
            // 🎨 ⭐ S1++：行改成 div 容器（button 不能嵌 button），选中钮 + × 钮并排
            //    group/group-hover：× 平时不占位，悬停这一行才现身
            <div
              key={c.id}
              className={`group flex items-center rounded-lg ${
                !showingStats && c.id === currentId ? 'bg-zinc-800' : 'hover:bg-zinc-900'
              }`}
            >
              <button
                onClick={() => onSelect(c.id)}
                // 🎨 当前会话：常亮的深灰底；其余悬停才亮（看报表时会话一律不亮）
                className={`flex-1 min-w-0 text-left text-sm px-3 py-2 truncate ${
                  !showingStats && c.id === currentId ? 'text-zinc-50' : 'text-zinc-300'
                }`}
                title={c.title}
              >
                {c.title}
              </button>
              {/* 🗄️ ⭐ S1++ 删会话：二次确认后才真删 —— 硬删无法恢复，confirm 是唯一的后悔药 */}
              <button
                onClick={(e) => {
                  e.stopPropagation(); // ⚛️ 别顺手触发"选中会话"
                  if (window.confirm('删除该对话？记录不可恢复')) onDelete(c.id);
                }}
                className="hidden group-hover:block shrink-0 px-2 py-2 text-zinc-500 hover:text-red-400"
                aria-label={`删除对话 ${c.title}`}
              >
                ×
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="px-3 pt-2 text-xs text-zinc-600">还没有对话，说句话就有了</p>
          )}
        </div>
      </div>
    </aside>
  );
}
