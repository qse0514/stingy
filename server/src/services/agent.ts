// 🤖 Agent 引擎（单数 = 一个循环，它不知道任何具体人格）
//    人格和权限都是【参数】—— 想要第二个 Agent 就多传一份配置，不用复制这个函数
import type OpenAI from 'openai';
import { client } from './openai.js';
import { executeTool } from './tools/index.js';
import { logEvent } from './trace.js'; // 🟢 观测层：业务只管喊一声，落库和容错归它管
import { reflect } from './audit.js'; // 🪞 Reflection：审草稿，返回纠正指令或 null

// 🔵 一个 Agent 的全部身份信息。W12 的三个车队经理 = 三份这个对象
export interface AgentConfig {
  name: string;          // 🟢 谁 —— 写进 trace，将来回放页要按它分组
  systemPrompt: string;  // 🤖 人格：幕后导演的字条
  tools: OpenAI.Chat.ChatCompletionFunctionTool[]; // 🤖 ⭐ 权限：它手上有哪几把钥匙
}

const MAX_TOOL_ROUNDS = 5; // 🤖 保险丝①：数"来回几轮"（外层）
// 🤖 保险丝②：数"一共干多少活"。模型一轮可以交一叠申请表，只防轮数等于没防
const MAX_TOOL_CALLS = 5;

// 🟢 traceId 由 controller 发（一次 HTTP 请求 = 一个案件），这里只负责往案卷里记事
//    ⭐ W12 D1：messages 类型改成 OpenAI 原生形状 —— 历史现在由 buildHistory 从库里
//    重建（含申请表和工具回执），不再是前端寄来的纯文字对话
export const runAgent = async (
  agent: AgentConfig,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  traceId: string,
) => {
  // 🤖 history：这一次请求的完整"卷宗"，工具申请表和回执都往里追加
  //    ⭐ system prompt 现在来自参数，不再是模块里写死的常量
  const history: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: agent.systemPrompt },
    ...messages,
  ];

  let toolCallCount = 0; // 🤖 本次请求的工具预算，跳轮也不清零
  // 🚦 每个工具各自被调了几次（跟上面那个总数分开）—— 工具自己无状态，计数只能引擎拿着
  const perToolSeq = new Map<string, number>();
  // 🪞 循环最后一轮模型写好的正文（以前直接丢掉）—— Reflection 拿它当草稿
  let draft = '';
  // 🗄️ ⭐ W12 D1：本次请求里【真实发生过】的申请表 + 工具回执，攒给 controller 落库
  //    注意它和 history 不是一回事：history 里还有 system prompt / 旧历史 /
  //    reflect 纠正指令，那些都【不进记忆】；草稿也永远不进（锚定效应，实测 3/3 vs 2/3）
  const transcript: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  // 🤖 ④ Agent Loop：Thought→Action→Observation，先把工具活干完（非流式，用户看不见）
  for (let round = 1; round <= MAX_TOOL_ROUNDS; round++) {
    const t0 = Date.now();          // ⏱️ 秒表在 await 前上发条
    const res = await client.chat.completions.create({
      model: 'deepseek-chat',
      messages: history,        // 🤖 全量卷宗（失忆症患者每轮重看）
      tools: agent.tools,       // 🤖 ⭐ 菜单每轮都递，但只递【这个 Agent 有权限的那几张】
    });

    // 🟢 事件①：这一轮模型调用本身。不管它有没有要工具，先记一笔（耗时 + 花费）
    await logEvent(traceId, {
      round,
      agent: agent.name,
      type: 'llm_call',
      durationMs: Date.now() - t0,
      tokens: res.usage?.total_tokens, // 🤖 ?. 因为 usage 不保证每次都带
    });

    const reply = res.choices[0].message;

    // 🟢 事件②：⭐ 这两行的【顺序】是最容易写错的地方
    //    logEvent 必须在 break 之前。写在 break 后面 = 永远不执行
    //    = 又回到"缺席无法自证"，对账机制会在最需要它的时候瞎掉
    if (!reply.tool_calls) {
      await logEvent(traceId, { round, agent: agent.name, type: 'no_tool_call' });
      // 🪞 ⭐ Reflection：把【本来要丢掉的】这份草稿抬起来检一遍
      //    为什么这里是草稿：循环里这轮已经把正文生成好了（正是因为它有正文
      //    不要工具，no_tool_call 才触发），而下面流式那次会把它重新生成一遍
      //    —— 所以自检不多花一次 LLM 调用，只是把已经付过钱的东西抬起来看一眼
      draft = reply.content ?? '';
      // 🪞 ⚠️⭐ 注意这里【故意不】history.push(reply) —— 草稿永远不进下文！
      //    （下面那行 push 在 break 后面，只对"申请工具的回复"生效）
      //    实测过 A/B（npm run exp:draftab）：
      //      A 不放草稿 = 3/3 改对；B 放草稿 = 2/3，而且出现锚定：
      //      它会跟那段错话对话（"'搞定'你个头啊"），甚至把错说法直接抄过来
      //    ⭐ 错误文本一旦进上下文，就成了它续写的参照物。别动这一行。
      break;                     // 🤖 不申请工具了 → 跳出去走下面的流式那轮
    }

    history.push(reply);           // 🤖 申请表原样进卷宗，少一句它就懵
    transcript.push(reply);        // 🗄️ 申请表同样进记忆 —— 下次重建历史时回执要认领它

    // 🚦 这一轮它一共交了几张申请表 —— 循环前就知道，所以能告诉工具"这是一叠还是一张"
    //    工具靠它判断批量风险（一口气 10 笔那种）
    const fnCalls = reply.tool_calls.filter((c) => c.type === 'function');

    for (const call of reply.tool_calls) {
      if (call.type !== 'function') continue;   // 🔵 判别联合收窄

      toolCallCount++;
      // 🚦 这是本次请求中第几次调【这一个】工具（跟 toolCallCount 不同，它是分工具计的）
      const seq = (perToolSeq.get(call.function.name) ?? 0) + 1;
      perToolSeq.set(call.function.name, seq);

      const tStart = Date.now();  // ⏱️ 工具自己的秒表（DB 慢查询会在这露馅）
      // 🤖 超预算就不干活 —— 但仍然要给回执：每张申请表都必须有 role:'tool' 对应，少一张 API 直接报错
      //    ⚠️⭐ W12 D4 B2：这句回执【不得以"已"开头】—— 回执开头词是对账协议：
      //    规则⑥靠 startsWith('已') 判改/删/恢复成功，旧文案"已拒绝执行"会被当成
      //    成功 → 前 5 次全失败的 delete 被第 6 次的拒绝回执掩护，模型说"都删好了"无人抓。
      //    "超过上限"在 ADMIT_FAIL 词表内，模型如实转述时规则①不会误报。改这句 = 改协议，同步 audit.ts + architecture.md 不变量 4
      const result = toolCallCount > MAX_TOOL_CALLS
        ? `超过上限，本次未执行：本次请求的工具调用次数已达上限（${MAX_TOOL_CALLS} 次）。请向用户说明并让用户逐笔确认。`
        // 🚦 把上下文递给工具：它自己看不到 traceId / 轮次 / 批量，这些只有引擎知道
        : await executeTool(call.function.name, call.function.arguments, {
            traceId,
            agent: agent.name,
            seq,
            batch: fnCalls.length,
          });
      console.log(`🔧 [${agent.name}] ${call.function.name}(${call.function.arguments}) → ${result}`); // 🟢 给人眼看的那份
      // 🟢 事件③：模型"想调什么"(toolArgs) 和"实际得到什么"(result) 一起留证
      //    对账要的就是这两列 —— 少任何一列都比不出来
      await logEvent(traceId, {
        round,
        agent: agent.name,
        type: 'tool_call',
        toolName: call.function.name,
        toolArgs: call.function.arguments,
        result,
        durationMs: Date.now() - tStart,
      });
      history.push({
        role: 'tool',            // 🤖 第四种 role：工具回执
        tool_call_id: call.id,   // 🤖 回执认领哪张申请表
        content: result,
      });
      // 🗄️ ⭐ 回执进记忆 —— #38 事故的根治就是这一行：
      //    "已删除（#38）"从此活过请求边界，下一轮它重看记录时能看见自己删过什么
      transcript.push({ role: 'tool', tool_call_id: call.id, content: result });
    }
  }

  // 🪞 ⭐ Reflection：流式吐出去之前，拿确定性规则审一遍草稿
  //    判断逻辑全在 audit.ts，这里只管【把纠正指令接回 history】
  //    注意它是后端拼的 system 消息，不经过用户 —— 所以不是那种不可信通道
  const correction = await reflect(traceId, draft, agent.name);
  if (correction) history.push({ role: 'system', content: correction });

  // 🟢 事件④：最终那轮开始。round 用 0，表示"不在 Agent Loop 里面"
  await logEvent(traceId, { round: 0, agent: agent.name, type: 'final' });

  // 🤖 ⑤ 最后一轮：带着工具结果吐人话，这轮才流式给用户看
  //    ⭐ W12 D1：返回值从裸 stream 改成 { stream, transcript } ——
  //    controller 流完要把 transcript 落库（工具轮在流式前已全部完成，取值时机安全）
  const stream = await client.chat.completions.create({
    model: 'deepseek-chat',
    messages: history,        // 🤖 完整历史（还记得吗：LLM 无状态）
    stream: true,             // 🤖 ⭐ 关键开关：不要憋大招，边生成边吐
    // 🤖 故意不传 tools：这轮必须说人话，不许再申请工具（流式拆申请表是地狱）
  });
  return { stream, transcript };
};
