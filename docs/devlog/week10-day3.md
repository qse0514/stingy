# Week 10 · Day 3 工作日报

**实习生**：张效涵
**主线**：SmartShot 业务收尾 + AI Agent 全栈闭环启动

---

## 一、SmartShot 业务（上午，已收尾 ✅）

### 推送 2 个 commit

**`7c4834b` — 匹克球页面修复 + 合作伙伴卡迁移**
- 匹克球卡片顶部对齐：固定高度消除排版漂移
- 合作伙伴卡迁移为独立组件 `PartnerCard.tsx`，同步同事改动
- 修复 `font-bold` 不生效根因：SourceHanSans 字体只声明了一个字重，
  加粗类名无从生效 —— 属于字体资源问题而非 CSS 问题
- 案例素材补齐：CTJ/PPA videoSrc、CTJ↔CPC logo 互换修正

**`4a252a4` — 修复 React #185 无限更新循环**
- 根因 1：`LeftShowcase.tsx` callback ref 使用内联箭头函数，函数身份
  每次渲染都变，触发 ref 反复挂载/卸载
- 根因 2：`phoneImages` 默认参数进了依赖数组，默认参数每次渲染生成
  新引用，effect 无限重跑
- 教训：**引用身份不稳定是 React 无限循环的高频根因**
  （计划 Week 12 Day 3 整理成 Debug 复盘文档）

### 验证
- dev server 实际渲染验证通过（卡片对齐 / 字重 / console 无 #185 报错）✅

---

## 二、方向调整拍板 ⚠️

- **Notes App 正式冻结**：功能性收尾，不再扩展，作为技能证明保留
- 原"Notes App + Summarize"路线放弃
- Week 10-12 新主线：**AI Chat → Mini Agent 全栈闭环** + SmartShot 持续跟进
- AI 学习范围分层：
  - Tier 1 实操：结构化输出 + Prompt Injection 防御
  - Tier 2 实操：Observability + RAG 最小实现
  - Tier 3 仅理论：模型选择 / Fine-tuning / 训练原理 / Multi-agent

---

## 三、Stingy 项目启动 🆕（下午）

### 立项决策
| 决策项 | 结论 | 理由 |
|---|---|---|
| 项目主题 | Stingy —— 抠门记账 AI 助手 | 让 Week 11 Tool Calling 有真实工具（add_expense / query_expenses），且能复用 Week 7 MySQL 技能 |
| LLM 供应商 | DeepSeek | 支付宝充值、学习用量成本几毛钱、OpenAI 兼容接口（换供应商只改 baseURL） |
| 通信方式 | SSE 流式 | Week 6 已学，LLM 流式事实标准 |
| 数据库 | 暂不引入 | 控制复杂度，messages 先活在内存 |

### 已完成的工程搭建
- `client/`：Vite + React + TS + Tailwind v4，proxy 已配（`/api` → `localhost:3001`）
- `server/`：Express + TS + 4 层架构目录（routes/controllers/services/types），
  `tsx watch` 热重启，`.env` 安全策略就位（gitignore + .env.example 模板）
- DeepSeek 账号注册 + 充值 + API key 已获取

### 学到的概念
1. **messages 数据结构**：`{ role: 'user' | 'assistant', content: string }[]`
   LLM API 无状态，每次请求携带完整历史（类比 HTTP 无状态 + token）
2. **为什么不用假数据搭 Chat**：Harness 的核心工作（流式拼接、超时、
   取消、断连）只在真实链路上存在；Harness 之于裸 LLM ≈ service 层之于裸 SQL
3. **API key 安全**：key 即钱，泄漏到公开仓库会被爬虫秒扫；真 key 只存本地 .env

---

## 四、遗留 / 明日计划（Week 10 Day 4）

**昨日未完成（顺延为今天第一件事）**：
- [ ] `server/.env` 创建并填入 key
- [ ] `client/src/types/chat.ts`（Message 类型）
- [ ] `App.tsx`：messages state + controlled input + Enter 发送 + .map 渲染

**今日主菜**：
- [ ] 后端 `POST /api/chat`（route → controller → llmService 分层）
- [ ] llmService 调 DeepSeek 真实 API，SSE 流式转发
- [ ] 前端接 SSE + 打字机渲染，打通最简闭环
- [ ] Harness 补全启动：错误处理 / 超时 / AbortController 取消
