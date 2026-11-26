---
title: 架构总览
status: refactor/eng 已完成源码重构，本轮按现有验收证据收尾
baseline: 8307835 / v0.9.0 / schema 3
updated: 2026-11-27
---

# 架构总览

本文是工程重构后的代码地图入口。它描述**实际存在**的目录、依赖方向、运行时所有权和验证方式，不替代产品说明（[README](../../README.md)）、当前状态（[STATUS](../project/STATUS.md)）或领域语言（[GLOSSARY](../../GLOSSARY.md)）。

## 目标与边界

- 行为保持：以 `8307835`（v0.9.0）的业务行为、统计口径、导出含义和 schema 3 数据为基线；不借目录调整改变数据含义。
- 运行形态不变：React 19 + TypeScript + Vite + Capacitor + Java 原生插件，APK 内离线运行，无账号、无服务端。
- 工程目标：领域优先、模块边界可执行、应用操作脱离 React 可测、平台差异集中在窄端口、验证可重复。
- 非目标：更换技术栈、引入 SQLite/Redux/Zustand、迁移原生计时所有权、增加联网同步或远程 CI。

## 分层

```text
┌──────────────────────────── src/features/* ────────────────────────────┐
│ today / history / statistics / settings：页面、局部交互、展示状态       │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ 只依赖 AppApi 与模块公开 index
┌───────────────────────────────▼────────────────────────────────────────┐
│ src/app/                                                                │
│ App / useApp / runtime：React 订阅、显示时钟、生命周期、组合根          │
└───────────────────────────────┬────────────────────────────────────────┘
                                │ createApplication(...)
┌───────────────────────────────▼────────────────────────────────────────┐
│ src/application/                                                        │
│ createApplication：唯一业务状态与写入队列；records / restore /            │
│ recordCodec / exportFormat / pdfDoc；ports.ts 定义平台窄接口             │
└───────────────┬───────────────────────────────────┬────────────────────┘
                │ 纯领域调用                         │ 端口注入
┌───────────────▼──────────────────┐   ┌────────────▼────────────────────┐
│ src/modules/                     │   │ src/infrastructure/             │
│ time-tracking（核心域）           │   │ Capacitor 文件/分享/PDF/反馈、   │
│ classification（支撑域）          │   │ 原生 WakeTimer 桥、平台存储适配  │
│ analytics（只读分析）             │   └────────────┬────────────────────┘
└──────────────────────────────────┘                │
                                                    ▼
                                    android/ Java TimerRepository / TimerService
                                    （当前活动计时的唯一权威）
```

依赖方向固定为：`features → app`（操作/订阅）与 `features → modules`（只读查询）；`app → application → modules`；`infrastructure` 实现 `application/ports.ts`，由 `app/runtime.ts` 注入。模块之间只能通过各自的 `index.ts` 公开接口引用。

## 运行时装配

- 组合根：`src/app/runtime.ts` 创建平台存储、计时、设备、文件、反馈端口，调用 `createApplication`。
- React 订阅：`src/app/useApp.ts` 用 `useSyncExternalStore` 读取稳定快照；React 只负责显示时钟、前台事件转发和操作调用。
- 唯一业务状态：`createApplication` 持有 `AppSnapshot`、写入队列和 `safeToWrite` 门禁，见 [createApplication.ts](../../src/application/createApplication.ts)。
- 平台适配：`src/infrastructure/wakeTimer.ts` 封装 `WakeTimerPlugin`；`platformStore.ts` 选择 Android 文件存储或浏览器 `localStorage`；`files.ts` 封装分享/PDF/截图；`feedback.ts` 封装触感与音效。

## 真相来源与所有权

| 状态                           | 权威来源                                                           | 镜像/消费方                       | 说明                                              |
| ------------------------------ | ------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------- |
| 当前活动计时、当前周期活动段   | Android `TimerRepository`（`SharedPreferences("waketime_timer")`） | TS `LiveState` → `data.json` 镜像 | 原生先提交；回前台/刷新时整份替换镜像，不拼接旧段 |
| 历史周期、设置、分类目录       | TS `AppData`（`data.json` / 浏览器 `localStorage`）                | 应用操作与 UI                     | 原生 idle 时仍由 TS 负责历史编辑                  |
| 周期派生值（预算、截止、睡眠） | 纯领域函数 `computeCycle`                                          | 应用与导出                        | 不持久化第二套计算                                |
| 分类目录                       | `classification` 纯领域 + 设置                                     | 活动段按稳定 `CategoryId` 引用    | 删除有引用分类只停用                              |

详细写入顺序、恢复路径和已知基线行为见 [data-lifecycle.md](data-lifecycle.md)。

## 模块公开接口

- `time-tracking`：周期/段模型、`computeCycle`、`summarizeCycle`、段编辑/拆分/合并、睡眠输入校验、格式化。
- `classification`：`CategoryId`、分类目录、颜色、层级、增改停用/恢复、选择校验。
- `analytics`：周/月/年统计、趋势、分类周期聚合；只读消费周期与分类目录。

完整导出见 [module-map.md](module-map.md)。

## 依赖规则（可执行）

规则定义在 [scripts/arch-rules.mjs](../../scripts/arch-rules.mjs)，配置在 [.dependency-cruiser.mjs](../../.dependency-cruiser.mjs)：

- 禁止循环依赖。
- `src/modules/*/domain` 与 `analytics` 不得依赖 React/DOM/Capacitor、外层实现或 legacy 目录。
- 所有模块不得依赖框架、UI、装配、适配层或 legacy 实现。
- 跨模块只能引用对方 `index.ts`；模块外部消费者也只能引用模块 `index.ts`。
- `features`/`app` 只能引用 `application/index.ts`。
- `application` 不得反向依赖 UI、具体适配器、React 或 legacy store/native/state/export/core。
- `features` 不得直接访问持久化、原生桥、适配器或导出实现。
- `classification` 不得依赖 `time-tracking` 实现（调用方提供被引用 ID）。

`npm run arch:check` 使用观察模式（warn）；`npm run arch:strict` 把同一规则集提升为 error。规则自检在 [scripts/arch-selftest.mjs](../../scripts/arch-selftest.mjs)。

## 关键决定

- [ADR 0001：领域优先的模块化单体](../adr/0001-domain-first-modular-monolith.md)
- [ADR 0002：原生计时权威与 TS 历史权威](../adr/0002-native-timer-authority.md)
- [ADR 0003：schema 3 JSON 兼容与安全写盘](../adr/0003-schema3-json-safety.md)
- [ADR 0004：先观察后强制的可执行质量门](../adr/0004-observation-first-quality-gates.md)
- [ADR 0005：独立基线、差分与生产备份只读回归](../adr/0005-independent-baseline-differential.md)
- [ADR 0006：UI feature 边界与 AppApi 公开契约](../adr/0006-ui-feature-boundary.md)

## 验证入口

日常快速门与严格验收门见 [verification.md](verification.md)。最短命令：

```powershell
node scripts/verify.mjs check
node scripts/verify.mjs strict
```

项目级 verify skill 的权威文本在 [docs/skills/verify/SKILL.md](../skills/verify/SKILL.md)。`.claude/` 是本机忽略目录；如需要本地 skill，可自行复制，不把忽略规则或本机设置写进仓库。

## 当前证据状态

截至 2026-11-27，严格本地门全部通过：Vitest 229 通过 / 1 个私人样本显式跳过，浏览器 Playwright 6 通过，原生 JUnit 36 通过，26 组合成差分零差异；真实生产备份 **16 个周期 / 140 段，字段与分类目录差异为 0，原备份文件未改变**。

候选 debug APK 已构建并同测试签名覆盖安装，MuMu 核心计时、历史统计、编辑拆并、分类、周期及合成恢复等已实测。用户决定按现有证据收尾，剩余系统交互未验；正式生产签名缺失，不宣称完整 E2E 或正式发布通过。详见 [验收记录](../outcomes/2026-11-27-engineering-refactor-acceptance.md)。
