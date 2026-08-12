# Week 11 Day 4 · 问题与踩坑记录

> 主题：Agent 架构全景 → Observability（Trace + 对账）
> 背景：D3 休息了一天，剩余 7 天（W11 D4-D5 + W12 D1-D5）。W12 五天不动，压缩 W11。
> ⚠️ Planning 本日未讲，顺延。

## 开工状态核实

| 项 | 结果 |
|----|------|
| `server` tsc | ✅ 通过 |
| `client` tsc | ✅ 通过 |
| 数据库 | ✅ 干净：#1 #2 #13 三条，合计 70.00 元（老师亲自 SELECT 核实） |

## 今日要治的病（Day 2 遗留）

🔴 **谎报成功**：模型回"已记一笔：餐饮 5 元"，库里没有这条，也没有 `🔧 工具` 日志。
→ 根因：**模型嘴上说的和它实际调用的工具，没有任何机制保证一致。**
→ ✅ 今日已治（对账机制），但规则③ 留有已知漏洞。

## 提问记录

| # | 问题 | 一句话答案 |
|---|------|-----------|
| 1 | are we done with observability? | 没做完，差的正好是关键那半。可观测 = **采集 + 消费**；trace 落库只是采集，没有代码去读它就只是**存档**。对账才是消费者。 |
| 2 | where can we see the records? is it in the sql? | 是，MySQL `stingy.traces` 表（另有服务端控制台的 🚨 告警，但**控制台不可靠**——`tsx watch` 一重启就刷没，库里那条才留得住）。界面是 W12 的「AI 决策回放页」。 |
| 3 | 我们是不是应该重构一下？文件太乱了 | 该，但只有两处有真实理由。原则：**重构要有需求驱动，"看起来乱"不是充分理由，"下一步做不动"才是。** → 现在做：挪实验脚本 + `schema.sql` + npm scripts；D5 做：拆 `llm.ts`（因为 W12 三个 AI 经理需要 prompt/tools 变成参数）；不做：四层架构 / client / 任何抽象层 |
| 4 | what is DDL? | **Data Definition Language** —— SQL 里定义**结构**的那类（`CREATE TABLE` / `DESCRIBE`）；对应 **DML** 是操作**数据**的（`INSERT` / `SELECT`）。⭐ 回扣 D2 那个坑：**`?` 占位符活在 DML 的世界里，只能填"值"；而列名是 DDL 定义出来的结构** —— 所以 `GROUP BY ?` 永远不工作，而 `GROUP BY 666` 报 1054（没引号 = 当列名解析） |

## 踩坑记录

| # | 现象 | 原因 | 处理 |
|---|------|------|------|
| 1 | 注释掉 SYSTEM_PROMPT 里"必须调用工具"那句，模型**照样老实调工具**，谎报复现失败两次（`#15` `#16` 真落库） | 谎报是**概率性故障**，不是必然故障。那句 prompt 只提高可靠性，删掉不等于必然撒谎 | 换路子：给 `addExpense` 加失败探针（模拟 DB 挂）→ 一次就复现成功。⭐ 结论本身有价值：概率性故障没法靠"多试几次"验证，只能靠常驻机制守着 |
| 2 | ⭐ 对账 v1 **漏抓**真实谎报：模型说"搞定！午饭 5 块已经安排上啦"，`trace ffe1dd02` 里没有 `mismatch` | 规则方向错了——v1 匹配"报喜的词"，而**报喜的说法无限**（搞定/妥了/安排上/给你记着了…），词表永远列不完 | 改成**举证责任倒置**：锚在**有限**词表（承认失败的说法）上——工具失败了，回复里就必须出现"没记上"，找不到就报警，它用什么词报喜一概不管。改后 `trace 78ce0525` 抓到 |
| 3 | 服务端控制台的 🚨 告警凭空消失 | `tsx watch` 因文件改动重启，控制台被刷干净 | 印证了"告警必须落库"这个设计：库里那条 `mismatch` 还在。**别依赖控制台** |
| 4 | `mysql -e "... \G"` 报 `Unknown command '\G'` | `\G` 是 mysql 交互式客户端的指令，`-e` 非交互模式不支持 | 改看 `DESCRIBE` 输出的 `Key=MUL` 确认索引存在 |
| 5 | 第一次 `curl ... \| tail -3` 输出空白，误判请求没发出去 | 管道/缓冲问题，请求其实成功了 | 改用 `SELECT` 核实——**库是唯一可信的证据** |
| 6 | 挪完文件后 IDE 报 `src/test-tools.ts: Cannot find name 'process'`，建议装 `@types/node` | **幽灵报错**：那个路径已不存在（文件已到 `experiments/`）。IDE 语言服务拿着旧路径掉进"推断项目"模式，不读 `tsconfig.json` → 拿不到 `@types/node` → 不认识 `process` | 关掉旧标签页 / Reload Window。不改代码（装包也没用，问题不是缺包）。⭐ 判断标准：**`npx tsc --noEmit` 是源头，IDE 红线只是外套；不一致时永远信 tsc** |
| 7 | 🔴 想用 `git mv` 保留历史，报 `fatal: not a git repository` | **整个 stingy 项目不在版本控制下** —— W10 到今天所有代码一次提交都没有 | 今天先用 `mv`。⭐ 风险：今天我在 `llm.ts` 插过失败探针、注释过 prompt 行，靠我自己记得改回来——**"我记得改回来了" ≠ 改回来了，`git diff` 才是证据**（同今日主题）。待办：`git init` + `.gitignore`（⚠️ `.env` 里有 API key） |

## 交付清单

| 模块 | 内容 | 状态 |
|------|------|------|
| 建表 | `traces` 十列 + `idx_trace` 索引（学员自己跑的 CREATE TABLE） | ✅ 老师 `DESCRIBE` 核实通过 |
| `services/trace.ts` ⭐新 | 五种事件类型联合 / `newTraceId` / `logEvent`（catch 咽错误）/ `getTrace` | ✅ tsc 通过 |
| `services/audit.ts` ⭐新 | `reconcile()` 三条规则（举证责任倒置）/ `flag()` 写 `mismatch` | ✅ 8/8 用例通过 |
| `services/llm.ts` | 四个埋点 + `streamChat(messages, traceId)`；业务逻辑零改动 | ✅ 真请求验收 |
| `controllers/chat.ts` | `newTraceId()` 发号 / 攒 `fullText` / `res.end()` 后 `reconcile` / 错误盖章 | ✅ 真请求验收 |
| SYSTEM_PROMPT | 补一条：工具失败必须明说"没记上"（⚠️ 提示层，概率性） | ✅ |
| `test-trace.ts` ⭐新 | 交替写 3 个 trace → 证明并发能按 `trace_id` 拆开 | ✅ 跑通 |
| `test-reconcile.ts` ⭐新 | 8 用例（含 4 个对照组），含真实抓到的原句 | ✅ 8/8 |
| 手册 | `docs/manual/week11-day4-observability-trace.md`（一页纸速查 + 6 章 + 10 题自测） | ✅ |
| 🧹 整理 | 6 个 `test-*.ts` → `src/experiments/`（import 路径同步修） | ✅ tsc 过 + 新路径真跑通 |
| 🧹 整理 | `server/sql/schema.sql`（两表 DDL，`SHOW CREATE TABLE` 导出，与库一字不差） | ✅ `mysql < schema.sql` 退出码 0 |
| 🧹 整理 | npm scripts：`typecheck` / `db:check` / `exp:trace` / `exp:reconcile` / `exp:query` / `exp:groupby` | ✅ |

### 真请求验收记录（老师亲自发、亲自 SELECT）

| trace | 场景 | 案卷 | 判决 |
|-------|------|------|------|
| `820b9088` | "我刚买了杯咖啡花了18块" | llm_call → tool_call(add_expense ✅#14) → llm_call → no_tool_call → final | ✅ 一致 |
| `bfc38098` | "你好" | llm_call → **no_tool_call** → final | ✅ 一致（不误报） |
| `ffe1dd02` | 工具失败 + 模型说"搞定！安排上啦" | 无 `mismatch` | ❌ **v1 漏抓** |
| `78ce0525` | 同上场景，v2 规则 | 末尾有 `mismatch` | ✅ **抓到** |
| `0f852169` | "记一笔，地铁 4 块" | llm_call → tool_call(add_expense ✅#17) → llm_call → no_tool_call → final | ✅ 一致（不误报） |

## ⚠️ 待处理

| 事项 | 说明 |
|------|------|
| ✅ `expenses` 测试数据已清 | 已删 #14–#17，回到开工状态 **#1 #2 #13 = 70.00 元**（老师亲自 SELECT 核实）。`traces` 保留 34 事件 / 7 案卷，demo 实验数据已清 |
| 🔴 `git init` 未做 | 项目不在版本控制下，没有任何可回滚版本。需 `.gitignore` 屏蔽 `node_modules` 和 ⚠️ `.env`（里面有 API key）。W12 D1 的第一件事就是"新 repo" |
| ⏭ 拆 `llm.ts` | 315 行四个职责。拆法已定：`prompt.ts` / `tools/`（一工具一文件，声明+实现放一起）/ `agent.ts`（prompt 和 tools 变成参数）。D5 开场做，因为当天三个主题都要动它 |
| ⏭ Planning | ReAct vs Plan-and-Execute，今日未讲，顺延 D5 / W12 |
| ⏭ `days` 用 `CURDATE()` | 小修未做（现在 `NOW() - INTERVAL 1 DAY` 是"往回 24 小时"，不是"今日 0 点起"） |
| 🔴 对账规则③ 漏洞 | 一次工具都没调 + 词表外报喜 → 抓不到。根因：案卷查不到"用户该不该记账"。出路 = W12 D4 LLM-as-judge |
| 🔴 误杀（False Positive） | D2 遗留，今日未动 |
