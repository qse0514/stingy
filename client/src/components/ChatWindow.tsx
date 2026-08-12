// 🔵 TypeScript：导入共享类型
import type { Message } from '../types/chat';
// ⚛️ 组合：列表由一个个气泡组成
import MessageBubble from './MessageBubble';

import { useRef, useEffect } from 'react';

// 🔵 Props 形状：列表需要整个数组
interface ChatWindowProps {
  messages: Message[];
  // 🚦 继续往下传：列表自己不用它（道具层只传不用）
  onDecide: (id: number, accept: boolean) => void;
}

// ⚛️ 长相层：气泡列表。只管 map 渲染，不管数据从哪来
function ChatWindow({ messages, onDecide }: ChatWindowProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, [messages]);

  // 🎨 ChatGPT 式空状态：没消息时中央一句问候，不是一片死白
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-2xl font-medium text-gray-700">今天花钱了吗？</p>
      </div>
    );
  }

  return (
    // 🎨 外层通栏负责滚动；内层限宽居中成一列（ChatGPT 的"中间那条阅读带"）
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-8 space-y-6">
        {messages.map((msg, index) => (
          // ⚛️ key 先用 index 跑通
          <MessageBubble key={index} message={msg} onDecide={onDecide} />
        ))}
        {/* ⚛️ 锚点。空 div 站在队伍最后，身份证贴它身上 */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default ChatWindow;
