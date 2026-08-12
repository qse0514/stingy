// 🔵 TypeScript：导入共享类型
import type { Message } from '../types/chat';

import ReactMarkdown from 'react-markdown';
import ConfirmCard from './ConfirmCard'; // 🚦 HITL 卡片

// 🔵 Props 形状：这个组件只需要一条消息
interface MessageBubbleProps {
  message: Message;
  // 🚦 往下传给卡片的回调。自己不用，只是中转（道具层的常见职责）
  onDecide: (id: number, accept: boolean) => void;
}

// ⚛️ 长相层：一条消息。只管渲染，没有任何逻辑
// 🎨 ChatGPT 式双规格：user = 浅灰气泡靠右；assistant = 无气泡纯文字靠左
function MessageBubble({ message, onDecide }: MessageBubbleProps) {
  // 🚦 系统事件不是气泡：没有"说话的人"，所以居中、素一点（只给人看，不进库）
  if (message.role === 'system') {
    return (
      <div className="my-1 text-center text-xs text-gray-400">{message.content}</div>
    );
  }

  // 🎨 用户：浅灰圆角气泡，靠右，最多占七成宽（ChatGPT 的用户消息就是这个规格）
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-3xl bg-gray-100 px-4 py-2.5 text-gray-900 whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  // 🎨 AI：不穿气泡 —— 通栏纯文字，像 ChatGPT 的回答直接铺在页面上
  //    md 类：Markdown 基础排版在 index.css（preflight 把列表/代码块样式重置了）
  return (
    <div className="md text-gray-900 leading-7">
      {/* 🎨 流式还没吐出第一个字时，给一个呼吸的小圆点占位 */}
      {message.content === '' ? (
        <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-gray-400" />
      ) : (
        <ReactMarkdown>{message.content}</ReactMarkdown>
      )}

      {/* 🚦 带提案就渲染卡片。普通消息没有 pending 字段，这里自然什么都不渲 */}
      {message.pending?.map((item) => (
        <ConfirmCard
          key={item.id}
          item={item}
          status={message.pendingStatus?.[item.id] ?? 'pending'}
          onDecide={onDecide}
        />
      ))}
    </div>
  );
}

export default MessageBubble;
