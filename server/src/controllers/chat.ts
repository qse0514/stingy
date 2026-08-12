import type { Request, Response } from 'express';
import { runAgent } from '../services/agent.js'; // 🤖 Agent 引擎（不知道具体人格）
import { stingy } from '../services/agents.js'; // 🤖 这次要跑哪个 Agent
import { startTrace } from '../services/trace.js'; // 🟢 案件编号在请求边界上发（顺手滚动清理旧案卷）
import { reconcile } from '../services/audit.js'; // 🔎 对账：模型说的 vs 案卷里发生的
import { listPendingByTrace, confirmPending, rejectPending } from '../services/pending.js'; // 🚦 HITL
// 🗄️ 记忆层：历史归后端管，前端只寄 conversationId + 新消息
import {
  createConversation,
  listConversations,
  listDisplayMessages,
  conversationExists,
  appendMessage,
  buildHistory,
  deleteConversation,
} from '../services/conversation.js';

// 🤖 错误白名单：认识的给一句人话（它们都是我们亲手写的，永远不泄露内部细节）
const ERROR_MESSAGES: Record<number, string> = {
  401: 'API 密钥无效，请检查配置',
  402: 'API 余额不足，请充值后重试',
  429: '请求太频繁，请稍后再试',
};

// 🟢 把 err 翻译成"能给用户看的一句话" —— 认不出来的统一模糊化
function toUserMessage(err: unknown): string {
  // 🔵 unknown 不能直接点属性：先收窄成"可能有 status 的对象"
  const status = (err as { status?: number })?.status;
  return (status && ERROR_MESSAGES[status]) || '服务暂时不可用，请稍后重试';
}

// 🗄️ 把 runAgent 攒的 transcript（申请表 + 工具回执）逐条落进记忆
//    ⭐ 抽成一个函数：成功路径和 catch 路径都要落它，逻辑只能有一份
async function persistTranscript(
  conversationId: number,
  transcript: Awaited<ReturnType<typeof runAgent>>['transcript'],
): Promise<void> {
  for (const m of transcript) {
    if (m.role === 'tool') {
      await appendMessage(conversationId, {
        role: 'tool',
        content: typeof m.content === 'string' ? m.content : '',
        toolCallId: 'tool_call_id' in m ? m.tool_call_id : undefined,
      });
    } else if (m.role === 'assistant') {
      await appendMessage(conversationId, {
        role: 'assistant',
        content: typeof m.content === 'string' ? m.content : null,
        // 🗄️ 申请表存 JSON 原文，重建时才 parse
        toolCalls: 'tool_calls' in m && m.tool_calls ? JSON.stringify(m.tool_calls) : undefined,
      });
    }
  }
}

export const handleChat = async (req: Request, res: Response) => {
  // 🌐 ⭐ W12 D1 新合同：{ conversationId, message } —— 历史不再由前端寄来
  //    旧合同（全量 messages）直接 400：前端可伪造的历史从此不再是入口
  const conversationId = Number(req.body?.conversationId);
  const message = req.body?.message;

  // 🟢 Week 9 validation：不信任输入
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ error: 'conversationId must be a positive integer' });
  }
  if (typeof message !== 'string' || message.trim() === '') {
    return res.status(400).json({ error: 'message must be a non-empty string' });
  }
  // 🗄️ 不存在的会话还 404，不默默新建 —— 新建是 POST /api/conversations 的职责，职责不串门
  if (!(await conversationExists(conversationId))) {
    return res.status(404).json({ error: `conversation ${conversationId} not found` });
  }

  // 🤖 ① SSE 三件套响应头：告诉浏览器"这是一条持续的流，别急着关"
  res.setHeader('Content-Type', 'text/event-stream'); // 🤖 SSE 的专属类型
  res.setHeader('Cache-Control', 'no-cache');         // 🤖 别缓存，每个字都要新鲜
  res.setHeader('Connection', 'keep-alive');          // 🟢 连接别断，我要连续发

  // 🟢 一次 HTTP 请求 = 一个案件：编号在这里发，往下传
  //    ⭐ startTrace 而不是 newTraceId —— 它每 20 次开卷会顺手清一次 traces 表
  const traceId = startTrace();
  console.log(`\n🧾 trace ${traceId}（会话 #${conversationId}）`);

  // 🗄️ transcript 提到 try 外：catch 里也要落它 —— 流式半路炸了，
  //    工具却可能已经真写了库；不落就又是一次 #38（干了事但失忆）
  let transcript: Awaited<ReturnType<typeof runAgent>>['transcript'] | null = null;

  try {
    // 🗄️ ⭐ 顺序敏感：先落库 user 消息，再重建历史 ——
    //    buildHistory 要以 user 消息开头/结尾，先存才能被它读到；
    //    而且就算下面全挂了，用户说过的话也不丢
    //    ⭐ W12 D4 I2：挪进 try —— SSE 头已经设了，这句在 try 外炸时 Express 5
    //    只能兜出一个穿 SSE 衣服的 500，前端拆不出任何信封；进 try 走 [ERROR] 通道
    await appendMessage(conversationId, { role: 'user', content: message });

    // 🗄️ ⭐ 记忆就位：从库里重建完整历史（含上次的申请表和工具回执）
    const history = await buildHistory(conversationId);

    // 🤖 拿到水管。⭐ 第一个参数 = "让谁去干"，W12 换成其他 Agent 就是换这一个词
    const result = await runAgent(stingy, history, traceId);
    transcript = result.transcript;

    // 🔎 对账的原料之一：流是一块块吐的，得有人在出口把它攒成整句话
    let fullText = '';

    // 🤖 ② for await...of：水管每流出一块就处理一块
    for await (const chunk of result.stream) {
      const text = chunk.choices[0]?.delta?.content ?? ''; // 🤖 抠出这一小块文字
      if (text) {
        fullText += text; // 🔎 转发的同时留一份副本
        // 🤖 ③ SSE 固定格式：data: 内容\n\n（两个换行是"一条消息结束"的信号）
        res.write(`data: ${JSON.stringify(text)}\n\n`);
      }
    }

    // 🗄️ ⭐ 流完了才落记忆：申请表 + 回执 + 最终那段人话（fullText）
    //    草稿和 reflect 纠正指令都不在其中 —— 用户真看到的那段才是历史
    await persistTranscript(conversationId, transcript);
    transcript = null; // 🗄️ 落完了，catch 里不用再落一遍
    if (fullText) await appendMessage(conversationId, { role: 'assistant', content: fullText });

    // 🚦 ⭐ 流完了但还没 end：把本次产生的待确认提案一并寄出去
    //    靠 traceId 去查，所以不需要工具→controller 的任何额外传递机制
    const pending = await listPendingByTrace(traceId);
    if (pending.length > 0) {
      // 🌐 新暗号：[CONFIRM] 后面跟一个 JSON 数组（跟 [ERROR] 同一个套路）
      res.write(`data: [CONFIRM] ${JSON.stringify(pending)}\n\n`);
      console.log(`🚦 待确认提案 ${pending.length} 笔：`, pending.map((p) => `#${p.id} ${p.amount}`).join(', '));
    }

    res.write('data: [DONE]\n\n'); // 🤖 ④ 自定义结束标志，前端见到就收工
    res.end();                     // 🟢 关闭连接

    // 🔎 ⭐ 对账放在 res.end() 【之后】：它是监督者，不是守门员
    //    它慢、它挂、它判错，用户都已经拿到回复了 —— 横切层不得影响业务流
    await reconcile(traceId, fullText);
  } catch (err) {
    // 🟢 错误也盖上案件编号：堆栈和案卷从此能对上
    console.error(`LLM error [trace ${traceId}]:`, err); // 🟢 真相给日志，只有我们看
    // 🗄️ ⭐ 工具回执是【已发生的事实】：流式那轮炸了，删账可能已经删了。
    //    不落记忆 = 下一轮它不知道自己干过 —— 又是一次 #38。部分正文不落（没说完的话不算数）
    if (transcript) await persistTranscript(conversationId, transcript);
    // 🤖 寄给前端的只能是白名单里的文案（前端是个大喇叭，DevTools 里人人可见）
    res.write(`data: [ERROR] ${toUserMessage(err)}\n\n`);
    res.end();
  }
};

// 🗄️ 新建会话：前端首次发送时才调（避免空会话堆积）
export const handleCreateConversation = async (req: Request, res: Response) => {
  const title = req.body?.title;
  if (typeof title !== 'string' || title.trim() === '') {
    return res.status(400).json({ error: 'title must be a non-empty string' });
  }
  const id = await createConversation(title.trim());
  return res.json({ id });
};

// 🗄️ 会话列表：侧栏用，最近说过话的排最上面
export const handleListConversations = async (_req: Request, res: Response) => {
  return res.json(await listConversations());
};

// 🗄️ 单个会话的展示历史：只有 user/assistant 正文（tool 回执是模型的记忆，不是人的聊天记录）
export const handleGetMessages = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  if (!(await conversationExists(id))) {
    return res.status(404).json({ error: `conversation ${id} not found` });
  }
  return res.json(await listDisplayMessages(id));
};

// 🗄️ ⭐ W12 D4 S1++：删会话（硬删，事务在 service 里）
//    和现有接口同一个立场：非法 id 还 400，不存在还 404 —— 不存在的删除不能默默成功
export const handleDeleteConversation = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  if (!(await conversationExists(id))) {
    return res.status(404).json({ error: `conversation ${id} not found` });
  }
  try {
    await deleteConversation(id);
    console.log(`🗑️ 会话 #${id} 已删除（含全部消息）`);
    return res.status(204).end(); // 🌐 204：删成了，没有正文可返
  } catch (err) {
    console.error(`deleteConversation #${id} failed:`, err); // 🟢 真相给日志
    return res.status(500).json({ error: '删除失败，请稍后重试' }); // 🤖 给前端的白名单人话
  }
};

// 🚦 ⭐ HITL 的人类那一下：用户点“确认”落在这里
//    注意这个函数里【一个 LLM 调用也没有】—— 模型不在这条路径上，
//    也就没有“再被说服一次”的机会。提案里的数字在创建时就冻住了
export const handleConfirm = async (req: Request, res: Response) => {
  // 🟢 不信任输入：前端只能寄一个 id 过来，任何金额/分类一律不收
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const result = await confirmPending(id);
  if (!result.ok) {
    // 🚦 409 Conflict：不是参数错，是"这个提案已经不在可确认状态了"
    return res.status(409).json({ error: result.reason });
  }
  console.log(`✅ 提案 #${id} 已确认 → expenses #${result.expenseId}`);
  return res.json(result);
};

// 🚦 拒绝：同样只收 id。拒也要留痕 —— rejected 堆积是个可监控信号
export const handleReject = async (req: Request, res: Response) => {
  const id = Number(req.body?.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }
  const result = await rejectPending(id);
  if (!result.ok) return res.status(409).json({ error: result.reason });
  console.log(`❌ 提案 #${id} 已拒绝`);
  return res.json(result);
};