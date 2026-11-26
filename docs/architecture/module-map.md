---
title: 模块与代码地图
status: refactor/eng 源码重构与本地验收通过
updated: 2026-11-27
---

# 模块与代码地图

本页按“实际目录 → 职责 → 公开入口 → 允许依赖”说明代码落点。新增代码先判断属于哪个模块，再决定放在领域、应用、适配还是 feature；不要因为目录存在就预建空层。

## 顶层目录

| 路径                          | 职责                                                       | 关键入口                                                                           |
| ----------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/app/`                    | React 装配、订阅、显示时钟、生命周期、导航                 | `App.tsx`、`useApp.ts`、`runtime.ts`                                               |
| `src/application/`            | 跨域操作、唯一写入队列、状态快照、端口、编解码、恢复、导出 | `index.ts`、`createApplication.ts`、`ports.ts`                                     |
| `src/modules/time-tracking/`  | 核心域：周期、主睡眠、补觉、活动段、计时规则、格式化       | `index.ts`                                                                         |
| `src/modules/classification/` | 支撑域：分类标识、目录、颜色、两级层级、生命周期           | `index.ts`                                                                         |
| `src/modules/analytics/`      | 只读统计：起床日、周/月/年、趋势、分类聚合                 | `index.ts`                                                                         |
| `src/infrastructure/`         | Capacitor/浏览器/文件/原生桥/反馈适配                      | `platformStore.ts`、`wakeTimer.ts`、`files.ts`、`feedback.ts`                      |
| `src/features/`               | 四个页面 feature 及局部 UI                                 | `today/`、`history/`、`statistics/`、`settings/`                                   |
| `src/shared/ui/`              | 跨 feature 的通用控件与样式                                | `Sheet`、`Timeline`、`SegmentEditor`、`CategoryPicker`、`SplitWheel`、`MergeSlide` |
| `android/`                    | Java 原生计时权威、通知服务、PDF 导出、Capacitor 插件      | `timer/`、`export/`、`WakeTimerPlugin.java`                                        |
| `contracts/`                  | TS 与 Java 共用的合成行为案例                              | `timer-cases.json`                                                                 |
| `tests/`                      | 领域、应用、数据、契约、属性、差分、UI、E2E、工具配置测试  | 见下文                                                                             |
| `scripts/`                    | 工具链、架构门、差分、验证入口、MuMu harness               | `verify.mjs`、`differential.mjs`、`mumu-cli.mjs`                                   |
| `docs/`                       | 架构、ADR、项目状态、outcome、计划与预览                   | 本页所在目录                                                                       |

## `src/modules/time-tracking`

领域模型（`domain/model.ts`）：`Cycle`、`TimerSession`、`Segment`、`SleepMetrics`。`Cycle` 的 `id` 是按起床日生成的业务标识；`Segment.id` 在拆分/合并中保持稳定语义。

| 文件                      | 职责                                                                                        | 公开接口                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `domain/time.ts`          | 睡眠输入校验、`computeCycle`、`remainingMs`、按日切分、计时显示、`cycleIdFor`、`formatDate` | 同名导出                                                                                                 |
| `domain/segments.ts`      | 分类读取、缺口修复、段编辑、相邻段合并、`summarizeCycle`、`sanitizeSegments`                | 同名导出                                                                                                 |
| `domain/splitSegments.ts` | 快照校验、拆分输入与结果、稳定首 ID、开放尾段                                               | `snapshotOf`、`matchesSnapshot`、`splitSegments`                                                         |
| `domain/cycleIds.ts`      | 同日多周期的唯一 ID                                                                         | `uniqueCycleId`                                                                                          |
| `domain/cycles.ts`        | 旧数据清洗、开启下一周期时封口旧周期与睡前尾段                                              | `sanitizeCycle`、`closeForNextSleep`                                                                     |
| `format.ts`               | 时长/时刻/输入格式化                                                                        | `formatDuration`、`formatHuman`、`formatClock`、`formatDateTime`、`parseLocalInput`、`toLocalInputValue` |

允许依赖：`classification/index.ts` 的 `CategoryId` 类型；本模块内部文件。不得依赖 React、Capacitor、DOM、存储或 UI。

## `src/modules/classification`

| 文件                       | 职责                                                                       | 公开接口                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/categories.ts`     | 系统分类 ID、默认目录、颜色板、校验、补齐、两级树、增改停用/恢复、选择校验 | `CategoryId`、`CategoryDefinition`、`CategoryCatalog`、`defaultCategories`、`completeCategories`、`changeCategories`、`requireSelectableCategory` 等 |
| `domain/categoryColors.ts` | 已保存色 → 系统固定色 → 稳定 ID 哈希色                                     | `categoryColor`                                                                                                                                      |

允许依赖：本模块内部。**不得依赖 `time-tracking`**；需要引用分类的活动段由调用方把 `CategoryId` 传进来。

## `src/modules/analytics`

| 文件               | 职责                                        | 公开接口                                                                                                      |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `history.ts`       | 起床日、日指标、周/月视图、日历聚合         | `buildDayMetrics`、`buildWeeks`、`weekStats`、`buildMonthView`、`monthsWithRecords`、`summarizeDay`、日期工具 |
| `trends.ts`        | 睡眠趋势、相对参考截止漂移、窗口汇总        | `buildTrend`、`summarizeTrend`、`trendWindow`、`wakeDateOf`                                                   |
| `categoryStats.ts` | 周/月/年分类聚合、大类/细分、占比、周期切换 | `buildCategoryDayTotals`、`buildCategoryPeriod`、`categoryEntries`、`percentMap`、`summaryRows`               |

允许依赖：`time-tracking/index.ts` 与 `classification/index.ts` 的公开只读模型/查询。不得依赖 UI、存储或写入操作。

## `src/application`

| 文件                   | 职责                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `createApplication.ts` | 唯一业务状态与写入协调器；`getSnapshot`/`subscribe`、初始化、刷新、周期/段/分类/恢复/导出/设置操作；串行队列与 `safeToWrite`   |
| `ports.ts`             | `TimerPort`、`DevicePort`、`RecordStorePort`、`ClockPort`、`FilePort`、`FeedbackPort`、`ApplicationDeps`、`LiveState` 等窄接口 |
| `records.ts`           | `applyLiveState`（整份替换镜像、关闭旧周期、睡前尾段）、`updateCycle`、`closeCycle`                                            |
| `recordCodec.ts`       | schema 1/2/3 解析、归一化、未来版本拒绝、周期校验、恢复候选选择                                                                |
| `restore.ts`           | 备份读取、分类冲突、覆盖/合并、活动周期保护、空备份拒绝                                                                        |
| `exportFormat.ts`      | TXT、单日/全量 JSON、分类汇总文本、派生摘要                                                                                    |
| `pdfDoc.ts`            | PDF 段落块构建（渲染由原生导出）                                                                                               |
| `index.ts`             | 应用层公开接口；UI 只能从这里引用                                                                                              |

允许依赖：`modules/*/index.ts`、Node/浏览器都有的标准类型。**不得**依赖 React、UI、具体适配器、legacy `data/`、`native/`、`state/`、`export/`、`core/`。

## `src/infrastructure`

| 文件               | 端口/职责                                                                          |
| ------------------ | ---------------------------------------------------------------------------------- |
| `platformStore.ts` | 选择 Android `Filesystem` 实现或浏览器 `localStorage` 实现，返回 `RecordStorePort` |
| `recordStore.ts`   | 三文件安全写盘、每日备份保留 20 份、恢复候选、串行保存；浏览器单值实现             |
| `wakeTimer.ts`     | `WakeTimerPlugin` 注册，导出 `timerPort` 与 `devicePort`                           |
| `files.ts`         | 截图保存/URL、文本分享、PDF 分享                                                   |
| `pdfExport.ts`     | 原生 `PdfExport` 插件桥                                                            |
| `feedback.ts`      | 触感/音效实现，受设置开关控制                                                      |

允许依赖：`application/index.ts` 的端口类型、Capacitor 插件。不得反向被 application 依赖。

## `src/app`

| 文件                     | 职责                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| `runtime.ts`             | 组合根：实例化平台适配器、`createApplication`、前台订阅                     |
| `useApp.ts`              | `useSyncExternalStore` 订阅快照、显示时钟、初始化、前台刷新；不承载业务规则 |
| `App.tsx`                | 四个 tab、恢复横幅、开启第二天对话框                                        |
| `base.css` / `shell.css` | 基础 token 与外壳布局                                                       |

## `src/features`

| Feature       | 主要文件                                                                                           | 依赖                                                 |
| ------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `today/`      | `Today.tsx`、`SleepDialog.tsx`、`TodayCategorySummary.tsx`、`today.css`                            | `AppApi`、模块公开查询/格式化、`shared/ui`           |
| `history/`    | `History.tsx`、`HistoryWeekPanel.tsx`、`HistoryMonthPanel.tsx`、`HistoryCharts.tsx`、`history.css` | `AppApi`、`analytics`、`shared/ui`                   |
| `statistics/` | `Stats.tsx`、`CategoryStatsPanel.tsx`、`CategoryManager.tsx`、`statistics.css`                     | `AppApi`、`analytics`、`classification`、`shared/ui` |
| `settings/`   | `Settings.tsx`、`Export.tsx`、`CycleSummary.tsx`、`settings.css`                                   | `AppApi`、`application` 的恢复/冲突类型              |

UI 不直接调用文件、计时、存储插件；所有写入走 `AppApi` 操作。显示格式化可以来自模块公开函数，但不在 UI 重新实现业务规则。

## `src/shared/ui`

`Sheet`、`Timeline`、`SegmentEditor`、`SegmentSplitter`、`SplitWheel`、`MergeSlide`、`CategoryPicker` 及对应 CSS。这里只放跨 feature 的通用 UI；不放领域模型、存储或“杂项工具”。

## Android 原生

| 路径                                                     | 职责                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| `timer/TimerRepository.java`                             | 活动计时状态机，注入 `Clock`/`KeyValueStore`，快照校验后提交 |
| `timer/TimerEnv.java`                                    | Android `SharedPreferences`/墙钟/单调钟/开机标识适配         |
| `timer/TimerService.java`                                | 前台服务与通知，必要时在无 WebView 时处理操作                |
| `timer/TimerNotifications.java`                          | 常驻通知与通知栏交互                                         |
| `timer/TimerMath.java`                                   | 原生侧时间与统计计算                                         |
| `timer/TimerState.java`                                  | 原生状态模型                                                 |
| `WakeTimerPlugin.java`                                   | JS ↔ 原生计时状态插件                                        |
| `export/PdfExporter.java`、`export/PdfExportPlugin.java` | PDF 生成与插件                                               |

原生保留：活动计时的唯一权威、单调时钟/开机标识、通知栏入口、快照并发校验。不要为了目录对称把历史 JSON 迁移进原生存储。

## `contracts/` 与测试

| 路径                         | 内容                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `contracts/timer-cases.json` | TS/Java 共用合成案例：24 个案例（`common` 12、`java-only` 8、`divergence` 3、`ts-only` 1），共 53 步 |
| `tests/modules/`             | 模块公开接口与纯领域行为                                                                             |
| `tests/core/`                | 迁移后的既有领域测试（兼容入口）                                                                     |
| `tests/application/`         | 无 React 的应用协调、队列、失败语义、导出                                                            |
| `tests/infrastructure/`      | 安全写盘/恢复、时钟注入、平台适配                                                                    |
| `tests/data/`                | 迁移/恢复/活动镜像/私人样本 opt-in                                                                   |
| `tests/contracts/`           | TS 侧共享契约运行器                                                                                  |
| `tests/property/`            | fast-check 属性，独立 oracle，seed/path 可重放                                                       |
| `tests/differential/`        | 黄金查询与独立预期                                                                                   |
| `tests/ui/`                  | React Testing Library 页面/交互                                                                      |
| `tests/e2e/`                 | Playwright 浏览器 E2E（不是原生验收）                                                                |
| `tests/tooling/`             | 架构自检 fixture、runner 配置、RTL setup                                                             |

测试只使用合成 fixture；私人样本必须显式 opt-in。生产备份只通过 `scripts/differential.mjs --backup` 本地只读读取。

## `scripts/`

| 脚本                                                                              | 用途                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `verify.mjs`                                                                      | 本地验证入口：check / strict / property / private / baseline / mumu |
| `require-baseline.mjs`                                                            | 检查隔离 8307835 基线目录                                           |
| `differential.mjs`                                                                | 旧实现 vs 候选；自检、合成案例、可选生产备份                        |
| `differential-baseline.ts` / `differential-candidate.ts`                          | 固定两侧真实入口的绑定，不做结果归一化                              |
| `arch-rules.mjs` / `arch-strict.mjs` / `arch-selftest.mjs`                        | 依赖规则、严格门、规则自检                                          |
| `mumu-cli.mjs`                                                                    | MuMu 设备 harness：identity/observe/snapshot/scenario/upgrade       |
| `mumu-guard.mjs`                                                                  | 实例身份校验、显式 serial、命令白名单                               |
| `mumu-data.mjs` / `mumu-observe.mjs` / `mumu-scenarios.mjs` / `mumu-selftest.mjs` | 快照比较、观察、场景、假设备自测                                    |
| `env.ps1`                                                                         | 固定 JDK21 / Android SDK / Gradle / npm 缓存                        |
| `patch-vite.mjs` / `download-toolchain.mjs`                                       | 沙箱构建工具链兼容                                                  |

## 新增功能的落点

| 改动              | 落点                                                | 不要放在                          |
| ----------------- | --------------------------------------------------- | --------------------------------- |
| 新的纯计算/规则   | 对应模块 `domain/`，从 `index.ts` 选择导出          | UI 组件、application 协调器       |
| 跨域用例/写入顺序 | `src/application/createApplication.ts` 或新用例文件 | feature 组件、store 适配器        |
| 新的平台能力      | `ports.ts` 加窄接口 + `infrastructure/` 实现        | application 直接 import Capacitor |
| 页面/交互         | `src/features/<feature>/` + `shared/ui`             | `application` 或模块              |
| 原生计时/通知     | `android/.../timer/`，先加 Java 测试与共享契约      | TS 领域层                         |
| 新质量规则        | `scripts/arch-rules.mjs` 先 warn，再 strict         | 只写在文档里                      |
