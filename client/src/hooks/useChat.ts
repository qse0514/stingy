// ⚛️ 逻辑层：Chat 的全部"脏活"都住这里（state、fetch/读流/拆信封、会话管理）
import { useEffect, useRef, useState } from 'react';
// 🔵 共享类型
import type { Conversation, Message, PendingExpense, PendingStatus } from '../types/chat';

// 🌐 空闲超时上限：不报错也不断连、就是不吐字的情况，靠它兜底
//    ⭐ W12 D4 B5：语义是"30 秒没吐任何字才算死"，不是"30 秒内必须干完"——
//    Agent Loop 最多 5 轮非流式 + 工具 + 流式轮，一次"查账再改两笔"完全可能超 30 秒；
//    总超时到点 abort 后【后端不知情照常干完并落记忆】，用户以为失败重发 → 重复记账
const TIMEOUT_MS = 30_000;

// ⚛️ 工具：把新文字拼到最后一条消息的 content 尾巴（返回全新数组！）
function appendToLast(prev: Message[], text: string): Message[] {
  return prev.map((msg, i) =>
    i === prev.length - 1 ? { ...msg, content: msg.content + text } : msg
  );
}

// ⚛️ 工具：把最后一条消息的 content 整个替换（错误提示用）
function updateLast(prev: Message[], text: string): Message[] {
  return prev.map((msg, i) =>
    i === prev.length - 1 ? { ...msg, content: text } : msg
  );
}

// 🚦 工具：把待确认提案挂到最后一条消息上，并给每张卡片初始状态
function attachPending(prev: Message[], list: PendingExpense[]): Message[] {
  const status: Record<number, PendingStatus> = {};
  for (const p of list) status[p.id] = 'pending';
  return prev.map((msg, i) =>
    i === prev.length - 1 ? { ...msg, pending: list, pendingStatus: status } : msg
  );
}

// ⚛️ 自定义 Hook：命名必须 use 开头，React 的规矩
export function useChat() {
  // ⚛️ 当前窗口的消息 —— ⭐ 现在只是【显示用的副本】，真身在后端库里
  const [messages, setMessages] = useState<Message[]>([]);
  // 🗄️ 当前会话 id。null = 新对话还没落库（首次发送时才创建，避免空会话堆积）
  const [conversationId, setConversationId] = useState<number | null>(null);
  // 🗄️ 侧栏列表
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // ⚛️ useRef 是盒子：装"当前请求的遥控器"。重渲染不丢，改它也不触发渲染
  const ctrlRef = useRef<AbortController | null>(null);

  // 🗄️ 拉会话列表（挂载时 + 每次发完消息后刷新，排序和标题都交给后端）
  const loadConversations = async () => {
    try {
      const res = await fetch('/api/conversations');
      if (res.ok) setConversations(await res.json());
    } catch (err) {
      console.error('loadConversations failed:', err); // 🟡 侧栏加载失败不阻断聊天
    }
  };

  // ⚛️ 挂载时拉一次。依赖数组空 = 只跑一次（不是每次渲染都拉）
  useEffect(() => {
    void loadConversations();
  }, []);

  // 🗄️ 切到另一个会话：先中断正在流的旧请求，再从后端拉它的历史覆盖屏幕
  const selectConversation = async (id: number) => {
    ctrlRef.current?.abort(); // ⚠️ 不中断的话，旧会话的打字机会继续往新屏幕上吐字
    setConversationId(id);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (!res.ok) {
        setMessages([{ role: 'system', content: '⚠️ 加载历史失败，请重试' }]);
        return;
      }
      // 🗄️ 后端只寄 user/assistant 正文 —— tool 回执是模型的记忆，不是人的聊天记录
      const rows = (await res.json()) as { role: string; content: string }[];
      setMessages(rows.map((r) => ({ role: r.role as Message['role'], content: r.content })));
    } catch (err) {
      console.error('selectConversation failed:', err);
      setMessages([{ role: 'system', content: '⚠️ 加载历史失败，请重试' }]);
    }
  };

  // 🗄️ 新对话：只清本地屏幕。⭐ 不先 POST 建会话 —— 首次发送时才建，空会话不落库
  const newConversation = () => {
    ctrlRef.current?.abort();
    setConversationId(null);
    setMessages([]);
  };

  // 🗄️ ⭐ W12 D4 S1++：删会话（后端硬删 = 彻底遗忘，确认弹窗在 ConversationList 里）
  const deleteConversation = async (id: number) => {
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`delete conversation failed: ${res.status}`);
      // ⚠️ 删的正是当前会话 → 它的流可能还在吐字，先断流再清屏回新对话（复用 newConversation）
      if (id === conversationId) newConversation();
      void loadConversations(); // 🗄️ 刷侧栏：那一行该消失了
    } catch (err) {
      // 🟡 失败不动 UI：侧栏那行还在，用户可以重试
      console.error('deleteConversation failed:', err);
    }
  };

  // 🚦 改某一张提案的状态。提案 id 全局唯一，所以不用关心它在第几条消息上
  //    ⚠️ 只改带有这张提案的那条消息，其余消息原封不动（React 要新引用才重渲染）
  const setPendingStatus = (id: number, status: PendingStatus) => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.pendingStatus && id in msg.pendingStatus
          ? { ...msg, pendingStatus: { ...msg.pendingStatus, [id]: status } }
          : msg
      )
    );
  };

  // ⚛️ 发送一条用户消息（✅ async：里面有 await）
  const sendMessage = async (text: string) => {
    // 🌐 新请求来了：先取消上一个还在跑的流，否则两个打字机抢同一个气泡
    ctrlRef.current?.abort();

    const ctrl = new AbortController(); // 🌐 本轮的遥控器：signal 是线，abort() 是按钮
    ctrlRef.current = ctrl;

    let timedOut = false; // 🟡 区分中断原因：超时自动取消 vs 用户发了新消息
    // 🟡 定时按按钮 = 超时（认出来了吗？这就是 MAX_ROUNDS 换了个维度）
    //    ⭐ W12 D4 B5：改成【空闲超时】—— 读流循环里每收到一块就重置倒计时，
    //    只有连续 30 秒一个字都没吐才 abort（长 Agent Loop 不再被误杀）
    const onIdleTimeout = () => {
      timedOut = true;
      ctrl.abort();
    };
    let timer = setTimeout(onIdleTimeout, TIMEOUT_MS);
    const resetIdleTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdleTimeout, TIMEOUT_MS);
    };

    // ⚛️ 上屏：用户气泡 + 空 AI 气泡提前挂好 ——
    //    从此刻起"最后一条永远是 AI 气泡"，所有错误都能统一 updateLast
    //    ⭐ 不再需要"一鱼两吃"了：历史归后端，寄出去的只有新的这一句
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '' }]);

    try {
      // 🗄️ ⭐ 首次发送才创建会话：标题 = 第一句话前 20 字
      let cid = conversationId;
      if (cid == null) {
        const created = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 20) }),
          signal: ctrl.signal,
        });
        if (!created.ok) throw new Error(`create conversation failed: ${created.status}`);
        cid = ((await created.json()) as { id: number }).id;
        setConversationId(cid);
      }

      // 🌐 ⭐ 新合同：只寄会话 id + 新消息。历史由后端从库里重建（含工具回执），
      //    前端从此伪造不了历史；老的 filter(system) 也不需要了 —— system 根本不进库
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: cid, message: text }),
        signal: ctrl.signal, // 🌐 把线插进 fetch，否则按钮按了也无效
      });

      // 🌐 ⭐ W12 D4 B4：先查 res.ok —— 后端 4xx/5xx 回的是 JSON 不是 SSE 流，
      //    照常读流一封信也拆不出来，循环安静结束 → 空 AI 气泡永远空着、零提示
      if (!res.ok) {
        setMessages((prev) =>
          updateLast(prev, res.status === 404 ? '⚠️ 会话不存在，请新建对话' : '⚠️ 请求失败，请重试'),
        );
        return;
      }

      // 🌐 ④ 正经检查：body 的类型是 ReadableStream | null，非空断言 ! 换成兜底
      if (!res.body) {
        console.error('No response body'); // 🟡 给开发者的：查案用
        setMessages((prev) => updateLast(prev, '⚠️ 连接异常，请重试'));
        return;
      }
      const reader = res.body.getReader(); // ✅ 过了检查，! 摘掉了
      const decoder = new TextDecoder(); // 🟡 字节 → 文字，建一次循环外复用

      let buffer = ''; // 🟡 攒信封的缓冲区：网络分块不按信封边界切，半个信封先攒着

      // 🤖 ⑤ 泵水循环：每按一次 read() 出一桶
      while (true) {
        const { done, value } = await reader.read();
        if (done) break; // 🤖 井干了（后端 res.end() 了）

        resetIdleTimer(); // 🟡 ⭐ W12 D4 B5：收到数据 = 后端还活着，倒计时重新上发条

        // 🟡 stream:true：跨块的中文字节先攒手里，凑齐再吐，防乱码
        buffer += decoder.decode(value, { stream: true });

        // 🟡 ⑥ 拆信封：\n\n 是 SSE 的"一封信结束"信号
        const lines = buffer.split('\n\n');
        buffer = lines.pop()!; // 🟡 最后一段可能是半封信，塞回缓冲区等下一轮

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue; // 🤖 不是 SSE 信封，跳过
          const data = line.slice(6);               // 🟡 撕掉 'data: ' 前缀（6个字符）

          if (data === '[DONE]') break;             // 🤖 暗号：正常结束
          // 🤖 暗号升级：现在后面跟着详情，所以不能再用 === ，得用 startsWith
          if (data.startsWith('[ERROR]')) {
            const detail = data.slice('[ERROR]'.length).trim(); // 🟡 抠出后端给的人话
            setMessages((prev) => updateLast(prev, `⚠️ ${detail || '出错了，请重试'}`));
            break;
          }

          // 🚦 第三个暗号：待确认提案。后面跟的是一个 JSON 数组
          //    ⚠️ 必须在下面那句 JSON.parse(data) 之前拦住 —— 它不是一段正文
          if (data.startsWith('[CONFIRM]')) {
            const list: PendingExpense[] = JSON.parse(data.slice('[CONFIRM]'.length).trim());
            setMessages((prev) => attachPending(prev, list));
            continue;                              // 🟡 处理完这封信，接着看下一封
          }

          const text = JSON.parse(data); // 🟡 后端 JSON.stringify 过，这里解回来

          // ⚛️ ⑦ 打字机本体：把新文字拼到最后一个气泡尾巴上
          setMessages((prev) => appendToLast(prev, text));
        }
      }
    } catch (err) {
      // 🌐 AbortError 不是"故障"，是我们亲手按的按钮
      if (err instanceof DOMException && err.name === 'AbortError') {
        // 🟡 超时中断：要告知用户。用户发新消息导致的中断：闷声退场，别污染新气泡
        if (timedOut) setMessages((prev) => updateLast(prev, '⚠️ 响应超时，请重试'));
      } else {
        console.error('sendMessage failed:', err); // 🟡 真相给日志
        setMessages((prev) => updateLast(prev, '⚠️ 网络异常，请检查连接后重试'));
      }
    } finally {
      clearTimeout(timer); // 🟡 拆炸弹：不拆的话 30 秒后会中断下一轮的流
      // 🗄️ 刷新侧栏：新会话的标题刚落库 / 排序可能变了（updated_at 是后端 bump 的）
      void loadConversations();
    }
  };

  // 🚦 ⭐ HITL 的人类那一下：确认或拒绝一张提案
  //    寄出去的只有 id，金额一律不寄 —— 数字存在后端提案里，前端改不动它
  const decidePending = async (id: number, accept: boolean) => {
    // ⚛️ 先置忙：按钮立即禁掉，否则用户以为没点上又点一下
    //    （后端那句 compare-and-set 也能兜住，但不能把干净的 UI 交给兜底层）
    setPendingStatus(id, 'busy');
    try {
      const res = await fetch(accept ? '/api/chat/confirm' : '/api/chat/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      // 🌐 409 = 后端说“这张已经不在可处理状态了”，也算终态，不要退回 pending
      //    ⭐ W12 D4 I1：但不能不分原因直接按【我点的方向】标终态 —— 409 也可能是
      //    "已过期"或"被处理成相反状态"（双端同时点）。读后端 reason 展示真实终态：
      //    reason 长得像"提案已处理（confirmed|rejected）"，其余（过期/不存在/写库失败）落 error
      if (!res.ok) {
        if (res.status === 409) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          const reason = body?.error ?? '';
          setPendingStatus(
            id,
            reason.includes('confirmed') ? 'confirmed' : reason.includes('rejected') ? 'rejected' : 'error',
          );
        } else {
          setPendingStatus(id, 'error');
        }
        return;
      }

      // 🚦 把“人做了什么决定”写一条回执到聊天记录里
      //    ⚠️ 只给人看！不寄给模型（上面那句 filter 会把它滤掉）
      //    一开始我以为寄过去就能让模型知道，实测它被防注入规则拦掉了。
      //    ⭐ 模型要知道真相，靠它自己查库 —— 对话里的说法本来就不应该被信
      const info = (await res.json()) as { amount: number; category: string; note: string | null };
      const label = `${info.category} ${info.amount.toFixed(2)} 元${info.note ? `（${info.note}）` : ''}`;
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: accept
            ? `已确认记入：${label}（提案 #${id}）`
            : `已放弃，未记账：${label}（提案 #${id}）`,
        },
      ]);

      setPendingStatus(id, accept ? 'confirmed' : 'rejected');
    } catch (err) {
      console.error('decidePending failed:', err);
      setPendingStatus(id, 'error');
    }
  };

  // ⚛️ 只把"数据"和"动作"交出去，内部细节全部藏住
  return {
    messages,
    sendMessage,
    decidePending,
    conversations,
    conversationId,
    selectConversation,
    newConversation,
    deleteConversation,
  };
}
