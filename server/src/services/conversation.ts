// 🗄️ 记忆层（Memory 中期）：对话的创建 / 列表 / 追加消息 / 重建历史
//    ⭐ 对话归后端管：前端从"历史的唯一持有者"降级为"显示器 + 遥控器"
//    ⭐ 这个文件是【给模型重看的记忆】的唯一入口 —— trace.ts 是给人看的案卷，两码事
import type OpenAI from 'openai';
import { pool } from './db.js';

// 🤖 每次请求重新喂给模型的历史上限（单位：条，不是轮）
//    ⚠️ 全量重发 = 行数就是钱（还记得吗：LLM 无状态，token 计费）
//    截断是【确定性】的：只按条数切 + 对齐到 user 边界，不搞"智能摘要"（那是概率性的）
const HISTORY_LIMIT = 30;

// 🔵 侧栏要显示的一行会话
export interface Conversation {
  id: number;
  title: string;
  updatedAt: string;
}

// 🔵 库里 messages 的一行（列名照 SQL 的样子）
interface MessageRow {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
}

// 🗄️ 新开一个会话。title 由调用方给（前端取首条消息前 20 字）
export async function createConversation(title: string): Promise<number> {
  const [res] = await pool.query(
    'INSERT INTO conversations (title) VALUES (?)',
    [title.slice(0, 50)], // 🗄️ 对齐 VARCHAR(50)，超长直接截，别让 INSERT 炸
  );
  return (res as { insertId: number }).insertId;
}

// 🗄️ 会话列表：最近说过话的排最上面
//    ⚠️ 排序补了 id DESC 兜底：DATETIME 只有秒级精度，同一秒建的两个会话分不出先后
export async function listConversations(): Promise<Conversation[]> {
  const [rows] = await pool.query(
    'SELECT id, title, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC, id DESC',
  );
  return rows as Conversation[];
}

// 🗄️ 会话存不存在：controller 校验用（不存在的 id 要还 404，不能默默建新的）
export async function conversationExists(id: number): Promise<boolean> {
  const [rows] = await pool.query('SELECT id FROM conversations WHERE id = ?', [id]);
  return (rows as unknown[]).length > 0;
}

// 🗄️ ⭐ W12 D4 S1++（backlog M4）：删会话 = 彻底遗忘，硬删不软删 ——
//    会话是【模型的记忆】不是账本：expenses 的软删规矩不适用，账本数据不受影响；
//    traces 按 trace_id 归档不引用会话，也不动
//    ⚠️ schema 没建外键，级联靠手动：先删 messages 再删 conversations，
//    顺序反了中途炸掉会留孤儿 messages —— 两条 DELETE 必须包进同一个事务
//    🚦 接受的尾巴：该会话里尚未处理的 pending 提案不追删，留给 24h TTL 自然失效
export async function deleteConversation(id: number): Promise<void> {
  // 🗄️ 事务必须同一个连接：pool.query 每次可能拿到不同连接，begin/commit 会对不上号
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM messages WHERE conversation_id = ?', [id]);
    await connection.query('DELETE FROM conversations WHERE id = ?', [id]);
    await connection.commit();
  } catch (err) {
    await connection.rollback(); // 🗄️ 半路炸了就整体回滚：要么全忘，要么全记得
    throw err;
  } finally {
    connection.release(); // 🗄️ 不还连接，池子迟早被借空
  }
}

// 🗄️ 追加一条消息 + bump updated_at（两件事永远一起发生，所以包成一个函数）
export async function appendMessage(
  conversationId: number,
  msg: { role: 'user' | 'assistant' | 'tool'; content: string | null; toolCalls?: string; toolCallId?: string },
): Promise<void> {
  await pool.query(
    'INSERT INTO messages (conversation_id, role, content, tool_calls, tool_call_id) VALUES (?, ?, ?, ?, ?)',
    [conversationId, msg.role, msg.content, msg.toolCalls ?? null, msg.toolCallId ?? null],
  );
  await pool.query('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);
}

// 🗄️ 给【前端】看的历史：只有 user/assistant 的正文
//    tool 回执和纯申请表行不给 —— 那是模型的记忆，不是人的聊天记录
export async function listDisplayMessages(
  conversationId: number,
): Promise<{ role: string; content: string }[]> {
  const [rows] = await pool.query(
    `SELECT role, content FROM messages
     WHERE conversation_id = ? AND role IN ('user','assistant')
       AND content IS NOT NULL AND content != ''
     ORDER BY id`,
    [conversationId],
  );
  return rows as { role: string; content: string }[];
}

// 🤖 ⭐ 给【模型】看的历史：按 OpenAI 消息合同原样重建（含申请表 + 工具回执）
//    这就是 #38 事故的根治 —— "已删除（#38）"下次会出现在它重看的记录里
export async function buildHistory(
  conversationId: number,
): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
  // 🗄️ 取【最近】30 条：子查询按 id DESC 切最近的，外层再翻回正序
  const [rows] = await pool.query(
    `SELECT * FROM (
       SELECT id, role, content, tool_calls, tool_call_id FROM messages
       WHERE conversation_id = ? ORDER BY id DESC LIMIT ${HISTORY_LIMIT}
     ) AS recent ORDER BY id`,
    [conversationId],
  );
  const list = rows as MessageRow[];

  // ⭐⭐ 截断对齐：从头丢弃，直到第一条是 user
  //    为什么：切最近 30 条可能把刀落在一轮工具调用的中间 ——
  //    历史若以"孤儿回执"开头（申请表被切掉了），API 直接报错；
  //    以"孤儿申请表"结尾同理。跟 traces 按整卷删是同一个道理：不能腰斩。
  //    对齐到 user 边界 = 一定站在某轮对话的开头，申请表和回执要么都在要么都不在
  while (list.length > 0 && list[0].role !== 'user') list.shift();

  // 🤖 逐行翻回 OpenAI 的消息形状
  return list.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
    if (m.role === 'tool') {
      // 🤖 回执行：tool_call_id 是它认领申请表的凭据，丢了 API 就对不上号
      return { role: 'tool', tool_call_id: m.tool_call_id ?? '', content: m.content ?? '' };
    }
    if (m.role === 'assistant' && m.tool_calls) {
      // 🤖 申请表行：JSON 原文在这一刻才 parse（存的时候原样存）
      return {
        role: 'assistant',
        content: m.content, // 通常是 null，模型交申请表时一般不带正文
        tool_calls: JSON.parse(m.tool_calls),
      };
    }
    return { role: m.role, content: m.content ?? '' };
  });
}
