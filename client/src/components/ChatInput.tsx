// ⚛️ 输入框自己的临时状态，放在自己家里
import { useState } from 'react';

// 🔵 Props 形状：父组件只需要给一个"发送时干什么"的回调
interface ChatInputProps {
  onSend: (text: string) => void;
}

// ⚛️ 长相层：输入框+按钮。管自己的 input state，发送动作交给外面
// 🎨 ChatGPT 式：限宽居中的大圆角输入条，圆形发送按钮嵌在右侧，下面一行小字
function ChatInput({ onSend }: ChatInputProps) {
  const [input, setInput] = useState(''); // ⚛️ controlled input 的另一半

  const handleSend = () => {
    if (!input.trim()) return; // 🟡 空输入拦截
    onSend(input);             // ⚛️ 内容交给父组件，自己不管发生什么
    setInput('');              // ⚛️ 清空输入框
  };

  return (
    // 🎨 跟消息区同一条"阅读带"：限宽居中对齐；两侧和底部留呼吸空隙
    <div className="mx-auto w-full max-w-3xl px-6 pb-5">
      {/* 🎨 大圆角输入条：边框 + 轻阴影，按钮嵌在条内右侧 */}
      <div className="flex items-center gap-2 rounded-[28px] border border-gray-300 bg-white px-4 py-2 shadow-sm focus-within:border-gray-400">
        {/* 🌐 controlled input 三件套：value / onChange / onKeyDown */}
        <input
          className="flex-1 bg-transparent py-1.5 focus:outline-none placeholder:text-gray-400"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="跟 Stingy 聊聊你今天花了多少钱…"
        />
        {/* 🎨 圆形发送按钮：黑底白箭头；没内容时变灰（视觉上的"不可点"） */}
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          aria-label="发送"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black text-white hover:opacity-80 disabled:bg-gray-200 disabled:text-gray-400"
        >
          ↑
        </button>
      </div>
      {/* 🎨 ChatGPT 脚下那行免责小字 —— 我们这句还是真的 */}
      <p className="pt-2 text-center text-xs text-gray-400">
        Stingy 也可能记错账，大额收支请以确认卡片为准。
      </p>
    </div>
  );
}

export default ChatInput;
