// 🟢 观测层（Observability）：横切一层，套在业务流的外面
//    业务代码只负责"喊一声发生了什么"，落库、容错、格式，全归这个文件管
import { randomUUID } from 'node:crypto';
import { pool } from './db.js'; // 🗄️ 复用同一个连接池（ESM 规矩：.js 后缀）

// 🔵 事件类型写成联合类型，不用 string：拼错 'tool_calls' 编译期就炸
//    （白名单思路的老朋友——把开放问题变成选择题）
export type TraceEventType =
  | 'llm_call'      // 🤖 调了一次模型（探路轮）
  | 'tool_call'     // 🤖 真执行了一次工具
  | 'no_tool_call'  // ⭐ 模型这一轮什么工具都没申请 —— 把"缺席"变成"在场记录"
  | 'reflect'       // 🪞 自检发现草稿有问题，已要求模型重写（不记就不知道它多久触发一次）
  | 'mismatch'      // 🚨 对账不一致：模型嘴上说的和 trace 里实际发生的对不上
  | 'final';        // 🤖 最终流式那轮开始

// 🔵 一条事件的形状。除 round/type 外全选填：不同事件类型关心的字段不一样
export interface TraceEvent {
  round: number;
  type: TraceEventType;
  agent?: string;       // 🤖 哪个 Agent 干的 —— 两个 Agent 一上来，没这列案卷就又“散了”
  toolName?: string;
  toolArgs?: string;    // 🤖 模型给的 JSON 原文，原样存不 parse（坏 JSON 本身就是证据）
  result?: string;      // 🤖 实际执行结果 —— 对账时拿它跟模型的说法比
  durationMs?: number;
  tokens?: number;
}

// 🟢 ⭐ 保留上限：只留最近这么多个【案卷】。单位是 trace 不是行，理由见 pruneTraces
const KEEP_TRACES = 200;
// 🟢 每开这么多个新案卷清一次。⚠️ 不用概率触发 —— 不要把触发条件交给随机数
const PRUNE_EVERY = 20;

// 🟢 本进程开过几个案卷。重启归零 → 启动后第一次开卷必清一次，进程一重启就收敛
let opened = 0;

// 🟢 案件编号：一次请求发一个，之后所有事件都盖这个章
//    ⭐ 保持纯函数（只发号，不碰库）—— 实验脚本要的就是这个不带副作用的版本
export function newTraceId(): string {
  return randomUUID();
}

// 🗄️ 滚动清理：整卷删，只留最近 keep 个案卷
//    ⭐⭐ 为什么单位是 trace 而不是行：按行删会把一个案卷【腰斩】。
//       只剩后半段的案卷，长得就像"这次一个工具都没调" —— 而那正是对账规则③⑤
//       要抓的形状。删一半等于制造假证据，比什么都不留更坏。
//    ⚠️ 被清掉的案卷 getTrace() 会返回空数组。对账是流完立刻跑的，碰不上；
//       但将来做回放页时，翻一个老 trace 翻出空的，要显示"已过期"而不是"无异常"
export async function pruneTraces(keep = KEEP_TRACES): Promise<number> {
  try {
    const [res] = await pool.query(
      // 🗄️ ⚠️ MySQL 不许在 DELETE 的子查询里直接读同一张表（"You can't specify target
      //    table"），必须再包一层派生表 AS keep_ids —— 包一层它就先算完再删
      // 🗄️ 排序用 MAX(id) 而不是 created_at：同一秒内开的两个案卷，时间戳分不出先后，自增 id 分得出
      `DELETE FROM traces WHERE trace_id NOT IN (
         SELECT trace_id FROM (
           SELECT trace_id FROM traces GROUP BY trace_id ORDER BY MAX(id) DESC LIMIT ?
         ) AS keep_ids
       )`,
      [keep],
    );
    const n = (res as { affectedRows: number }).affectedRows;
    if (n > 0) console.log(`🧹 traces 清理：删掉 ${n} 行（保留最近 ${keep} 个案卷）`);
    return n;
  } catch (err) {
    // ⭐ 跟 logEvent 同一条规矩：观测层自己坏掉，也不许弄死业务
    console.error('trace prune failed:', err);
    return 0;
  }
}

// 🟢 开一个新案卷 = 发编号 + 顺手滚动清理。业务层用这个，不用 newTraceId
//    ⚠️ 名字用 start 而不是 new：它有副作用（会删旧案卷）。名字必须诚实，
//       否则下一个人看到 newTraceId() 删了库，会以为自己疯了
export function startTrace(): string {
  // 🟢 opened 是第几次开卷（0,20,40… 这几次清）。void = 故意不 await：
  //    清理不该拖慢用户看到第一个字的时间，而且它内部已经把错误吃掉了
  if (opened++ % PRUNE_EVERY === 0) void pruneTraces();
  return newTraceId();
}

// 🗄️ 写一条事件。⭐ 注意它 catch 了所有错误后什么都不抛
export async function logEvent(traceId: string, e: TraceEvent): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO traces
         (trace_id, agent, round, type, tool_name, tool_args, result, duration_ms, tokens)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      // 🗄️ ?? null：MySQL 不认 undefined，选填字段缺席时必须显式给 null
      [
        traceId,
        e.agent ?? null,
        e.round,
        e.type,
        e.toolName ?? null,
        e.toolArgs ?? null,
        e.result ?? null,
        e.durationMs ?? null,
        e.tokens ?? null,
      ],
    );
  } catch (err) {
    // ⭐ 观测层绝不能弄死业务：日志表挂了，用户的记账也得照样能成
    //    这就是"套在外面的一层"在代码里的样子——它坏了，里面的流水线不受影响
    console.error('trace log failed:', err);
  }
}

// 🔵 从库里读回来的一行（列名是 snake_case，直接照 SQL 的样子声明）
export interface TraceRow {
  id: number;
  trace_id: string;
  agent: string | null;
  round: number;
  type: TraceEventType;
  tool_name: string | null;
  tool_args: string | null;
  result: string | null;
  duration_ms: number | null;
  tokens: number | null;
}

// 🗄️ 翻案卷：按案件编号取出全部事件。对账机制和实验脚本都靠它
//    ORDER BY id —— 自增 id 在同一个 trace 内部的先后关系天然正确
export async function getTrace(traceId: string): Promise<TraceRow[]> {
  const [rows] = await pool.query(
    'SELECT * FROM traces WHERE trace_id = ? ORDER BY id',
    [traceId],
  );
  return rows as TraceRow[];
}
