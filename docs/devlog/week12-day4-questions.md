# Week 12 Day 4 · 问题与踩坑记录

> 主题：休假两天后回归；F1 砍掉，改排 Eval + 学校复盘文档
> 背景：开工核实全过（tsc 前后端 0 / 活账 10 行 442310.00 / pending 全终态 / 会话记忆没动）；traces 涨到 426 行 93 卷，已按天查证对得上（见拍板结果 #1）

## 提问记录

| # | 问题 | 一句话答案 |
|---|------|-----------|
| 1 | agent 的大功能里，哪些我们做了、哪些没做？ | ✅ 做了 8 个（都有真代码+实验）：Streaming / Tool Calling / Harness+防注入 / Observability / 对账 / HITL+幂等 / Reflection / Memory。❌ 没做 4 个，性质不同：**Evaluation 是真欠着**（LLM 行为零覆盖，改 prompt 全靠裸奔）；Planning、Multi-Agent 是**论证过不需要**（学员两次质疑的系列结论："教学清单上的能力 ≠ 这个产品需要的功能"）；RAG 是造不出真需求。复盘文档可写成：8 个上生产、3 个论证不需要、1 个补考卷 |
| 2 | wait wtf is RAG again? | RAG = 检索增强生成，解决 LLM **知识冻结**且**上下文塞不下全部资料**的问题：提问前先去向量库检索出最相关的几段文档，贴进 prompt 再生成 —— 本质是"往上下文窗口塞东西的聪明办法"，和 buildHistory 塞历史消息是同一个位置的活。Stingy 用不上：账本是**结构化**数据，问什么都是一句 SQL 的**精确**答案（query_expenses）；RAG 的主场是**非结构化**文档的**模糊**检索（如"报销制度里打车怎么报"）。硬上 = 拿渔网捞游泳池，池里就十条鱼还都有编号 |
| 3 | Eval 不做，但 gimme an example of an implementation（不碰 Stingy） | **exp:\* 考代码（确定，assert 一次），Eval 考模型（概率，出通过率）**。三件套：考卷（20~30 条真实话术+期望行为）→ 考场（每题重置的独立测试库）→ 判分三档（①程序判分：工具名/参数/库状态；②协议判分：回执开头词 —— 对账协议在 Eval 里免费复用；③LLM-as-judge：只判代码查不了的语气/吹牛）。用途区别：exp 是改完代码求安心，Eval 是**改 prompt 前后各跑一遍看通过率掉没掉** —— prompt 的回归测试。只讲了示意代码，未落盘 |
| 4 | Reflection 出口 B：why? what do u mean | Agent Loop 两种走完方式：出口 A = 模型主动收尾，有草稿，reflect 能审；出口 B = 跑满 5 轮强制收尾，draft=''，reflect 第一行直接放弃。**烧满轮数的请求恰恰最乱，自检偏偏在这条路上不工作**（W12 D1 欠账 #3）。⚠️ 老师此前措辞"关还是留着"是错的，没有开关：选项是修（~20min，出口 B 也生成草稿给 reflect）or 不修（reconcile 最外层兜底，抓得到但抓得晚） |
| 5 | 为什么 tool call 原文出现在聊天里，确认界面不出来？ | 那不是真调用：最终流式轮【故意不传 tools】，模型任务没干完时偶发把 DeepSeek 内部调用标记（DSML）当正文"徒手"写出来 → API 不解析、后端收不到 → 零执行、零提案、无 [CONFIRM] 卡。更要命的是这段文本落库进记忆后成锚（不变量 2）：会话 #22 里 343→365→373 三连模仿，接着凭空吹"已入账 #84"（库里根本没有 #84）→ reconcile 规则③两次抓到（对账层干活正常）。reflect 没拦的可能原因：它审的草稿≠流式轮重新生成的成品，且草稿没留痕无法回放（观测盲点，学员拍板不加层，不修） |
| 6 | ok i need to upload this on my github, how do i do it? | GitHub 上传分三块：本地确认改动 → 创建远端空仓库 → `git add`/`git commit`/`git remote add origin`/`git push`。先确认 `.env` 等敏感文件没被提交；如果仓库已有 remote，就只需要 commit + push。 |
| 7 | can u gimme the exact git command, also my user name is qse0514 | 这个项目当前还不是 git 仓库，所以精确命令从 `git init` 开始；远端地址用 `https://github.com/qse0514/stingy.git`，推送前必须用 `git status --short` 确认 `.env` / `node_modules` / `dist` 没进暂存。 |
| 8 | how do i avoid commiting some files that im not suppose to? like the node modules and .env | 用 `.gitignore` 把不能进仓库的文件列入黑名单，例如 `.env`、`node_modules/`、`dist/`；提交前用 `git status --short` 检查，若已经误 add，用 `git restore --staged <file>` 从暂存区撤掉。 |
| 9 | git add --dry-run 输出这一长串，安全吗？ | 安全：dry-run 里出现的是会被提交的文件，当前没有 `server/.env`、`node_modules`、`dist`；`server/.env.example` 可以提交，因为它是模板。下一步可以 `git add .`、`git status --short`、`git commit`，再连接 GitHub remote push。 |

## 踩坑记录

| # | 现象 | 原因 | 处理 |
|---|------|------|------|
| 1 | 真机聊天里冒出 `<｜｜DSML｜｜tool_calls>` 原文，后续连环零工具谎报（会话 #22） | 流式轮无 tools，模型徒手写调用标记当正文 → 落库进记忆成锚 → 三连模仿（不变量 2 活案例）。全表扫还挖出会话 #13 更早一次同样发作（msg 130，还编了个不存在的 keyword 参数） | 学员拍板**不加任何代码层**（"stop adding more buffers"），只做数据止血：一次性脚本剥掉 4 行毒（343/365/373/130），先预览后 apply，验证全表零残留。接受未来再发作，reconcile 兜底 |

## 拍板结果

1. traces 25 卷 → 学员不确定，老师按天查证：08-06 晚 D1 收盘后继续涨（交接文档的 "~68 卷"是当天中途快照）+ 08-07 20:19 学员摸过一次 app（1 卷 3 行，零工具闲聊）+ 08-08~10 零增长。**对得上，非事故**。副产品结论：交接文档里的数字也是"当时的快照"，不是"现在的事实"
2. Eval → **不做**，只讲了架构和示意实现（见提问 #3）
3. Reflection 出口 B → 学员拍板**不修**，reconcile 兜底（显式取舍）
4. 仪表盘增强 S1+（下午看真机截图后逐条拍板，工单 `docs/ticket-week12-day4-stats-ui.md` 交新会话）：①流水列表 = **所选月份全部流水**（不是最近 N 笔）②月份切换 `month` 参数，**预算卡只在当前月显示**（budgets 无历史额度，画不诚实就隐藏）③逐日图空状态给引导文案 ④柱状图底线错位 = 空标签 span 零高度 + `items-end`，修法固定标签高度 ⑤饼图**替代**分类横条卡（老师推荐并列，学员拍板替代）⑥「本月统计」改名「报表」⑦统计页只做**视觉区分度**（灰底白卡），学员明确不是在说架构、不动导航不上路由
5. DSML 泄漏事故（晚间）→ 学员拍板**不加防御层**（落库前剥离/SSE 拦截/草稿留痕三案全否），只清毒数据：4 行已剥净、全表零残留。剩余尾巴：提案 #52（7000 元归"其他"）仍 pending，用户界面点掉或 24h TTL 自然失效
6. 报表页第二轮优化 S1++（晚间看 S1+ 真机后拍板，工单 `docs/ticket-week12-day4-stats-ui-2.md` 交新会话）：①上半区两列栅格（饼图 144px 占整行是浪费）②头卡+预算卡合并「本月概览」，加日均/月底预测（纯前端算）③侧栏改分段导航「💬 对话｜📊 报表」（现状报表入口长得像一条聊天记录）④donut 圆心放总额 ⑤空月份整页收敛成单一空状态（现在"没记账"说三遍）⑥流水标题跟月份；流水按日分组、最高日标金额**不做**；窄屏响应式进 backlog（I6）。另并入 M4 **会话删除**（T7）：硬删+事务（会话是模型记忆，删=彻底遗忘，expenses 软删规矩不适用），悬停 × 钮 + confirm 二次确认，pending 提案不追删留 TTL

## 今日交付

| 交付 | 内容 | 验证 |
|---|---|---|
| 综合评审工单 | `docs/review-week12-day4.md`：6 个真 bug（B1 最狠：hasRecentConfirmed 用提案创建时间判"最近确认"，自检会把诚实草稿纠成谎话）+ 6 条改进 + architecture.md 校对（总体准确，三处要补）。交新会话修 | 逐文件核读后端全部业务代码 + useChat |
| F-A 预算与超支提醒 | 第六张表 budgets（分类唯一键 upsert）+ set_budget / query_budget 两工具 + 记账回执尾部捎带提醒（分类没预算退"总体"）+ confirm 回写也捎带 + 对账规则③⑤加 `!attemptedBudget`（"每加一种结局重审旧规则"第三次实例） | exp:budget 14/14；回归 exp:crud 24/24、exp:reconcile 过；tsc 0 |
| S1 月度仪表盘 | GET /api/stats/summary（纯 SQL 聚合，零 LLM）+ 侧栏"📊 本月统计"入口 + 四卡面板（月总/环比、预算进度条、分类横条图、逐日柱状图，全部零依赖手写） | tsc 0；浏览器真机验收两轮（四卡渲染+彩条 offsetWidth/颜色实测+视图切换），截图存档 |
| 实验自身踩坑 | test-budget 断言 C4 查"不含'预算'"，可账目标记名就叫"预算实验"，备注原样进回执 → 断言和自造数据撞名自爆。改查提醒专属措辞（"还剩"/"超出预算"） | 第二跑 14/14 |
| S1+ 报表增强（工单 7 项全部落地） | stats 接口吃 `month` 参数（正则校验，非法 400，缺省服务端算当前月）+ 新增 recent 当月全部流水/isCurrentMonth；预算卡仅当前月（budgets 无历史额度）；饼图（conic-gradient donut）替代分类横条卡；月份切换器当顶部标题（右箭头当前月禁用）；柱图底线错位修复（标签 span 固定 h-3）；逐日图空态引导文案；改名「📊 报表」；报表视图灰底白卡视觉区分 | tsc 前后端 0；curl vs SQL 对账 2026-07/08 两月均对上（含临时造数验证后清理库还原）；`month=2026-13`/`abc` 均 400；浏览器真机 17 项全过（切月四块联动、预算卡随月显隐、柱图对齐控制台量测 1193==1193、7 月整月 31 柱）；截图存 `docs/screenshots/w12d4-s1plus-*.png` |
| S1++ 报表视觉优化 + 会话删除（工单 T1-T7 全部落地） | 侧栏分段导航「💬 对话｜📊 报表」（回聊天保持当前会话，看报表时下半区 opacity-50）；头卡+预算卡合并「本月概览」加日均/月底预测（纯前端，预测仅当前月）；两列栅格 grid-cols-3（概览 2/3 + 饼图 1/3 竖排，逐日/流水全宽）；donut 圆心总额+笔数；空月份整页收敛单卡；流水标题「N 月流水」；T7 会话硬删（同连接事务先删 messages 再删 conversations，悬停 × + confirm 二次确认，删当前会话先断流再清屏） | tsc 前后端 0；DELETE 204 后 SQL 直查孤儿 messages = 0（两次：curl 建测试会话 + 前端真删会话 #18）；不存在 id 404、`abc` 400；浏览器真机：两列并排/圆心总额/「8 月流水」/分段导航回聊天会话保持；7 月空页「没有记账」控制台量测 === 1；侧栏 opacity 实测报表 0.5/聊天 1；取消 confirm 零网络请求，确认后 DELETE 204；截图存 `docs/screenshots/w12d4-s1pp-*.png`（预览浏览器窗口仅 323px 会挤爆报表，改用无头 Chrome 1440x900 补拍） |

⚠️ 学员指示（下午）：先列全部 bug/需求清单（含 UI 和功能建议），按大模块分组，**列完不直接开工**，等他挑。
