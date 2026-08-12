// ⚛️ 组装层：不写逻辑、不写具体 UI，只把零件拼起来
import { useState } from 'react';
import { useChat } from './hooks/useChat';
import ChatWindow from './components/ChatWindow';
import ChatInput from './components/ChatInput';
import ConversationList from './components/ConversationList';
import StatsPanel from './components/StatsPanel';

// 🎨 W12 D4：主区两个视图 —— 聊天 / 月度仪表盘。就两个值，不上路由库
type View = 'chat' | 'stats';

function App() {
  // ⚛️ 逻辑全部来自 hook：App 不知道 fetch/SSE 的存在
  const {
    messages,
    sendMessage,
    decidePending,
    conversations,
    conversationId,
    selectConversation,
    newConversation,
    deleteConversation,
  } = useChat();

  // 🎨 当前视图：选会话/新对话自动切回聊天（用户的意图很明确：他要说话了）
  const [view, setView] = useState<View>('chat');

  return (
    // 🎨 ChatGPT 式两栏：通栏铺满整个屏幕，不再限宽居中
    <div className="flex h-screen bg-white">
      <ConversationList
        conversations={conversations}
        currentId={conversationId}
        showingStats={view === 'stats'}
        onSelect={(id) => { setView('chat'); void selectConversation(id); }}
        onNew={() => { setView('chat'); newConversation(); }}
        onShowStats={() => setView('stats')}
        onShowChat={() => setView('chat')} // 🎨 ⭐ S1++ 分段导航：切回聊天但保持当前会话
        onDelete={(id) => void deleteConversation(id)} // 🗄️ ⭐ S1++：确认弹窗在侧栏，真删在 hook
      />

      {/* 🎨 主区：竖排 = 顶栏 / 视图区(占满)。聊天视图才有输入条 */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* 🎨 细顶栏：全局唯一的 logo 位（侧栏那个删了，不搞双 logo） */}
        <header className="flex items-center px-6 h-14 shrink-0">
          <span className="text-base font-semibold text-gray-800">Stingy</span>
          <span className="ml-2 text-xs text-gray-400">{view === 'stats' ? '报表' : '抠门记账助手'}</span>
        </header>

        {view === 'stats' ? (
          <StatsPanel />
        ) : (
          <>
            <ChatWindow messages={messages} onDecide={decidePending} />
            <ChatInput onSend={sendMessage} />
          </>
        )}
      </div>
    </div>
  );
}

export default App;
