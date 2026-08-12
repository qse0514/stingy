# Week 11 · Day 1 提问日志

> 用途：记录当日提问，收盘复盘 quiz 用。问过 = 薄弱点，复盘必考。
> 今日主题：Tool Calling + 结构化输出

## 晨间重考结果（Day 5 欠账 5 题 + 加时赛 #10–#17 抽考）

| 题 | 结果 | 状态 |
|---|---|---|
| 副作用导入（第四考！） | ✅ "side effect import" —— 终于！ | 🎓 毕业（下周突击抽查一次防回潮） |
| TextDecoder 为什么只建一次 | ✅ "字被切碎跨块" 答到点上 | 🎓 毕业 |
| res 信封不是信的到货时间差 | ❌ 补考答 IDK | 今晚再考：信封（status/headers）秒到，信（body）还在路上 |
| 前端第四层 = ? | ❌❌ 答 pages（第四考历史：assets→services→pages） | 今晚再考：别猜名词！看自己项目：App.tsx 组装层 |
| system prompt 放后端的安全理由 | 🟡 只答了"藏"，漏了关键词"防篡改" | 今晚再考 |

## 今日问题清单

| # | 问题 | 涉及知识点 | 一句话答案 |
|---|------|-----------|-----------|
| 1 | 模型怎么知道怎么填对申请表？ | 🤖 Tool Calling 本质 | 它被专门训练过填这种表；菜单里的 name/parameters 就是表格模板，本质仍是"预测下一个字"，只是被调教得严格按模板吐 |
| 2 | 为什么有 arguments？ | 🤖 工具参数 | 工具可能需要原料（add_expense 需要金额/分类）；model 从用户人话里抽取参数填进去——自然语言→结构化数据的魔法发生在这 |
| 3 | content 是什么？ | 🤖 回复的两条路 | content = 模型对用户说的"人话"（一直以来收到的文字就是它）；填申请表时不说人话所以 content 为 null | 
| 4 | 能不能不手动一轮一轮写，改成自动循环？ | 🤖 Agent Loop | 能且应该：真 Agent 就是 while 循环——有申请表就执行+塞回摆再问，没申请表（吐人话）= 出口；必须加轮数保险丝防无限循环烧钱 |
| 5 | `res.choices[0].message` 是什么意思？ | 🤖 API 响应结构 | choices 是数组因为可要模型一次生多份备选答案（n 参数，默认1）；[0] 取第一份，.message 是那份回复本体（含 content 和 tool_calls）；流式时叫 delta（碎片），非流式叫 message（整份） |
| 6 | 出口只 console.log，不是只打到终端吗？ | 🟢 实验脚本 vs 生产代码 | 对：这是一次性实验脚本（二分法思路：绕开前端/Express 直捐源头验证机制）；搬进 services 时 console.log 改成 return，循环本体不变 |
| 7 | `if (call.type !== 'function') continue` 在检查什么？这个 type 从哪来？ | 🔵 判别联合 + 类型收瞄 | 不是我们造的，是 OpenAI SDK 类型定义里的判别字段（tool_calls 是联合类型，将来还有 custom 等其他变种）；检查后 TS 收瞄类型，`call.function` 才能安全访问；同款：role 白名单 |
| 8 | SDK 是什么？【第二次问！Day4 讲过】 | 📦 SDK 本质 | SDK = HTTP 请求的外套：官方写好的包，把"拼 URL+写 header+序列化 body+解析响应+拆 SSE 流"包成几个函数；不用它也能干（手写 fetch），但得自己拆流+没 TS 补全；注意：用 openai 包请 DeepSeek 因为它兼容 OpenAI 协议，换 baseURL 即可 |
| 9 | 执行循环那三行逐行是什么意思？ | 🤖 工具执行三步 | for...of 逐张申请表（一轮可多张）→ 类型收瞄保护访问 .function → executeTool 派单执行（name 找函数，arguments 是 JSON 字符串需自己 parse）→ console.log 记录决策痕迹 = Observability 雏形 |
| 10 | AI 怎么知道自己有哪些工具？ | 🤖 无状态 + 工具菜单 | 它不"知道"，是我们每一轮请求都把 tools 数组重新发给它（SDK 把它序列化成文字拼进 prompt）；不传 tools 就等于没手；同款：messages 全量重发、SYSTEM_PROMPT 每次重发 |
| 11 | mysql 命令行建库建表具体怎么操作？（Week 7 技能遗忘） | 🗄️ MySQL CLI 流程 | `mysql -u root -p` → 输密码（brew 新装默认空密码，直接回车）→ 提示符变 `mysql>` → 贴 SQL，**每句必须以分号结尾**（没分号它一直等你接着写）→ `exit` 退出 |
| 12 | .env 里具体要写什么？ | 🟢 环境变量配置 | 追加 DB_HOST/DB_USER/DB_PASSWORD/DB_NAME 四行；格式 `KEY=value`（**等号两边不加空格、值不加引号、不加分号**）；空密码就 `DB_PASSWORD=` 后面留空；.env 真值/.env.example 只占位符 |
| 13 | VARCHAR 是什么？ | 🗄️ MySQL 字符串类型 | VARCHAR = variable character，可变长字符串；VARCHAR(50) = 最多 50 个字符，存多少占多少（对比 CHAR(50) 不足补空格固定占满）；超长报错或被截；长文本用 TEXT；设上限本质是数据库层的“不信任输入” |
| 14 | DB_HOST/USER/PASSWORD/NAME 四个分别是什么？ | 🗄️ 数据库连接四要素 | HOST=数据库在哪台机器（localhost=本机）；USER=用哪个账号登录（root=管理员）；PASSWORD=那个账号的密码（**必须换成真密码，your_password_here 只是占位符**）；NAME=连上后默认用哪个库（=SQL 里的 USE stingy） |
| 15 | DB 是什么？db.ts 干嘛？代码里怎么写 SQL？ | 🗄️ 数据库使用三连 | DB=database=硬盘上的永久表格（内存数组重启就没）；db.ts 只干一件事：造连接池 export 给全项目共用；写法 `const [rows] = await pool.query(sql, [参数])`，**参数一律用 ? 占位符防 SQL 注入**，返回值是数组首项才是数据 |
| 16 | 带参数的工具 parameters 具体怎么写？ | 🤖 JSON Schema | 固定三层：`type:'object'` + `properties:{每个参数:{type,description}}` + `required:[必填项名字]`；description 是写给模型看的说明书（直接影响它填得对不对）；required 之外的就是选填，不写入 required 即可 |
| 17 | amount 为什么也需要 description？内容是我自己定吗？ | 🤖 参数说明书的作用 | 内容完全自己定（它是 prompt 不是代码）；amount 需要它是因为要消除歧义：单位是元还是分、“两杯奶茂40”填总额还是单价、正负号、“三十块五”要转 30.5；type 只管“是数字”，description 管“是什么数字” |

## 今日踩坑记录

| 坑 | 现象 | 排查方式 | 根因/结论 |
|---|---|---|---|
| 菜单递了但模型不调工具 | 接进 Express 后问时间，模型不调 get_time，直接幻觉一个时间（答 2025/4/12，真实是 2026/7/30） | 二分法：脚本能调 vs 生产不能调 → 差异只有 system prompt → 把 system prompt 加进脚本，成功复现 | system prompt 里的"简短口语化回复"把它推向直接答话；递菜单不够，**必须在 system prompt 里明说"你有工具，需要真实数据必须调用，不得编造"** |
| 工具日志不出现 | 回答时间正确（精确到秒）但 console.log 的 🔧 行在日志文件里找不到 | 二分法：把 getTime 改成返回假值"1999年1月1日"，模型果真说出 1999 年 | 工具确实被调用，机制正常；日志缺失是后台进程 stdout 重定向文件的缓冲问题，非代码 bug |
| MySQL ERROR 2002 socket 连不上 | `mysql -u root -p` 报 Can't connect through socket '/tmp/mysql.sock' | 查三件：socket 文件存不存在 / 3306 有没人听 / brew services 状态 → 三项全阴 | **MySQL 服务未启动**（brew 状态 none）；socket 文件是 mysqld 启动时才创建的，服务不跑就没这个文件。修法：`brew services start mysql`。区分：**2002 = 没连上服务器（1045 = 连上了但密码错）** |

## 复盘状态

- ✅ 今日交付：get_time 全链路验收通过（浏览器→Agent Loop→工具→流式回答）；add_expense 全链路验收通过（浏览器记账→MySQL 落库 SELECT 确认）
- 📖 手册已沉淀：manual/week11-day1-tool-calling.md（6 章 + 踩坑三连 + 旧知识连接表）
- [ ] 当日复盘 quiz 未做（学员提前收工），并入明早
- 🔴 明早账单：
  - 重考：res 信封不是信（今早 IDK）、前端第四层（第五考！assets→services→pages 三连错）、system prompt 安全理由（要说出"防篡改"）
  - 今日新题 #1–#17 抽考（重点：arguments 是字符串、回执塞回历史、保险丝、SDK 第二次问了必考）
  - Day 5 加时赛 #10–#17 仍欠着（Markdown/useRef/Hook 定义）
  - 刁钻测试补做："两杯奶茶一共40"（验 description）、怪分类（验白名单归一）
