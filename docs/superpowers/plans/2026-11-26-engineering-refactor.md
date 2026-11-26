# Waketime Engineering Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目按用户已选择的 Dynamic Workflow 组织任务，在每个依赖点交接；无需因该流程创建提交。

**Goal:** 在保留 v0.9.0 产品行为、数据兼容与安卓离线计时能力的前提下，把 Waketime 改造为易演进、可独立验证的领域优先工程。

**Architecture:** 轻量 DDD、模块化单体、纯函数领域模型、跨域应用操作和显式平台端口；React 负责订阅与展示，Java 原生权威活动计时不变。验证工作线先固化行为基准，并与开发独立；E2E 能力调查不阻塞纯 TS 领域工作。

**Tech Stack:** React 19、TS 5.9 strict、Vite 8、Capacitor 8、Java/JDK 21、Gradle 8.14.3 / AGP 8.13.0；ESLint、typescript-eslint、React Hooks、Prettier、dependency-cruiser、Vitest、fast-check、React Testing Library、Playwright、JUnit；MuMu（ADB / Computer Use）。选择与锁定现有栈兼容的开发工具版本。

**Spec:** [工程演进调研与 27 项已确认决定](../../outcomes/2026-11-26-engineering-architecture-research.md)、[领域语言](../../../GLOSSARY.md)、[v0.9.0 已验证行为与数据约束](../../project/STATUS.md)。

## Global Constraints

- 工作分支 `refactor/eng`，固定参照 Git `8307835`。保留当前用户与其他代理修改；不提交、不推送、不合并到 main。不启动实际手机操作。
- 保持包名 `com.personal.waketime`、现有签名身份、schema 3、兼容 schema 1/2、导出 JSON/TXT/PDF 的业务含义及既有交互。交付候选版本号由发布任务协调，正式发布另获授权。不可为调整代码目录改变数据含义。
- 不联网、不引入账号、服务端、SQLite 迁移、Redux/Zustand。保留 Android 活动状态所有权、原生单调时钟、通知栏无 WebView 时的操作；TS 历史与设置仍由 JSON 存储。
- 生产备份原文件只读、仓库外、路径由本地运行参数提供；不把备份、真实备注、私人截图或签名凭据放进 Git、日志或外部服务。所有修改数据的测试只能在合成 fixture、隔离内存/测试目录或明确识别的专用 MuMu 实例内进行。
- 验证者拥有验收契约，实施者不得删除检查、降低断言或将失败当成功；先基线后迁移。同一个检查三轮实质修复仍失败则升级，不能靠重试碰运气。新增规范先以观察模式检查，再在已整改代码上启用；不创建远程 CI 或自动发布。
- 每个共享写入区域一个所有者：package.json/lock 与工具配置、应用写入队列和数据协调、原生 Java、各 UI feature 有明确工作交接；同一模拟器一次只由一个验证者操作。构建任务使用固定 JDK 21 和现有签名路径，不暴露密钥。

## Review Focus

- 活动计时原生已成功但 JSON 镜像保存失败：不能显示全部成功或丢弃原生已提交数据，恢复路径可用（任务 1、4、7）。
- 通知栏并发修改与历史/活动编辑、开启第二天：旧快照不得覆盖更新记录，原生快照归档遵循原有行为（任务 1、4、7）。
- schema 1/2/3 导入、未来版本、坏主文件、空备份、分类冲突：保持合法记录、拒绝不兼容写入并保留可恢复数据（任务 1、4、7）。
- 时区/跨午夜、同日多周期、暂停空档、补觉、开放段：相同时间和输入下统计及行为与基线相符（任务 1、3、7）。
- Android 冷启动、退后台/进程恢复、通知栏备注、PDF/分享、覆盖安装：使用真实 APK 与数据读回确认，而非只验证浏览器（任务 2、6、7）。

## Target map

```text
src/
  app/                      # 装配入口、生命周期、React 订阅和导航
  modules/
    time-tracking/          # Cycle、Segment、主睡眠、计时、历史/活动规则
      domain/
      application/         # 单领域用例（按需）
      index.ts              # 明确筛选的公开接口
    classification/         # CategoryId、CategoryCatalog、目录规则
      domain/
      application/         # 按需
      index.ts
    analytics/              # 统计查询：纯读取
      index.ts
  application/              # 跨域操作、状态协调、队列、ports、备份与导出
  infrastructure/           # Capacitor、浏览器、文件、原生桥、反馈
  features/                 # today/history/statistics/settings UI 与局部状态
  shared/                   # 通用 UI 和技术无关工具（不放领域垃圾桶）
android/                    # 保留 Java 原生计时权威及插件契约
contracts/                  # TS / Java 共用的合成行为案例
tests/                      # 领域、应用、契约、属性、差分、UI、E2E
scripts/                    # 可重复验证与既有构建工具
```

目录名为目标组织，不预建无内容层。领域只能消费其他领域公开的、纯领域接口；`classification` 不依赖周期实现（由调用方提供被引用 ID）；分析依赖周期与分类公开的只读模型/查询；跨域更新集中应用层。明确共享的分类 ID 归属，避免循环。UI 不直接持久化或调用计时业务插件；平台专有设备信息、权限、文件选择和分享同样通过窄接口。细节不要求每个操作建 class 或每个类型一份 mapper；仅在数据/运行时契约确实不同处转换。

## Execution graph

```text
0 工具链 ──> 1 冻结行为基线 ──> 3 领域模型 ──> 4 应用与适配 ──> 5 UI
  │            │                  │                 │            │
  ├── 2a ADB / 2b Computer Use 能力调查 ──> 6 MuMu E2E 准备       │
  │            └────独立属性/差分测试持续推进──────────────────────┤
  └─────────────────────────────────────────────────────────────┴─> 7 集成验收 ──> 8 文档与交付
```

0、1 是源码迁移依赖；2a/2b 可与 0、1、3 异步，只有安装/真实交互步骤依赖 APK、设备身份及设备独占权。不要求两条路线同时成功，但完整原生 E2E 是交付验收项，若两条均受限则保留未通过状态并报告具体缺口。1 确定稳定契约后验证者可以编写后续测试；不得按修改后的实现倒推预期。每一任务结束需提供实际执行证据和未通过项；不能跳过失败的上游依赖直接宣告完整成功。

## Task 0 — 工具链与质量门入口

**Files:** `package.json`、`package-lock.json`、`tsconfig.json`、`vite.config.ts`、现有 `scripts/env.ps1`、新增 `eslint.config.*`、Prettier 配置、dependency-cruiser 配置。一个工具链所有者负责依赖安装与配置。

- [ ] 确认工作区、现有 Node/npm 与 `.toolchain` 安装、JDK 21、SDK、Gradle。按现有锁文件恢复依赖（`npm.cmd ci`）；不读取签名密码。执行 `npm.cmd test`、`npm.cmd run build`，报告实际通过/跳过/失败；旧私有 fixture 缺失不算通过。
- [ ] 将基线源码以只读方式固定到隔离的本地临时目录（例如从 `8307835` 的 `git archive` 生成独立树，不切换当前分支）；只安装其锁定依赖。建立独立旧版运行入口，防止后续迁移污染参照。
- [ ] 安装兼容的 ESLint、Prettier、dependency-cruiser、fast-check、React Testing Library、Playwright 等 dev deps。定义 `typecheck`、`lint`、`format`、`format:check`、`arch:check`、`test:e2e`、`check`；`check` 不修改源码。保留原有命令。验证至少一个错向 import 可被检查器识别，允许尚未迁移旧目录在观察模式记录，最终移除旧目录例外。
- [ ] 使用 `scripts/env.ps1` 所设环境执行原生基线单测 `:app:testDebugUnitTest`，检查构建路径；工具缺失/缓存问题明示，不升 JDK 或更改已有签名来绕过。

**Acceptance:** 既有基线可运行或有清楚、受影响范围明确的环境阻塞；新开发工具由锁文件固定；后续代理使用同一命令和工作目录。保留环境中有价值的未跟踪资产。

## Task 1 — 独立行为契约与基线

**Files:** `tests/fixtures/`（保留现有 `tests/fixtures.ts` 的兼容入口直到迁移完成）、`contracts/`、`tests/property/`、`tests/differential/`、`scripts/` 中独立回归入口。Java 共享契约测试放 `android/app/src/test/`，但 Gradle 配置由工具链所有者串行协调。

**Interfaces:** 输入使用现有 `Cycle`、`Segment`、`CategoryDefinition`、`AppData`、`LiveState` 或其当前 JSON 形状；独立验证入口接受 baseline/candidate 或基线结果，以及可选 `--backup <path>`；生成合成数据/非私人差异摘要。对时间有关的函数显式提供固定 `nowMs`、测试进程固定时区。基线和候选调用相同接口语义，不共享候选实现来产生预期。

- [ ] 阅读确认的 STATUS 与 v0.9.0 源码契约，冻结关键行为：合法周期/段不丢失；同一天多个周期；补觉、清醒与分类守恒；开放段、拆并段和分类树；导出恢复往返；原生历史操作差异。现有 `tests/core`、`tests/data`、`TimerRepositoryTest` 保留用例语义。
- [ ] 合成 schema 1/2/3 fixture 取代必需的私有样本依赖，明确测试损坏主文件、未来 schema、空备份覆盖、活动周期保护与分类冲突。原私有迁移测试改为明确的 opt-in 本地验证，不默认假装执行。
- [ ] fast-check 属性：生成合法及拒绝路径、保存 seed/path/最小反例。拆分保持外边界及原 ID；合并不填空档；`totalSleepMs === mainSleepMs + napMs`、分类合计等于清醒时长（合法数据与固定 now）；两层分类树无环；迁移与导出恢复保留合法字段。对已知基线不满足的更强属性记录反例，不能通过放宽原有行为隐藏回归。
- [ ] 差分 harness 调用真实旧实现与候选，固定时间和时区，比较完整周期/分类/备注/来源/统计/导出字段；仅排除明确不确定的导出时间戳等字段，开放段使用同一 as-of 时刻。先运行旧版对旧版与故意扰动的合成数据分别证明能通过和发现差异；运行属性测试确认 seed 可重放。
- [ ] 共享 TS/Java 行为案例涵盖段编辑、拆分、合并、补觉、单调时钟和陈旧快照拒绝；公共行为使用共同预期，平台专属和已有分歧分别声明。记录旧版合并备注 trim 与 source 行为等真实差异；不修改业务规则。
- [ ] 本地只读检查用户提供的生产备份结构并建立差分输入。不得输出真实记录内容。全量导出含 cycles/settings/派生汇总，不等于原生计时 XML 或截图文件；原生状态连续性由合成计时及覆盖安装测试单独验证。备份恢复本身有保留本机设置的契约，因此比较旧/新恢复结果而非要求所有导出设置无条件覆盖。

**Acceptance:** 独立测试能发现真实差异；正常数据无需私人样本即可运行；基线缺陷、预期差异和执行失败可区分。外部生产数据仅通过路径参数进入本地验证。

## Task 2 — MuMu 能力双路线试验（与任务 0/1/3 异步）

**Files:** `docs/outcomes/` 的能力调查记录、`scripts/` 中不含设备私有标识的可复用检测入口。先只读调查，不占用或重置用户现有实例，不安装到未确认目标。

- [ ] **2a ADB 代理：** 使用用户提供的 MuMu adb.exe 路径（运行时参数），查看版本、连接列表、明确测试 serial 与 MuMu 实例对应关系；所有后续设备操作使用 `-s <verified-test-serial>`。核实设备 Android 版本、APK 安装支持、`uiautomator dump`、`exec-out screencap -p`、输入与日志读取。不要盲扫端口、重启共享 ADB server 或将手机当模拟器；同一设备识别不清时停止写入。
- [ ] **2b Computer Use 代理：** 加载 `agent-desktop` 技能，执行 `agent-desktop status` 与 `agent-desktop skills get platform`，检查 MuMu 窗口 screenshot 和 accessibility tree，评估 Android 内部控件是否具有可定位语义。读取状态与截图先行，测试控制需持有设备独占权；若 headless 无可操作路径，只有用户明确允许的物理桌面输入才能使用 headed/坐标操作，不能把权限拒绝当技术问题绕过。记录 CLI、技能、OS 访问能力，不能把存在 CLI 等同于原生 App 可控。
- [ ] 待测试实例隔离确认后，协调两条路线顺序对同一测试 APK 做最小闭环：启动/观察首页、点击一个非破坏性的导航项、观察目标页、返回；再对合成记录完成一个写入、重启后读回的案例。ADB 优先选语义节点定位，坐标路径必须有当前画面/分辨率校验；Computer Use 按观察→动作→读回 loop 运行。测试 APK 不要求为完整重构版本，优先复用已有基线或任务 0 构建产物。
- [ ] 对照两条路线输出：PASS/BLOCKED/FAIL、实际证据、重复执行能力、稳定语义定位、视觉读取、资源冲突、权限限制、推荐作为日常质量门或探索式验证的角色。不能用只启动 App 或仅列出设备替代交互闭环。真实数据只在后续受控验收时导入测试实例。

**Acceptance:** 两条路线各有真实能力试验结论；选出可执行的原生验证主路线。主路线默认确定性 ADB + UI Automator/截图；Computer Use 适合探索和视觉验收，若更可靠可采用其为主体。不能实测的能力留明确阻塞，纯 TS 开发不等待它。

## Task 3 — 领域模型与公开接口

**Files:** `src/modules/{time-tracking,classification,analytics}/`；迁移 `src/core/{time,segments,splitSegments,cycleIds,categories,categoryColors,history,trends,categoryStats}.ts`、`src/data/store.ts` 的领域类型及 `src/native/contracts.ts` 的领域共享类型。各子域可并行准备，先由一个领域所有者确定类型归属与公开接口；依赖方按接口执行，不各自创建重复模型。

**Interfaces:** 保留既有 `computeCycle(CycleTimes): CycleDerived`、`summarizeCycle(Cycle, nowMs): CycleSummary`、`splitSegments(segments, segmentId, input, nowMs, makeId?): Segment[]`、`changeCategories(catalog, action, referencedIds): CategoryDefinition[]`、`buildDayMetrics(cycles, nowMs): Map<string, DayMetric>` 等既有函数名称和契约；`Cycle`/`Segment`/`CategoryDefinition` 成为纯领域类型，原生 DTO 与存储 DTO 在外层兼容。以 `index.ts` 公开经过选择的类型/操作；不将解析/恢复的外部副作用迁入领域。`feedback` 不再位于领域目录。

- [ ] 以既有 tests 的导入路径/临时 re-export 保持迁移期间构建可用。先迁移类型与纯逻辑，再替换调用方引用；不改计算公式和时间边界。
- [ ] 明确 `CategoryId` 的归属和系统分类语义，活动段稳定 ID 与分类目录生命周期分离。分类模块仅接收引用 IDs，不依赖存储、计时或统计模块。
- [ ] 将统计查询复用 `summarizeCycle` 及分类目录，保持起床日与周/月/年、细分/大类、睡前时间、导出等口径；显示格式和纯计算按实际消费者归属。
- [ ] 运行领域/属性/差分测试及类型检查；旧路径过渡保留到任务 4/5 完成后移除。架构规则针对已迁移域验证无框架依赖、无非法跨域引用、无循环。

**Acceptance:** 领域模块可在 Node 环境运行，无 React/DOM/Capacitor/具体持久化依赖；公开接口覆盖实际调用方；行为差分无未经批准的变化。

## Task 4 — 应用操作、状态与平台适配

**Files:** `src/application/`（应用操作、状态协调、ports、备份/恢复/导出与偏好）、`src/infrastructure/`（持久化和原生 bridge、文件、反馈）、`src/app/`（装配与 React 订阅）、`src/state/useApp.ts` 与 `src/data/{store,restore,files}.ts`、`src/native/*` 的相应迁移。整个写入/同步机制只有一个所有者，不按每个 hook 分派多个写者。

**Interfaces:** `RecordStorePort` 保留 `load(): Promise<LoadResult>` 与 `save(data: AppData): Promise<void>` 的安全语义；`TimerPort` 封装实际 `WakeTimerPlugin` 的计时方法与能力判断（设备权限/信息可分窄接口），原生方法签名保持不变；注入可控时钟和真实文件/截图/分享能力。应用状态对 React 提供 `getSnapshot()` 与 `subscribe(listener): unsubscribe`，及明确的业务操作接口，原有 `AppApi` 行为可先作为适配入口。精确的 `AppSnapshot` 与动作参数由这一所有者根据既有 `AppApi` 确定并交接给 UI，不暴露任意全局状态修改；`getSnapshot` 在没有变化时返回同一引用。

- [ ] 独立测试固定 `startCycle`/`beginNextCycle`、lap、nap、edit/merge/split、end/restart/close、分类管理、恢复、持久化失败、前台 refresh。利用 fake timer/storage/clock，验证原生先提交/历史先保存的不同语义、队列串行、禁止不安全写入、通知栏最新快照与当前周期保护。
- [ ] 迁移 `useApp` 的纯业务编排、数据 ref、队列与错误状态到框架无关应用模块；React 只订阅、管理显示 tick/生命周期与操作转发。避免每域独立写入持久化、副本竞争或反向 import。
- [ ] 封装 `store.ts` 的 schema 解析、安全写盘、tmp/prev/备份恢复，保持未来 schema 拒绝和合法旧数据；隔离 BrowserStorage 和 Android 文件实现。旧 schema 与现有 JSON/插件 ABI 保持兼容。
- [ ] 原生层保留 `TimerRepository`、`TimerEnv` 与 `TimerService` 的状态/时钟机制；若需要结构调整，先保留 Java 测试且同步契约，禁止静默修改已知差异。Web 计时能力不足的原有行为不因测试 adapter 变成未经批准的产品功能。
- [ ] 应用用例和存储中断测试、属性/差分、TS 类型检查、原生测试（原生改动时）全部执行，向 UI 所有者交付实际公开接口及错误/加载/订阅约定。

**Acceptance:** 无 React 或实际 Android 即可测试完整业务操作，当前/历史数据所有权与故障语义保持；UI/适配器不绕过统一业务写入路径。

## Task 5 — UI Feature 化与样式整理

**Files:** 原 `src/pages/`、`src/components/`、`src/styles*.css`、`src/App.tsx`、`src/main.tsx` → `src/features/{today,history,statistics,settings}`、`src/app/`、`src/shared/`。UI 所有者可按不重叠 feature 分工；共用 UI、样式和装配由一个协调者合并。

- [ ] 基于现有截图/页面交互编写 React Testing Library/Playwright 关键回归（合成记录，不使用真实备注）。今日、历史、统计、设置均能通过统一应用状态工作；错误/加载反馈不丢失。
- [ ] 迁移页面及业务专属 UI，公共 Sheet/控件放共享目录；页面依赖应用操作和领域只读查询，不直接调文件/计时插件写状态；保留原入口、按钮、滚动/滑动、统计下钻、分类管理、导出/恢复的交互。
- [ ] 将三份版本增量样式按基础/公共/feature 职责整理；保持层叠顺序和视觉基线，不能仅因格式化改动而重画 UI。比较 375×812 与 360×800 浏览器截图、横向溢出和关键控件。
- [ ] 移除迁移期间旧路径 re-export、无用代码；依赖图不留双套实现。运行 UI/E2E、类型、lint、format check、arch check 以及相关领域/应用测试。

**Acceptance:** 现有页面与操作路径保持，应用操作接口足以支持所有调用者；没有跨域私有引用和新增重复状态。浏览器 E2E 不能代替原生验收。

## Task 6 — 可重复 MuMu E2E 与项目 verify 入口

**Files:** `scripts/` 下按选定路线实现 MuMu 执行器，`tests/e2e/`、`playwright.config.*`、项目级 verify skill 与质量检查清单；MuMu/备份路径仅以运行参数或本地未跟踪配置提供。

- [ ] 根据任务 2 已实测能力选择主路线，另一线作为补充；所有安装/导入/操作仅在已授权专用测试实例。每次操作记录设备身份、APK 版本、输入类别、步骤与结果。设备忙或身份不明时停止设备操作，不阻塞独立验证。
- [ ] 实现基线与候选 APK 的可重复操作：录入主睡眠→计次备注→补觉→结束/重启计时→编辑拆分合并→新周期；分类增改停用与统计明细；通知栏直接回复与前后台/进程恢复；备份导出恢复、TXT/PDF 与分享；旧 APK 覆盖安装新 APK 且状态连续。合成数据可重建；真实数据只做只读基准/隔离副本恢复。
- [ ] 验证不仅截图：检查实际 UI、业务结果、持久化回读、错误日志；必要时真实 GUI 探索用独立代理的有限 observe-act-verify loop，不把探索结果当确定性自动化测试的同义词。若某项无法验证（例如模拟器触觉），明确证据边界和剩余真机条件。
- [ ] 提供一个项目级 verify 入口，按改动选取领域/应用/数据/契约/UI/原生等检查，并支持完整验收；自动化测试不可改变验收规则或通过静默重试隐藏失败。规范更新先观察再拦截。

**Acceptance:** 主路线可重复运行实际 APK 操作并产出读回证据；仅内部测试数据和非私人报告随项目保存。两条路线不足以完成 E2E 时明确阻塞，而不是宣布完成。

## Task 7 — 独立集成验收

**Files:** 集成后的全部源码与测试、`docs/outcomes/` 的验收记录；验证者不直接修改所评判的实现或验收契约，向实现所有者返回失败证据。

- [ ] 运行 `npm.cmd run check`、`npm.cmd run build`、`npm.cmd run test:e2e`、属性与差分检查、原生 JUnit；验证 arch 门禁不保留旧目录例外。明确测试数量、失败、跳过原因、实际运行版本。完整验收必须运行三类验证，不能凭历史报告冒充实测。
- [ ] 使用用户提供的仓库外生产全量备份，固定 now/时区比较旧/新实现：周期/段全部 ID、毫秒边界、备注/分类/来源、分类层级、统计查询、恢复/导出数据。原文件不写；任何差异注明是基线已有行为还是回归，后者必须修复，无未经批准的语义差异。
- [ ] 使用现有工具链生成候选 debug/release APK，核实兼容包名与签名身份（不披露密钥）；在专用 MuMu 中完成任务 6 全部关键路径、覆盖安装与数据回读。保留实际设备日志/测试证据（私人信息不写公共报告）。不得对实际手机安装或清除。
- [ ] 发现失败由原实现所有者修复，并由验证者按相同验收标准复验；同一检查三轮未通过升级给主代理/用户。最后检查全部已确认需求，资料缺失与未运行项目标明；不以部分通过宣称完整交付。

**Acceptance:** 领域结构与依赖规则、应用独立测试、既有行为、全部质量门、属性、差分、生产备份回归、MuMu APK E2E、APK 构建均有证据，未经批准的业务差异为 0。若 MuMu 环境不可用，候选可生成但原生验收仍未完成。

## Task 8 — 工程知识与交付

**Files:** `docs/architecture/{overview,module-map,data-lifecycle}.md`、必要的 `docs/adr/`、`AGENTS.md`（用户已确认的规约，含来源/范围/验证/回滚）、`README.md`、`docs/project/{INDEX,STATUS}.md`、`GLOSSARY.md`、`docs/outcomes/` 最终验收报告与根目录约定的 APK。

- [ ] 依据实际最终结构更新代码地图、依赖与生命周期、开发命令与验证入口；关键难逆决定记录 ADR，术语定义与实现保持一致，不复制私人数据与机器路径到追踪文档。用可执行检查支撑规则。
- [ ] 交付 APK 及真实测试/数据回归报告、当前分支与未完成验收项。对所有新增/变更文件执行 `git diff --check`、审查完整差异；不提交、不推送、不自动发布或真实手机安装。

**Acceptance:** 后续开发者/AI 能从权威项目文档定位模块、运行相关检查、理解数据安全和回归方式；本次完整交付按任务 7 证据判断。
