// 🎨 月度报表（W12 D4 · S1 → S1+ → S1++）：纯展示组件，数据与月份切换全部来自 useStats
//    图表全部零依赖手写：进度条 = div 宽度，柱状图 = div 高度，饼图 = conic-gradient ——
//    百分比才需要计算，像素交给 CSS
import { useStats } from '../hooks/useStats';

// 🎨 金额显示：整数不带小数点，带小数才保留两位（¥91,340 比 ¥91340.00 好读）
function yuan(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

// 🎨 分类固定配色：图例色点和流水色点说同一种颜色，写成查表不写成计算
const CATEGORY_COLORS: Record<string, string> = {
  餐饮: 'bg-orange-400',
  交通: 'bg-sky-400',
  购物: 'bg-pink-400',
  娱乐: 'bg-violet-400',
  居家: 'bg-emerald-400',
  医疗: 'bg-red-400',
  其他: 'bg-zinc-400',
};

// 🎨 ⭐ S1+ 饼图专用十六进制色表：Tailwind 类名进不了 conic-gradient，
//    必须与 CATEGORY_COLORS 同序同色（orange-400/sky-400/… 的官方十六进制值）
const CATEGORY_HEX: Record<string, string> = {
  餐饮: '#fb923c',
  交通: '#38bdf8',
  购物: '#f472b6',
  娱乐: '#a78bfa',
  居家: '#34d399',
  医疗: '#f87171',
  其他: '#a1a1aa',
};

// 🎨 S1+ 统一的卡片样式：白卡 + 浅阴影（报表视图底色是 gray-50，靠白卡跳出来）
const CARD = 'rounded-2xl border border-gray-100 bg-white shadow-sm p-5';

export default function StatsPanel() {
  const { stats, error, month, atCurrentMonth, prevMonth, nextMonth } = useStats();

  // 🎨 'YYYY-MM' → 「2026年8月」（月份去掉前导 0）
  const [yearStr, monthStr] = month.split('-');
  const monthNum = Number(monthStr);

  // 🎨 ⭐ S1+ 月份切换器常驻顶部：加载中/出错时也要能继续切（否则切进坏月份就回不来了）
  const switcher = (
    <div className="flex items-center justify-center gap-4 py-1">
      <button
        onClick={prevMonth}
        className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-200"
        aria-label="上一月"
      >
        ←
      </button>
      <span className="text-base font-semibold text-gray-800">{yearStr}年{monthNum}月</span>
      {/* 🎨 右箭头在当前月禁用：不能看未来 */}
      <button
        onClick={nextMonth}
        disabled={atCurrentMonth}
        className="rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="下一月"
      >
        →
      </button>
    </div>
  );

  if (error || !stats) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-4">
        <div className="mx-auto max-w-4xl flex flex-col gap-6">
          {switcher}
          <div className="grid place-items-center py-24 text-sm text-gray-400">
            {error ? `⚠️ ${error}` : '加载中…'}
          </div>
        </div>
      </div>
    );
  }

  // 🎨 环比：上月为 0 时不显示（除零没有意义，"新用户第一个月"不该看到 +∞%）
  const delta = stats.prevMonthTotal > 0
    ? ((stats.monthTotal - stats.prevMonthTotal) / stats.prevMonthTotal) * 100
    : null;

  // 🎨 ⭐ S1++ 日均与预测的两个分母，别混：
  //    daysElapsed = 已经过了几天（当前月 = 今天几号；历史月 = 整月）→ 日均的分母，柱状图也用它
  //    totalDaysInMonth = 该月总天数 → 预测 = 日均 × 它（只在当前月有意义）
  const totalDaysInMonth = new Date(Number(yearStr), monthNum, 0).getDate();
  const daysElapsed = stats.isCurrentMonth ? new Date().getDate() : totalDaysInMonth;
  const dailyAvg = stats.monthTotal / daysElapsed;

  // 🎨 饼图：byCategory 依次占一段扇区（后端已按金额降序），色表查十六进制
  const catSum = stats.byCategory.reduce((acc, c) => acc + c.total, 0);
  const catCnt = stats.byCategory.reduce((acc, c) => acc + c.cnt, 0);
  let accPct = 0;
  const pieStops = stats.byCategory.map((c) => {
    const from = accPct;
    accPct += (c.total / catSum) * 100;
    return `${CATEGORY_HEX[c.category] ?? '#a1a1aa'} ${from}% ${accPct}%`;
  });
  // 🎨 ⭐ S1++ 圆心标签：只保留整数（圆心地皮小，小数是噪音）；太长就缩字号，别溢出圆外
  const totalLabel = `¥${Math.round(catSum).toLocaleString('zh-CN')}`;

  // 🎨 逐日柱状图：当前月画到今天为止，历史月画整月（柱子高度归一到当月最高日）
  const byDay = new Map(stats.daily.map((d) => [Number(d.day.slice(8)), d.total]));
  const days = Array.from({ length: daysElapsed }, (_, i) => ({ day: i + 1, total: byDay.get(i + 1) ?? 0 }));
  const maxDay = Math.max(...days.map((d) => d.total), 1);

  // 🎨 ⭐ S1++ 概览卡（头卡 + 预算卡合并）：上半大数字 + 环比 + 日均/预测，下半预算条
  //    抽成变量：空月的当前月分支也要渲染它（预算引导有价值），JSX 只写一份
  //    标题跟月份走：历史月叫"本月概览"是说谎（和 T6 流水标题同一个道理）
  const overviewCard = (
    <section className={`${CARD} col-span-2`}>
      <div className="mb-3 text-sm font-medium text-gray-700">
        {stats.isCurrentMonth ? '本月概览' : `${monthNum} 月概览`}
      </div>
      <div className="text-xs text-gray-400">{monthNum} 月总支出（不含已删除）</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-3xl font-semibold text-gray-800">¥{yuan(stats.monthTotal)}</span>
        {delta !== null && (
          <span className={`text-sm ${delta > 0 ? 'text-red-500' : 'text-emerald-600'}`}>
            {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}% 比上月
          </span>
        )}
        {/* 🎨 ⭐ S1++：上月为 0 时连"上月 ¥0"小字也不给 —— 没有信息量 */}
        {stats.prevMonthTotal > 0 && (
          <span className="text-xs text-gray-400">上月 ¥{yuan(stats.prevMonthTotal)}</span>
        )}
      </div>
      {/* 🎨 ⭐ S1++ 日均 + 月底预测：纯前端算。零支出时整行不显示（日均 ¥0 是废话）；
          预测只在当前月给 —— 历史月已经"到月底"了，预测没有意义，只留日均 */}
      {stats.monthTotal > 0 && (
        <div className="mt-2 text-xs text-gray-400">
          日均 ¥{yuan(dailyAvg)}
          {stats.isCurrentMonth && ` · 照此速度月底约 ¥${yuan(dailyAvg * totalDaysInMonth)}`}
        </div>
      )}

      {/* 🎨 预算区：沿用 S1+ 规则 —— 只在当前月渲染（budgets 无历史额度，连引导都不给）；
          当前月没设预算仍给那句引导 */}
      {stats.isCurrentMonth && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <div className="mb-3 text-sm font-medium text-gray-700">预算进度</div>
          {stats.budgets.length === 0 ? (
            <p className="text-xs text-gray-400">还没设置预算 —— 在对话里说一句"给餐饮设每月 2000 预算"就有了</p>
          ) : (
            <div className="flex flex-col gap-3">
              {stats.budgets.map((b) => {
                const pct = Math.min((b.spent / b.amount) * 100, 100);
                const over = b.spent > b.amount;
                return (
                  <div key={b.category}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-gray-600">{b.category}</span>
                      <span className={over ? 'text-red-500 font-medium' : 'text-gray-400'}>
                        {over
                          ? `超支 ¥${yuan(b.spent - b.amount)}（${yuan(b.spent)} / ${yuan(b.amount)}）`
                          : `¥${yuan(b.spent)} / ¥${yuan(b.amount)}`}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100">
                      <div
                        className={`h-2 rounded-full ${over ? 'bg-red-400' : 'bg-emerald-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );

  // 🎨 ⭐ S1++ 空月份整页收敛：recent 空 = 这个月零记账（流水/分类/逐日同源，一空俱空）
  //    不再摆三张各说一遍"没记账"的空卡 —— 空状态只在一个地方说话
  if (stats.recent.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-4">
        <div className="mx-auto max-w-4xl flex flex-col gap-6">
          {switcher}
          {stats.isCurrentMonth ? (
            // 🎨 当前月：概览卡留着（预算引导有价值）+ 一张空状态卡
            <div className="grid grid-cols-3 gap-6">
              {overviewCard}
              <section className={`${CARD} col-span-1 grid place-items-center`}>
                <p className="text-center text-xs text-gray-400">这个月还没有记账，去聊天里说一句就有了</p>
              </section>
            </div>
          ) : (
            // 🎨 历史月：只有一张卡，其余全不渲染（预算/饼图/逐日/流水都没东西可说）
            <section className={`${CARD} py-10 text-center text-sm text-gray-400`}>
              {yearStr}年{monthNum}月没有记账
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    // 🎨 ⭐ S1+ 视觉区分：报表视图底色 gray-50（聊天视图保持纯白），一眼分清在看哪边
    <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-4">
      {/* 🎨 ⭐ S1++ 两列栅格：概览 2/3 + 饼图 1/3 并排（144px 的 donut 占一整行是最大浪费），
          逐日和流水占满整行；切换器不进栅格，仍在上方居中 */}
      <div className="mx-auto max-w-4xl flex flex-col gap-6">
        {switcher}

        <div className="grid grid-cols-3 gap-6">
          {overviewCard}

          {/* 🎨 ⭐ S1++ 饼图卡变窄改竖排：donut 居中在上，图例竖排在下 */}
          <section className={`${CARD} col-span-1`}>
            <div className="mb-3 text-sm font-medium text-gray-700">分类占比</div>
            {/* 🎨 donut = conic-gradient 圆 + 中间叠白圆挖洞；⭐ S1++ 圆心放总额 + 笔数（免费地皮） */}
            <div
              className="relative mx-auto h-28 w-28 rounded-full"
              style={{ background: `conic-gradient(${pieStops.join(', ')})` }}
            >
              <div className="absolute inset-[22%] flex flex-col items-center justify-center rounded-full bg-white">
                <span className={`${totalLabel.length > 7 ? 'text-[10px]' : 'text-sm'} font-semibold text-gray-800`}>
                  {totalLabel}
                </span>
                <span className="text-[10px] text-gray-400">{catCnt} 笔</span>
              </div>
            </div>
            {/* 🎨 图例竖排在下：色点 + 分类 + ¥金额（N 笔 · XX%），降序即排行 */}
            <div className="mt-4 flex flex-col gap-1.5 text-xs">
              {stats.byCategory.map((c) => (
                <div key={c.category} className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CATEGORY_COLORS[c.category] ?? 'bg-zinc-400'}`} />
                  <span className="w-8 shrink-0 text-gray-600">{c.category}</span>
                  <span className="text-gray-500">
                    ¥{yuan(c.total)}（{c.cnt} 笔 · {((c.total / catSum) * 100).toFixed(1)}%）
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 🎨 逐日柱状图：柱子高度 = 当日/当月最高日。悬停看具体数
              （空态不用管：空月已经整页收敛，走不到这里） */}
          <section className={`${CARD} col-span-3`}>
            <div className="mb-3 text-sm font-medium text-gray-700">逐日支出</div>
            <div className="flex items-end gap-1 h-28">
              {days.map((d) => (
                <div
                  key={d.day}
                  className="flex-1 flex flex-col items-center gap-1"
                  title={`${d.day} 日：¥${yuan(d.total)}`}
                >
                  <div
                    className={`w-full rounded-t ${d.total > 0 ? 'bg-sky-400' : 'bg-gray-100'}`}
                    style={{ height: `${Math.max((d.total / maxDay) * 96, 2)}px` }}
                  />
                  {/* 🎨 横轴只标 1/5/10…，全标会挤成一团
                      ⭐ S1+ ④修复：固定高度 h-3 —— 空串 span 零高度会让有字的列被
                      items-end 顶高，底线错位；空不空都占同一格，底线自然齐 */}
                  <span className="h-3 leading-3 text-[10px] text-gray-300">
                    {d.day === 1 || d.day % 5 === 0 ? d.day : ''}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* 🎨 ⭐ S1+ 流水列表卡（最底）：所选月全部流水，最新的在上
              ⭐ S1++ 标题跟月份走：历史月叫"当月"是说谎 */}
          <section className={`${CARD} col-span-3`}>
            <div className="mb-3 text-sm font-medium text-gray-700">{monthNum} 月流水</div>
            <div className="flex flex-col">
              {stats.recent.map((r) => (
                <div key={r.id} className="flex items-center gap-3 border-b border-gray-50 py-2 text-xs last:border-b-0">
                  <span className="w-9 shrink-0 text-gray-400">{Number(r.day.slice(8))} 日</span>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CATEGORY_COLORS[r.category] ?? 'bg-zinc-400'}`} />
                  <span className="w-8 shrink-0 text-gray-600">{r.category}</span>
                  <span className="flex-1 truncate text-gray-400">{r.note ?? '—'}</span>
                  <span className="shrink-0 text-right text-gray-700">¥{yuan(r.amount)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
