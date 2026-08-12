import { pool } from '../db.js'; // 🗄️ 共用连接池（ESM 规矩：.js 后缀）
import { createPending } from '../pending.js'; // 🚦 HITL：高风险转提案
import { budgetReminder } from './budget.js'; // 🗄️ W12 D4：记账回执尾部捎带预算提醒
import { CATEGORIES } from './categories.js';
import type { ToolDef, ToolContext } from './types.js';

// 🗄️ 风控阈值：超过它不直接写库
//    ⚠️ D2 时它的行为是“直接拒绝写入”，D5 升级成“转成待用户确认的提案”
//    ⭐ W12 D1 export 了：update_expense 要用同一个阈值。阈值只能有一份 ——
//       两处各写一个 5000，改一处忘一处就是一个静默的风控缺口
export const MAX_AMOUNT = 5000;
// 🚦 批量阈值：一次请求里记到第 3 笔就开始要确认（D2 那次攻击是一口气 10 笔）
const BATCH_LIMIT = 3;
// 🔁 去重窗口：这么久之内完全相同的一笔，当重复提交处理
const DEDUP_MINUTES = 10;

// 🔁 “最近有没有完全相同的一笔”的查询结果
type SameEntry =
  | { kind: 'recorded'; id: number }  // 🔁 已经真落库了
  | { kind: 'pending'; id: number }   // 🔁 提案还在等用户确认
  | null;

// 🔁 ⭐ 幂等检查：同一笔账不得重复提交
//    为什么需要它：D5 实测发现——用户确认完只说了一句"好了"，模型会把它
//    理解成"可以记了"而【重新提交一遍】，于是又生一个新提案，然后它如实
//    报告"还是没记上"——它没说错，错的是工具允许无限重复提交
//    ⭐ 回执是【它自己伸手要来的东西】，所以把真相放在这里它一定看得到；
//       往 prompt 或 messages 里塞事实都实测无效（0/3）
async function findRecentSame(
  amount: number,
  category: string,
  note: string | null,
): Promise<SameEntry> {
  // 🗄️ note <=> ? 而不是 note = ?
  //    ⚠️ SQL 里 NULL = NULL 的结果是 NULL（不是 true），没备注的那些永远匹配不上
  //    <=> 是 MySQL 的 null-safe 等于，NULL <=> NULL 为 true
  const [ex] = await pool.query(
    `SELECT id FROM expenses
     WHERE amount = ? AND category = ? AND note <=> ?
       AND deleted_at IS NULL
       AND created_at > NOW() - INTERVAL ? MINUTE
     ORDER BY id DESC LIMIT 1`,
    [amount, category, note, DEDUP_MINUTES],
  );
  const hit = (ex as { id: number }[])[0];
  if (hit) return { kind: 'recorded', id: hit.id };

  const [pd] = await pool.query(
    `SELECT id FROM pending_expenses
     WHERE amount = ? AND category = ? AND note <=> ?
       AND status = 'pending' AND created_at > NOW() - INTERVAL ? MINUTE
     ORDER BY id DESC LIMIT 1`,
    [amount, category, note, DEDUP_MINUTES],
  );
  const p = (pd as { id: number }[])[0];
  if (p) return { kind: 'pending', id: p.id };

  // 🔁 注意：rejected 故意不去重 —— 用户拒过是一个已完成的流程，
  //    他改主意再说一次应该能记。不能因为"拒过"就封杀十分钟
  // 🔁 ⭐ W12 D1 同理：上面那条 SQL 加了 deleted_at IS NULL，所以【删掉的那笔
  //    十分钟内可以重新记】—— 跟 rejected 不去重是同一个道理：用户改主意应该能记
  return null;
}

async function addExpense(args: string, ctx: ToolContext): Promise<string> {
  // 🟡 ① parse 防坏 JSON：模型吐的是文字，文字就可能不是合法 JSON
  let parsed: { amount?: unknown; category?: unknown; note?: unknown };
  try {
    parsed = JSON.parse(args);
  } catch {
    // 🤖 返回的字符串是给【模型】看的：告诉它哪错了，它下一轮能重填
    return '参数不是合法 JSON，请重新调用并传入 amount 和 category。';
  }

  // 🟡 ② 校验：required 只是给模型的建议，不能当保证（Week 9：不信任输入）
  const amount = Number(parsed.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return `金额无效（收到：${String(parsed.amount)}），需要一个大于 0 的数字（单位：元）。请向用户确认金额。`;
  }

  // 🗄️ 风控已下移到下面的 HITL 关卡（需要 category / note 先算好才能建提案）
  //    ⚠️ 旧代码在这里直接 return 拒绝 —— 那样大额永远走不到确认那一步，必须删掉

  // 🗄️ 分类不在白名单就归"其他"：宁可粗一点，也不让脏数据进表毁了统计
  const category = CATEGORIES.includes(String(parsed.category)) ? String(parsed.category) : '其他';

  // 🗄️ note 选填；截到 255 以内，对齐 VARCHAR(255)，否则严格模式下 INSERT 会报错
  const note = parsed.note == null ? null : String(parsed.note).slice(0, 255);

  // 🔁 ⭐ 幂等关卡：必须在风险判断【之前】
  //    否则大额的重复提交会先被风险关卡接走，又生一个新提案
  const same = await findRecentSame(amount, category, note);
  if (same) {
    // 🤖 回执开头的词是对账机制的判定依据，改文案要同步改 audit.ts
    return same.kind === 'recorded'
      ? `已记账（#${same.id}）：${category} ${amount.toFixed(2)} 元。这笔刚才已经记过了，本次未重复记入。请告诉用户它已入账。`
      : `待确认（提案 #${same.id}）：${category} ${amount.toFixed(2)} 元。这笔已经提交过，正在等用户在界面上确认，本次没有重复提交。`;
  }

  // 🚦 ⭐ HITL 关卡：到这一刻我们手里是【结构化的数字】，判断是确定性的
  //    —— 这就是为什么关卡要放在工具里，而不是放在"选哪个 Agent"那一层
  const risk =
    amount > MAX_AMOUNT ? `单笔 ${amount} 元超过 ${MAX_AMOUNT} 元`
    : ctx.batch >= BATCH_LIMIT ? `一次要求记 ${ctx.batch} 笔`
    : ctx.seq >= BATCH_LIMIT ? `本次对话已连续记到第 ${ctx.seq} 笔`
    : null;

  if (risk) {
    // 🚦 不写库，只建提案。数字在这一刻冻住，之后只能整张确认或整张拒
    const pendingId = await createPending(ctx.traceId, { amount, category, note, reason: risk });
    // 🤖 回执开头的"待确认"是对账机制的判定依据（audit.ts 靠 startsWith 认它）
    return `待确认（提案 #${pendingId}）：${category} ${amount.toFixed(2)} 元。原因：${risk}。本笔尚未记入，已请用户在界面上确认。`;
  }

  // 🗄️ ③ 写库：参数一律用 ? 占位符——值来自模型，模型的输入来自用户，拼字符串等于开门接注入
  try {
    const [result] = await pool.query(
      'INSERT INTO expenses (amount, category, note) VALUES (?, ?, ?)',
      [amount, category, note],
    );
    const id = (result as { insertId: number }).insertId; // 🗄️ INSERT 返回的不是行，是执行结果
    // 🤖 ④ 回执：写清楚成功了什么，模型会据此组织人话回给用户
    //    ⚠️ 开头的"已记账"是对账机制的判定依据（audit.ts 靠 startsWith 认它），改文案要同步改那边
    //    🗄️ ⭐ W12 D4：尾部捎带预算提醒 —— 回执是模型的必经之路，提醒一定会被转达。
    //       只追加在尾部，开头词协议不动；提醒自己挂了返回 null，回执照发
    const receipt = `已记账（#${id}）：${category} ${amount.toFixed(2)} 元${note ? `，备注：${note}` : ''}`;
    const reminder = await budgetReminder(category);
    return reminder ? `${receipt}。${reminder}` : receipt;
  } catch (err) {
    console.error('add_expense DB error:', err); // 🟢 真相给日志
    return '写入数据库失败，本笔没记上。请告知用户稍后重试。'; // 🤖 给模型的模糊说法：不泄露内部细节
  }
}

export const addExpenseTool: ToolDef = {
  spec: {
    type: 'function',
    function: {
      name: 'add_expense',
      description: '记录一笔消费。当用户提到自己花了钱、买了东西、付了款时调用。',   // 🤖 模型靠这句话决定要不要申请它
      parameters: {
        type: 'object',          // 🤖 固定这么写：参数整体是一个对象
        properties: {            // 🤖 逐个参数登记（description 是写给模型看的说明书）
          amount: {
            type: 'number',
            // 🤖 命令式 + 堵死歧义：单位/总额还是单价/正负号
            description: '本次消费的总金额，单位：元。只填正数；多份商品填合计金额而非单价；"三十块五"这类说法转成 30.5。',
          },
          category: {
            type: 'string',
            // 🤖 枚举约束：把开放问题变成选择题，否则同一事物每次一个名字，GROUP BY 就废了
            description: '消费分类，必须从以下选项中选一个：餐饮/交通/购物/娱乐/居家/医疗/其他。无法归类时填"其他"。',
            enum: CATEGORIES, // 🤖 比 description 更硬的约束；跟后端校验共用同一份
          },
          note: {
            type: 'string',
            // 🤖 分类是粗的，备注是细的：保留用户原话，以后查账能回忆具体花在哪
            description: '消费的具体描述，保留用户原话中的关键信息，如"星巴克拿铁""打车去机场"。用户没说具体东西时可以省略。',
          },
        },
        required: ['amount', 'category'],   // 🤖 必填清单；note 不在里面 = 选填
      },
    },
  },
  run: addExpense,
};
