-- 🗄️ Stingy 数据库结构（Single Source of Truth）
--
-- 这个文件是【代码资产】，不是文档：换机器、重装 MySQL、部署到服务器时，
-- 数据库结构从这里来，不从聊天记录或记忆里翻。
--
-- 从零建库：
--   mysql -u root -p < server/sql/schema.sql
--
-- ⚠️ 改表时的规矩：先改这个文件，再去库里执行 —— 顺序反了就会漂移
-- ⚠️ DDL 由 SHOW CREATE TABLE 导出，与实际库结构一字不差（2026-08-04 W11D4 核实）

CREATE DATABASE IF NOT EXISTS stingy
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_0900_ai_ci;   -- 🗄️ 中文备注要 utf8mb4，别用 utf8

USE stingy;

-- ─────────────────────────────────────────────────────────────
-- 业务表：记账明细（Week 11 Day 1 建；W12 D1 加 deleted_at 软删）
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS expenses (
  id         INT           NOT NULL AUTO_INCREMENT,
  amount     DECIMAL(10,2) NOT NULL,                  -- 🗄️ 钱不用 float：DECIMAL 才不丢精度
  category   VARCHAR(50)   NOT NULL,                  -- 🗄️ 白名单七类，非法值在后端归"其他"
  note       VARCHAR(255)  DEFAULT NULL,              -- 🗄️ 选填；后端 slice(0,255) 对齐这里
  created_at DATETIME      DEFAULT CURRENT_TIMESTAMP,
  -- 🗄️ ⭐ W12 D1 软删标记：NULL = 这笔还活着；有时间 = 已删（行还在，可恢复）
  --    为什么不真删：删错了能恢复，而且对账能看到"这笔被删过"
  --    ⚠️ 代价：所有查账的 SQL 必须带 WHERE deleted_at IS NULL。查账性质的实际只有 2 处：
  --       queryExpenses 的公用 where 数组（汇总路+明细路共用）+ addExpense 的幂等查重；
  --       另有第 3 处在 updateExpense 的 UPDATE WHERE 里 —— 性质是防改已删行，不是查账（W12 D4 补记，免得未来人数不对）
  deleted_at DATETIME      DEFAULT NULL,
  PRIMARY KEY (id)
  -- 🗄️ 故意不给 deleted_at 建索引：它 99% 的值都是 NULL（选择性极低），
  --    优化器根本不会用它，建了只是每次写入多维护一份索引
) ENGINE = InnoDB;

-- ─────────────────────────────────────────────────────────────
-- 观测表：trace 案卷（Week 11 Day 4 建；Day 5 加 agent 列）
--   一行 = 一个事件；trace_id = 案件编号，把散落的事件绑成同一次请求
--   type: llm_call | tool_call | no_tool_call | reflect | mismatch | final
--   round: Agent Loop 轮次；0 = 不在循环内（final / reflect / mismatch）
--
-- ⭐ W12 D1 加了保留策略（这张表是唯一会无限增长的表：一天手测就 244 行）：
--   服务里的 pruneTraces() 只保留最近 200 个【案卷】，由 startTrace() 每 20 次开卷触发。
--   ⚠️ 清理单位是 trace 不是行 —— 按行删会腰斩案卷，半个案卷长得像"这次没调工具"，
--      会把对账规则骗过去。DDL 里没有这个约束，它只活在 trace.ts 里，所以记在这。
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS traces (
  id          BIGINT      NOT NULL AUTO_INCREMENT,    -- 🗄️ 事件顺序靠它，同 trace 内递增关系天然正确
  trace_id    VARCHAR(64) NOT NULL,                   -- ⭐ 案件编号（randomUUID）
  agent       VARCHAR(32) DEFAULT NULL,               -- 🤖 哪个 Agent 干的（多 Agent 时的分组依据）
  round       INT         NOT NULL,
  type        VARCHAR(32) NOT NULL,
  tool_name   VARCHAR(64) DEFAULT NULL,
  tool_args   TEXT,                                   -- 🗄️ 模型给的 JSON 原文，原样存不 parse
  result      TEXT,                                   -- 🗄️ 实际执行结果 / mismatch 的原因
  duration_ms INT         DEFAULT NULL,
  tokens      INT         DEFAULT NULL,
  created_at  DATETIME    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trace (trace_id)                            -- 🗄️ 按案件编号翻案卷是主要查法
) ENGINE = InnoDB;

-- ──────────────────────────────────────────────────────────
-- HITL 表：待确认的记账提案（Week 11 Day 5 建）
--   高风险的记账不直接进 expenses，先在这里等用户点头
--   status: pending → confirmed / rejected（单向，不回头）
--   ⭐ expense_id 回填是对账证据：status='confirmed' AND expense_id IS NULL
--      = 确认了但没真落库（写库那一步挂了）
-- ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_expenses (
  id         INT           NOT NULL AUTO_INCREMENT,
  trace_id   VARCHAR(64)   NOT NULL,              -- 🔎 哪次请求提的（controller 靠它查本次提案）
  amount     DECIMAL(10,2) NOT NULL,              -- ⭐ 数字在提案那一刻就冻住了
  category   VARCHAR(50)   NOT NULL,
  note       VARCHAR(255)  DEFAULT NULL,
  reason     VARCHAR(100)  NOT NULL,              -- 🤖 为什么需要确认（给用户看的理由）
  status     VARCHAR(16)   NOT NULL DEFAULT 'pending',
  expense_id INT           DEFAULT NULL,          -- 🗄️ 确认后真正落库的那条 expenses.id
  created_at DATETIME      DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trace (trace_id),
  KEY idx_status (status)
) ENGINE = InnoDB;

-- ──────────────────────────────────────────────────────
-- 记忆表两张：对话 + 消息（W12 D1 建，Memory 中期层）
--   ⭐ messages 是【给模型重看的记忆】，traces 是【给人看的案卷】：
--      前者不清理（清了就是失忆），后者滚动清理 —— 用途不同，生命周期就不同，不合并
--   ⭐ 工具回执（role='tool'）也落库 —— #38 失忆事故的根治：
--      以前回执活不过一次 HTTP 请求，模型下一轮永远不知道自己删过 #38
--   不存：system prompt（来自 agents.ts 配置）、草稿、reflect 纠正指令、
--        前端确认卡片（那些本来就不给模型看）
-- ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id         INT          NOT NULL AUTO_INCREMENT,
  title      VARCHAR(50)  NOT NULL,                  -- 🗄️ 取首条用户消息前 20 字，侧栏显示用
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME     DEFAULT CURRENT_TIMESTAMP, -- 🗄️ 每次追加消息时 bump，侧栏排序依据
  PRIMARY KEY (id)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT      NOT NULL AUTO_INCREMENT, -- 🗄️ 同一对话内的先后顺序靠它
  conversation_id INT         NOT NULL,
  role            VARCHAR(16) NOT NULL,           -- user | assistant | tool
  content         TEXT,                           -- 🤖 正文；纯申请表那行可以为 NULL
  tool_calls      TEXT,                           -- 🤖 申请表 JSON 原文，原样存不 parse
  tool_call_id    VARCHAR(64) DEFAULT NULL,       -- 🤖 回执认领哪张申请表
  created_at      DATETIME    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_conv (conversation_id)                  -- 🗄️ 按对话重建历史是唯一查法
) ENGINE = InnoDB;

-- ──────────────────────────────────────────────────
-- 预算表：每月预算（W12 D4 建，预算与超支提醒功能）
--   一行 = 一个分类的每月额度；category 取七类白名单或特殊值"总体"
--   ⭐ category 唯一键：set_budget 是 upsert，同一分类只有一份额度，改 = 覆盖
--   ⭐ 额度按自然月计："本月已花"由代码用 created_at >= 本月 1 号算，表里不存月份
-- ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS budgets (
  id         INT           NOT NULL AUTO_INCREMENT,
  category   VARCHAR(50)   NOT NULL,              -- 🗄️ 七类白名单 + "总体"，后端白名单校验
  amount     DECIMAL(10,2) NOT NULL,              -- 🗄️ 每月额度，单位元
  created_at DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_category (category)               -- ⭐ upsert 的支点：同分类只有一份
) ENGINE = InnoDB;
