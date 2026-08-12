// 🟢 对账（Reconciliation）：把"模型嘴上说的"和"trace 里实际发生的"摆在一起比
//    它是监督者不是守门员 —— 只告警、只留证，永远不挡用户
import { getTrace, logEvent } from './trace.js';
import { hasRecentConfirmed } from './pending.js'; // 🚦 规则⑤要查真库，光看 traces 不够

// 🤖 ⭐ 全部规则只锚在这一个【有限】词表上：承认"没记上"的说法是可穷举的
//    （反过来，报喜的说法是无限的："搞定""妥了""安排上啦""给你记着了"…… 列不完）
const ADMIT_FAIL = /没记|未记|没能记|未能记|没有记|记不上|没记上|失败|出错|未记录|稍后重试|超过上限|未记入/;

// 🤖 只在"一次工具都没调"那条路上退而用它。已知是弱环节，见文件末尾注释
const CLAIM_ADD = /已记|记好了|记上了|记下了|已经记|已录入|记账成功|入账/;

// 🚦 ⭐ D5 新增：HITL 带来了【第三种结局】—— 不是成功也不是失败，而是"待确认"
//    对账必须认得它，否则每次正常的 HITL 都会被误报成谎报
//    同样是举证责任倒置："要求确认"的说法也是有限的，拿有限那个当锚点
const ASK_CONFIRM = /确认|确认下|确认一下|确认后|待确认|需要你|等你|点一下|手动确认/;

// 🗄️ ⭐ W12 D1：改/删/恢复 三个新工具。它们的成功回执统一以"已"开头
//    （已修改 / 已删除 / 已恢复），非成功以"找不到""未修改""未恢复""删除失败"开头
//    ⚠️ 改那三个文件的回执文案时，这里要同步
//    ⚠️⭐ "未恢复"那条是事故后改的：它曾经写成"已恢复…本来就没被删除"，
//       "已"开头 → 被这里当成成功 → 模型和对账双双被骗。回执开头词是对账的
//       判定依据 —— 所以它不是文案，是协议
//    ⚠️⭐ W12 D4 B2 同一课的又一只脚：agent.ts 预算超限回执曾写成"已拒绝执行"，
//       同样"已"开头被当成功 → 改成"超过上限，本次未执行"开头（落在 ADMIT_FAIL 内）。
//       完整例外清单见 architecture.md 不变量 4
const EDIT_TOOLS = ['update_expense', 'delete_expense', 'restore_expense'];

// 🤖 承认"没改成/没删成"的说法 —— 跟 ADMIT_FAIL 同一个思路：锚在有限词表上
//    （报喜的说法无限，承认失败的说法有限）
//    ⭐ W12 D1 补："没被删/没删过/不处于删除/无需恢复" —— restore 打空时
//    诚实的转述长这样，不补进词表就会把诚实的回复判成谎报
const ADMIT_EDIT_FAIL = /没找到|未找到|不存在|没能|没改|未修改|改不了|没删|未删除|删不了|未恢复|没有被删|没删过|不处于删除|无需恢复|不需要恢复|失败|出错|无法/;

export interface Verdict {
  ok: boolean;
  reason: string;
  agent?: string; // 🟢 从案卷里读出来的，给 reconcile 写 mismatch 事件时用
  // 🪩 ⭐ W12 D1：这条谎报是不是"零工具调用"那条路上的（规则③⑤）
  //    reflect 靠它选纠正话术：零工具路上【没有任何回执可以"以其为准"】，
  //    而且最后那轮流式故意不传 tools —— 它想补调工具也做不到，只能认
  zeroToolCall?: boolean;
  // 🚦 ⭐ W12 D1：规则⑤专属 —— 真库里已确认落库的那笔事实
  //    为什么单独要它：trace 34623773 事故 —— 规则③（吹牛）和规则⑤（反向谎报）
  //    同走 zeroToolCall，但纠正方向【相反】：③要它承认"什么都没发生"，
  //    ⑤却要它承认"已经发生了"—— 拿③的话术去纠⑤，它只会把"没记上"再说一遍
  recordedFact?: string;
}

// 🔎 replyText = 模型最终吐给用户的完整那段话（controller 在流出口攒的）
//    ⭐ 这一层只【判断】，不写库 —— 拆出来是为了让 Reflection 能拿它查草稿：
//    草稿还没说出口，不应该往案卷里记 mismatch
export async function judge(traceId: string, replyText: string): Promise<Verdict> {
  const rows = await getTrace(traceId); // 🗄️ 翻案卷：实际发生了什么

  // 🗄️ 四个事实，全部来自案卷，不来自模型的嘴
  const addCalls = rows.filter((r) => r.type === 'tool_call' && r.tool_name === 'add_expense');
  const attemptedAdd = addCalls.length > 0;
  const succeededAdd = addCalls.some((r) => !!r.result?.startsWith('已记账'));
  // 🚦 转了提案（工具回执以"待确认"开头）—— 这是个合法结局，不是故障
  const pendingAdd = addCalls.some((r) => !!r.result?.startsWith('待确认'));
  // 🗄️ ⭐ W12 D4 B3 新事实：有没有【失败的】add —— 既非成功也非待确认就是失败
  //    为什么必须算：混合结局（一笔成功 + 一笔失败）下，诚实回复必然同时含
  //    "记好了"和"没记上" → 旧规则②误报反向谎报。W12 D1 给"成功+待确认"打过
  //    !pendingAdd 补丁，"成功+失败"这个组合漏了 —— 同一课的第二只脚：
  //    ⭐ 每加一种结局，所有旧规则都要重审一遍
  const failedAdd = addCalls.some(
    (r) => !r.result?.startsWith('已记账') && !r.result?.startsWith('待确认'),
  );
  // 🤖 模型有没有把"没记上"这件事说出口
  const admitted = ADMIT_FAIL.test(replyText);

  // 🗄️ ⭐ W12 D1 新增的事实：本次有没有【动过已有的账】（改/删/恢复）
  //    为什么必须算这个：下面规则③⑤ 的前提都是"一次工具都没调"，
  //    而它们当时只看 add_expense。新工具上来后，"只调了 update"会被
  //    当成"什么都没调" → 误报。详见下面那两处 !attemptedEdit 补丁
  const editCalls = rows.filter(
    (r) => r.type === 'tool_call' && EDIT_TOOLS.includes(r.tool_name ?? ''),
  );
  const attemptedEdit = editCalls.length > 0;
  // 🗄️ 成功的标志：回执以"已"开头（已修改/已删除/已恢复，含幂等那几条）
  const succeededEdit = editCalls.some((r) => !!r.result?.startsWith('已'));

  // 🗄️ ⭐ W12 D4 新事实：本次有没有【设过预算】（set_budget 是写工具）
  //    为什么必须算：规则③⑤的前提是"什么都没干"，而用户说"给餐饮设 2000 预算"、
  //    模型调完 set_budget 回"预算记下了"时，"记下了"正好命中 CLAIM_ADD ——
  //    不排除就把一次正常的设预算判成谎报，reflect 还会把诚实草稿纠成谎话
  //    ⭐ 这就是"每加一种结局，所有旧规则都要重审一遍"的第三次实例
  //    （第一次 pendingAdd，第二次 attemptedEdit，这次 attemptedBudget）
  const attemptedBudget = rows.some(
    (r) => r.type === 'tool_call' && r.tool_name === 'set_budget',
  );

  // 🤖 是哪个 Agent 干的：不靠参数传，直接从案卷里读 —— 少一个参数就少一个传错的机会
  const agent = rows[0]?.agent ?? undefined;

  // 🚦 ⭐ 规则④【HITL 专属】转了提案，但没告诉用户还需要确认
  //    这是 HITL 最危险的失效方式：钱没进库，而用户以为进了 → 过一个月对不上账
  //    放在规则①前面：否则①会把它算成"执行失败"，报错的原因
  if (pendingAdd && !ASK_CONFIRM.test(replyText)) {
    return { ok: false, agent, reason: '谎报：有待确认提案，但回复没请用户确认' };
  }

  // ⭐ 规则①【举证责任在模型】工具试过但没成 → 回复里必须承认，否则报警
  //    它用"搞定"还是"妥了"报喜我们一概不管 —— 我们只查那句必须说的话在不在
  //    🚦 pendingAdd 要排除：待确认不是失败，它的证词要求已经在规则⑥里查过了
  if (attemptedAdd && !succeededAdd && !pendingAdd && !admitted) {
    return { ok: false, agent, reason: '谎报：add_expense 执行失败/被拒，但回复没告知用户没记上' };
  }

  // ⭐ 规则②【反向矛盾】真记上了，却跟用户说没记上
  //    后果比想象的严重：用户以为没成，回头再记一遍 → 重复记账，脏数据从这来
  //    🚦 !pendingAdd：混合结局（一笔落库 + 一笔待确认）下，一句话里同时出现
  //    "记好了"和"尚未记入"是合法的 —— 这条规则在那种情况下必须让位，否则误报
  //    🗄️ ⭐ W12 D4 B3 补 !failedAdd："成功+失败"混合结局同理 —— 一笔"已记账"
  //    一笔"写库失败"时，诚实回复必然同时说"记好了"和"没记上"，不让位就把诚实判成反向谎报
  if (succeededAdd && admitted && !pendingAdd && !failedAdd) {
    return { ok: false, agent, reason: '反向谎报：add_expense 成功，但回复说没记上' };
  }

  // 🗄️ ⭐ 规则⑥【W12 D1新增、规则①的泛化版】改/删/恢复 试过但一次都没成功，
  //    而回复里没承认 —— 典型现场：工具返回"找不到这笔"，它却说"已经帮你删了"
  //    放在规则③⑤【前面】：它有案卷证据（强规则），③⑤ 靠词表猜（弱规则）
  if (attemptedEdit && !succeededEdit && !ADMIT_EDIT_FAIL.test(replyText)) {
    return { ok: false, agent, reason: '谎报：改/删/恢复 全部未成功，但回复没告知用户没成' };
  }

  // 规则③【弱规则】一次工具都没调，却声称记上了 —— 这条只能靠关键词
  //    因为"用户到底有没有记账意图"这件事，案卷里查不到
  //    🗄️ ⚠️⭐ W12 D1 补丁 !attemptedEdit：用户说"把那笔改成 35"时，
  //       它调的是 update_expense（attemptedAdd 为 false），然后回复"已经帮你改好了"
  //       —— CLAIM_ADD 里有"记好了"，正好命中 → 把一次正常的修改当成谎报
  //       ⭐ 这就是"每加一种结局，所有旧规则都要重审一遍"的当场实例
  if (!attemptedAdd && !attemptedEdit && !attemptedBudget && CLAIM_ADD.test(replyText) && !admitted) {
    // 🚦 ⭐ W12 D1 补丁：先查真库再定罪 —— HITL 确认后的下一轮，模型凭
    //    （confirm 已回写的）记忆如实说"记好了"是合法的：最近确有已确认
    //    落库的提案就不算谎报（exp:confirmsync 实测：不补这条，修好反向谎报
    //    后诚实的那句"记好了"反而被这里报警）—— 对称于规则⑤查真库
    //    🔴 已知代价：确认后 10 分钟内，凭空吹的"记好了"也会被放过 ——
    //    和规则⑤的已知误报同一类取舍，出路都是 W12 D4 的 LLM-as-judge
    const recent = await hasRecentConfirmed();
    if (!recent) {
      return { ok: false, agent, zeroToolCall: true, reason: '谎报：一次工具都没调，但回复声称已记账' };
    }
  }

  // 🚦 ⭐ 规则⑤【规则③的反面】一次工具都没调，却声称"没记上"，而它实际落库了
  //    这是 D5 真出过的事故：用户确认完说"好了"，它不查库、凭旧对话断定"还没记上"
  //    ⭐ 这条必须查【真库】：零工具调用 = traces 里什么都没有，光翻案卷永远发现不了
  //    🗄️ ⚠️⭐ W12 D1 同样补丁 !attemptedEdit：删除失败时它说"删除失败"，
  //       "失败"正在 ADMIT_FAIL 词表里 → 而此时恰好有一笔最近被确认的提案
  //       → 会拿一个跟删除毫无关系的提案去报谎报
  //    🔴 已知误报可能：用户问的是另一笔，而恰好最近有另一笔被确认过。
  //       接受这个误报 —— 对账只告警不拦人，宁可多叫一声
  if (!attemptedAdd && !attemptedEdit && !attemptedBudget && admitted) {
    const recent = await hasRecentConfirmed();
    if (recent) {
      return {
        ok: false,
        agent,
        zeroToolCall: true,
        // 🚦 ⑤的事实单独带出去：reflect 要拿它给出【方向正确】的纠正指令
        recordedFact: `提案 #${recent.id} 已由用户在界面上确认并落库（expenses #${recent.expenseId}），那笔账已入账`,
        reason: `谎报：一次工具都没调就说"没记上"，但提案 #${recent.id} 已确认并落库（expenses #${recent.expenseId}）`,
      };
    }
  }

  return { ok: true, agent, reason: '一致' };
}

// 🪞 Reflection：回复发出【之前】拿确定性规则审一遍草稿
//    ⭐ 不是问模型"你有问题吗"（那是概率性的），而是用规则告诉它
//    "你这里有问题"，再让它改 —— 机器查错，模型措辞
//    返回值：要追加给模型的纠正指令；草稿合格就返回 null
export async function reflect(
  traceId: string,
  draft: string,
  agentName: string,
): Promise<string | null> {
  if (!draft) return null;
  const v = await judge(traceId, draft);
  if (v.ok) return null;

  // 🟢 记下来，否则永远不知道自检多久触发一次（又是"缺席无法自证"）
  await logEvent(traceId, { round: 0, agent: agentName, type: 'reflect', result: v.reason });
  console.log(`🪞 [${agentName}] 自检拦下草稿：${v.reason}`);

  // 🪞 ⚠️⭐ W12 D1：零工具路径必须换一套话术 —— 真出过事故：
  //    下面那套老话术说"以上面工具回执的真实结果为准"，可零工具这条路上
  //    【根本没有回执】，它无从"以其为准"，只好把同一句谎换个说法再说一遍
  //    （拦了等于没拦）。而且最后那轮流式故意不传 tools —— 它想补调工具
  //    也做不到。所以这条路上能要求的只有：如实承认什么都没发生
  if (v.zeroToolCall) {
    // 🚦 ⭐ W12 D1：规则⑤（反向谎报）要的是【相反方向】的纠正 ——
    //    trace 34623773 事故：拿下面"如实告诉用户你还没有执行"去纠它，
    //    模型照办 → 把"还没记上"重写了一遍 → reconcile 再报同一条 mismatch
    //    （纠正指令自己把模型推回谎话里 —— 拦截器和谎言同向，拦了等于没拦）
    if (v.recordedFact) {
      return (
        `你刚写的回复未通过一致性检查：${v.reason}。` +
        `经后台数据库核实，事实是：${v.recordedFact}。` +
        `请以这个事实为准重写：明确告诉用户这笔账已经记上了，不得说"没记上""还没记"，也不要重新发起记账。` +
        `用户没有看到你上一版回复，所以不要提及修正、不要道歉、不要说"刚才"，直接给出正确的回复。`
      );
    }
    return (
      `你刚写的回复未通过一致性检查：${v.reason}。` +
      `注意：你这一轮没有调用任何工具，没有任何操作真正发生，你也没有任何回执可以引用，不得凭空断言操作结果。` +
      `请以上面检查结论里给出的事实为准重写：没有发生的操作不得说已完成，如实告诉用户你还没有执行，并说明下一步需要先查什么或需要用户提供什么。` +
      `用户没有看到你上一版回复，所以不要提及修正、不要道歉、不要说"刚才"，直接给出正确的回复。`
    );
  }

  // 🪞 ⚠️ 最后一句是实测出来的：不加它，模型会写"等等，刚才有点说快了"、
  //    "我刚才说搞定有点过头了" —— 可用户【从未看到】那份草稿，
  //    它在为一句人家不知道的话道歉，只会让人莫名其妙
  return (
    `你刚写的回复未通过一致性检查：${v.reason}。` +
    `请重写一遍，以上面工具回执的真实结果为准，不得美化、不得省略失败或待确认的事实。` +
    `用户没有看到你上一版回复，所以不要提及修正、不要道歉、不要说"刚才"，直接给出正确的回复。`
  );
}

// 🔎 对账：判断 + 留证。controller 在回复发出【之后】调它
//    ⭐ 跟 judge 的差别就是多了"写 mismatch"这一步 —— 因为这句话已经说出去了
export async function reconcile(traceId: string, replyText: string): Promise<Verdict> {
  const v = await judge(traceId, replyText);
  if (!v.ok) {
    await logEvent(traceId, { round: 0, agent: v.agent, type: 'mismatch', result: v.reason });
    console.warn(`🚨 对账不一致 [trace ${traceId}] [${v.agent ?? '?'}] ${v.reason}`);
  }
  return v;
}

// 🔴 已知漏洞（不装作没有）：规则③ 那条路上，如果模型用词表外的说法报喜
//    （"搞定啦"且一次工具都没调），依然抓不到。
//    根因：我们无法从案卷判断"用户本来该不该记账"。
//    出路是 W12 D4 的 LLM-as-judge —— 离线跑测试集，多花一次调用无所谓。
