# Week 10 · Day 4 工作日报

**实习生**：张效涵
**主线**：Stingy 后端半程打通（真实 LLM 流式链路点火成功 🚀）
**侧线**：SmartShot Safe Area & 弹窗交互优化（`16c53e90` 已推送）

---

## 〇、SmartShot 真实业务（侧线，独立交付 ✅）

**分支** `fix/safe_area_and_close_tap_target` → **提交** `16c53e90`（已推送，基线 master@9bc889d8），9 文件 +34/−22

**需求 1 · 底部白条**：搜索/列表页底部白色横条 = Wrapper HOC 的
`bottomArea + bottomWhite` 渲染的 iOS 安全区。按老板规则（无底部按钮→去掉，
有吸底按钮→保留）关掉 6 个无按钮页面的 `bottomArea`。
关键发现：有按钮页面由 FixedView 自行预留 safe-area-inset，不依赖白条 →
只改无按钮页，规则自动满足，零波及。刻意不动：Profile、exam 深色安全区、
VenueDetail、Wrapper 默认值。

**需求 2 · 弹窗关闭按钮热区**：TreeSelectField 的 × 仅 32rpx（≈16pt），
低于 Apple HIG 44pt。用 **padding + 负 margin** 热区模式扩到 88rpx≈44pt，
视觉零变化；优于透明盒子方案（无 z-index 管理、热区永不错位）。

**顺手修复**：2 处存量 TS 报错（CpcStandings 参数类型 Omit 严格化、
MatchSearch CSS 变量 @ts-ignore 对齐姊妹页写法）。

**验证**：逐页 grep 确认无 fixed 底部元素依赖；tsc src/ 零报错；
纯配置翻转零运行时漂移。⚠️ 待真机回归 6 页 + 弹窗按钮。

---

## 一、今日里程碑

**人生第一次真实 LLM 流式调用成功**：
curl → Express → DeepSeek → SSE 逐块流回终端，`data: "..."` 逐行蹦出，
以 `data: [DONE]` 收尾。后端半程完整能打。

```
✅ 输入 → 后端 → DeepSeek → 流式回来   （后端半程，今天）
⬜ 前端 fetch + 拆信封 + 打字机渲染     （前端半程，明天）
```

## 二、完成清单

### 前端（补 Day 3 遗留）
- `client/src/types/chat.ts`：Message 类型（Role 联合类型白名单）
- `App.tsx`：messages state + controlled input + Enter/按钮发送 +
  气泡列表渲染（外层管对齐/内层管长相双 div 结构），验收通过

### 后端（今日主菜）
- `index.ts`：dotenv 副作用导入 + Express + CORS + 路由挂载
- `routes/chat.ts`：POST /（前缀由挂载点提供）
- `controllers/chat.ts`：输入校验（400）→ SSE 三件套响应头 →
  `for await` 接流 → `res.write` 逐块转发 → `[DONE]`/`[ERROR]` 收尾
- `services/llm.ts`：OpenAI SDK + baseURL 指向 DeepSeek，`stream: true`
- 分段验证策略：先假响应测通路（curl 200/400 两条路径），再接真 LLM

## 三、今日踩坑实录（含修复）

| 坑 | 根因 | 修复/教训 |
|---|---|---|
| `data: [ERROR]` | DeepSeek 账户 402 余额不足 | 二分法排查：裸 curl DeepSeek 绕过自家代码，30 秒定位"账户问题非代码问题"；充值后通过 |
| IDE 报 Cannot find module './routes/chat.js' 但 curl 正常 | tsconfig `moduleResolution: bundler` 不认 .js→.ts 映射 | 改为 `NodeNext`；口诀：client 用 bundler，server 用 NodeNext；运行时正常 ≠ 类型检查通过，两套规则要对齐 |
| `role: 'uses'` typo | — | Role 联合类型编译期抓住；类型是"提前爆炸的炸弹" |

## 四、今日概念清单

1. **两段流接力**：DeepSeek→server（SDK chunk，for await 接）；
   server→前端（SSE 信封 `data: ...\n\n`，res.write 发）。
   controller = 中转站，来一块泼一块，不存不等
2. **res.write vs res.json**：打电话 vs 发短信；res.end() 才挂断
3. **[DONE] 暗号**：应用层协议，前后端自己约定；借用 OpenAI 惯例
4. **token 实感**："DeepSeek" 被切成 Deep/Se/ek 三块到达；
   输入+输出都按 token 计费
5. **LLM 无状态深化**：连 AI 自己的回答都要发回去，否则"人格分裂"；
   全量重发 → 越聊越贵 + context 上限 → Context 优化的存在理由
6. **SDK 使用方法论**：文档 Quick Start 抄示例 + TS 自动补全探索，
   不靠背 API
7. **模型参数时效性**：context window 等数字几个月一变，
   以官方 API 文档当天页面为准（学员质疑 64K 过时，查证确认正确）

## 五、复盘 Quiz 结果

6 题：2✅ 3🟡 1❌（详见 week10-day4-questions.md，共记录 14 问）
明早重考：二分法排查（❌）、副作用导入名字、AI 回答为何要发回、token 计费

## 六、明日计划（Week 10 Day 5）

- [ ] 晨间重考 4 题
- [ ] SmartShot：真机回归 6 个列表页（白条消失/末尾文案不被 home indicator 遮挡）+ 弹窗关闭热区
- [ ] 前端半程：fetch POST + 读流 + 拆 SSE 信封 + [DONE]/[ERROR] 处理
- [ ] 打字机效果渲染（复用 Week 6 setInterval/useRef 经验）
- [ ] 闭环验证：浏览器里完整跑通"输入→流式回答→打字机"
- [ ] Eval prep：贡献清单草稿启动（原 Day 5 计划项）
