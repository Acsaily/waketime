---
date: 2026-11-26
status: 工程调研，架构方案待讨论
branch: refactor/eng
baseline: 8307835 (v0.9.0)
---

# 工程演进调研：Waketime

## 目的与阶段

判断当前工程是否需要重构，以及 其他工程的 DDD 结构中哪些经验值得迁移。预期产出为源码证据、架构取舍和后续决策议程；本阶段不改业务代码、数据格式或发布版本，不安装 APK。

**判断：CONTINUE + REUSE。** 延续已验证的 v0.9.0 行为与现有工程守则；重用成熟的领域计算、原生计时与数据恢复机制。新工程结构属于待确认设计。

## 1. Waketime 的现状（观察）

- React 19 / TypeScript 5.9 / Vite 8 / Capacitor 8；安卓 Java 插件、Gradle、JDK 21。APK 内离线运行，没有独立 HTTP 后端或账号。来源：[package.json](../../package.json)、[README](../../README.md)。
- Git 跟踪源码统计：44 个 TS/TSX 文件（6,265 行）、3 个 CSS 文件（1,916 行）、10 个 Android 主 Java 文件（1,504 行）；测试 13 个 TS 文件（1,220 行，含 fixture）、2 个 Android 单测 Java 文件（681 行）。行数含空行和注释，不作为质量评分。
- TS 目录按技术角色分为 `pages`、`components`、`core`、`data`、`native`、`export`、`state`。已有相当多纯计算函数，无须从零建立领域层。
- 当前 `App.tsx` 创建一个 `useApp` 并传给全部页面；设置与导出仍有直接调用 Capacitor 插件的路径。原生通知栏与 WebView 是两个入口，不是需要拆成两个部署服务的前后端。

### 真实运行链路

```text
React 页面 ── useApp（状态、编排和写入队列）
                  ├── pure core 函数
                  ├── store.ts ── JSON / localStorage
                  └── WakeTimer bridge ── TimerRepository ── SharedPreferences
                                                ↑
                                    Android 前台通知服务
```

活动计时的唯一真相来源为原生 `TimerRepository`；`data.json` 是历史记录、设置和原生活动状态的镜像。回前台刷新时用完整段快照替换，而非拼接；跨周期时收口上一周期、标记睡前待分配段。原生使用墙钟、单调钟和开机标识，通知栏在没有 WebView 时也可计次。来源：[useApp.ts:58](../../src/state/useApp.ts#L58)、[store.ts:342](../../src/data/store.ts#L342)、[TimerRepository.java:5](../../android/app/src/main/java/com/personal/waketime/timer/TimerRepository.java#L5)、[TimerEnv.java](../../android/app/src/main/java/com/personal/waketime/timer/TimerEnv.java)、[TimerService.java:90](../../android/app/src/main/java/com/personal/waketime/timer/TimerService.java#L90)。

### 工程改造机会（推断与建议，尚未采纳）

| 优先级 | 现有证据                                                                                                                                                                                                                                                                                                                                                                      | 建议与收益                                                                                                                                                    |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1     | [useApp.ts](../../src/state/useApp.ts) 343 行，返回全局 `AppApi`（第 319–343 行）；含读写门禁、异步队列、原生刷新、周期与分段用例、分类和恢复。不同路径有不同的落盘/状态发布顺序。                                                                                                                                                                                            | 抽出不依赖 React 的应用操作模块，统一管理操作顺序与数据安全；React 保留订阅、页面生命周期和展示状态。不是每个回调套一层空转类。                               |
| P1     | [store.ts](../../src/data/store.ts) 455 行，既定义 `Cycle`/`Segment`/`Settings`，又做 schema 解析与迁移、文件恢复、串行写入、活动镜像、周期业务规则。                                                                                                                                                                                                                         | 领域模型与规则独立于持久化格式；存储模块继续封装恢复与安全写盘。不要因为整理目录就更换数据源。                                                                |
| P1     | [segments.ts:1](../../src/core/segments.ts#L1)、[history.ts:1](../../src/core/history.ts#L1)、[categories.ts:1](../../src/core/categories.ts#L1) 从 `data`/`native` 取领域类型；`core/feedback.ts` 还直接依赖 Capacitor。                                                                                                                                                     | 将领域类型的所有权置于领域模块，平台适配依赖领域而非反向；当前类型 import 多数在编译时擦除，问题是模型归属与可维护性，不是已证实的运行时循环。                |
| P1     | [splitSegments.ts](../../src/core/splitSegments.ts) 与 [TimerRepository.java:140](../../android/app/src/main/java/com/personal/waketime/timer/TimerRepository.java#L140) 分别维护拆分规则；合并的 TS 实现会 trim 备注并传播 notification 来源（segments.ts:46–48），Java 的 mergeNotes 保留原始非空字符串，合并路径保留首段 source（TimerRepository.java:131–137, 323–330）。 | 活动/历史操作需要共同的行为规范及跨语言契约用例，先识别既有行为差异，再决定是否统一（不在纯结构重构中偷偷修正语义）；保留单调钟、快照并发校验等原生专有规则。 |
| P2     | [core/history.ts](../../src/core/history.ts)、[core/categoryStats.ts](../../src/core/categoryStats.ts)、[core/segments.ts:59](../../src/core/segments.ts#L59) 已集中清醒/补觉/按起床日聚合。                                                                                                                                                                                  | 以领域统计查询模块为中心，今日、历史、统计、导出复用语义；显示格式和图表交互留在 UI。                                                                         |
| P2     | [main.tsx](../../src/main.tsx) 按版本引入三份全局 CSS。`styles.css` 1,405 行，其余增量 CSS 511 行。                                                                                                                                                                                                                                                                           | 冻结外观，将样式按基础 token、共用样式、功能归属逐步整理，避免特意重画 UI。                                                                                   |
| P2     | [tsconfig.json](../../tsconfig.json) 已开启 strict、noUnused；[vite.config.ts](../../vite.config.ts) 用 Node Vitest；仓库无受跟踪的 lint/format 或 CI 配置。[phoneMigration.test.ts:9](../../tests/data/phoneMigration.test.ts#L9) 在私有备份缺失时跳过。                                                                                                                     | 保留严格 TS 与锁版本；增加稳定的非私有迁移 fixture、操作编排测试和依赖方向检查。先统一可复现的本地命令，不默认增加远程 CI。                                   |

### 已有工程资产（应保护）

- `TimerRepository` 已注入 `Clock` / `KeyValueStore`，同步操作在副本校验后提交；`TimerEnv` 做 Android 适配。它已有可测试的模块接口。`tests` 下的 TS 纯函数测试和原生 Java 测试是行为保全基础。需注意 Android `PrefsStore.put` 没有检查 `commit()` 的布尔返回值（`TimerEnv.java:35–37`），不能把现有同步调用等同于所有故障均有可靠回报；是否补救需单独决策与验证。
- `saveData` 串行写入，tmp/prev/主文件校验及备份恢复，来自未来版本的文件拒绝覆盖。恢复需要保护活动周期、处理分类冲突、拒绝空记录覆盖。来源：[store.ts:219–314](../../src/data/store.ts#L219)、[restore.ts](../../src/data/restore.ts)。
- 领域的已采纳语义，如起床日归档、补觉统计、稳定分类 ID、两层目录、停用不丢历史、分段不扩展原范围，详见 [STATUS](../project/STATUS.md) 与 [v0.8.0 outcome](2026-11-16-v080-category-hierarchy.md)。
- v0.8.0 提交涉及所统计范围内 38 个文件，后续两个小版本各 7 个文件。目录重构的理由是提高修改局部性，而非断言所有跨层修改都不合理（新增功能本来就可能涉及展示和领域）。来源：分别对 `4961ba9`、`2183b04`、`8307835` 执行 `git show --stat <commit> -- src tests android`。

### 当前验证状态

2026-11-23 v0.9.0 的已记录基线为 118 个 Vitest 测试、类型检查、APK 构建与真机数据回读通过。本轮尝试 `npm.cmd test`，本工作区没有 `node_modules`，无法找到 `vitest`；未重新安装依赖（本阶段只做架构调研），未声称新测试通过。实际实施前应先建立可重现基线。未读写个人备份或运行真机操作。

## 2. 对照工程的可复用结论

参考另一套工程的领域优先改造经验。完整的内部源码调研仅保留在本地工作记录中；本公开文档只保留适用于 Waketime 的设计结论。

- 按业务领域组织模块，使用明确的公开接口与组合根进行跨域协作。
- 在真实平台差异处注入依赖，通过独立测试验证行为，不为形式上的分层增加空接口。
- 先建立稳定行为基线，再迁移业务实现；架构规则应具有可执行的检查，而不仅是目录约定。
- 保持单机离线产品的运行形态，不照搬服务端通信、数据库、异步任务或部署体系。

## 3. 推荐方向与设计待决项

建议采用**轻量 DDD + 模块化单体 + Ports/Adapters**，保留现有运行栈。按真实领域组织，同时明确跨领域工作流的装配点。先以清醒周期/活动记录为核心领域、分类目录与统计查询为候选模块，备份恢复作为跨域应用操作；导出、通知、反馈是输出/平台能力，设置不必独立成为一个完整 DDD bounded context。最终模型和模块边界待领域讨论确认。

```text
React UI / features ────────> application operations + queries
                                    │          │
                                    v          v
                              domain model   ports (interfaces)
                                    ^          ^
                                    │          │
                              native / persistence adapters

Composition root: 装配 application 与具体 adapters
Java TimerRepository: 独立的活动计时状态机，通知与 Capacitor bridge 共用
```

依赖规则：TS domain 不依赖 React、Capacitor、DOM、存储 DTO；application 负责用例与写入顺序，调用 domain 与所需端口；infrastructure 实现端口；装配层注入具体 adapter。领域模块不必先包装成 class/Repository/Factory；只在真实 seam 提供小而完整的接口。Android 与 TS 之间的 JSON/插件契约、活动状态所有权和旧数据格式保持稳定。

优先讨论：

- 本次目标是纯工程重构，还是同时引入新的产品运行形态（跨端、联网同步等）？
- 是否保留现有 React / TS / Capacitor / Java，还是为了长期维护者熟悉度改栈？
- 是否定义 v0.9.0 行为与 schema 3 为不变基线，将已发现的语义差异单独决策？
- 是否将工程规范做成可执行的本地质量门，而不只写进文档？

## 4. 第一轮决策（用户已全部确认）

- Q1：纯工程重构，保留离线、无账号的产品定位，不引入联网同步等新功能。
- Q2：保留 React / TypeScript / Capacitor / Java，借鉴 对照工程的工程思想而非替换技术栈。
- Q3：v0.9.0 业务行为、界面、统计口径、schema 3 和兼容路径为基线；已发现的语义差异独立决策。
- Q4：建立可执行的本地工程质量门（类型、Lint、格式、依赖方向、回归测试），暂不引入远程 CI。

## 5. 第二轮决策（用户已全部确认）

- Q5：`time-tracking` 为核心域，统一作息周期、主睡眠、补觉、计时和活动段。
- Q6：建立根目录 [GLOSSARY.md](../../GLOSSARY.md)，统一领域语言，保持现有序列化契约。
- Q7：`classification` 为独立支撑域，拥有分类目录及生命周期；活动段引用稳定分类 ID，跨域操作由应用层协调。
- Q8：`analytics` 为只读分析模块，消费周期与分类目录，统一统计查询，不持有或修改原始记录。
- Q9：保留原生对当前活动计时的权威、TS 对历史及分类设置的权威，封装同步与并发控制，不迁移存储架构。

## 6. 第三轮决策（用户已全部确认）

- Q10：领域优先（`src/modules/{time-tracking,classification,analytics}`），域内按需分层；UI 按 feature 组织，跨域用例和装配独立。
- Q11：函数式领域模型为主，复杂生命周期与状态封装确有需要时才使用 class。
- Q12：每个业务模块提供显式公开接口，禁止跨模块引用私有实现。
- Q13：将应用操作与写入编排从 React Hook 中抽离，使业务操作可独立测试。
- Q14：统一应用状态及更新协调机制，React 通过窄接口订阅；不引入 Redux/Zustand 或多个竞争写入的 Store。
- Q15：在真实平台差异和外部副作用处建立 Ports & Adapters；保留 Android 原生计时，存储区分 Android、浏览器、测试实现。

用户已准备一份 2026-11-26 的生产环境全量导出 JSON，存放在仓库外。尚未读取或导入这份备份；后续讨论只读回归验证的使用方式，真实数据与个人路径不进入版本控制。

## 7. 第四轮决策（用户已全部确认）

- Q16：JS/TS 工程工具采用 ESLint + typescript-eslint、React Hooks 规则、Prettier、dependency-cruiser、Vitest、React Testing Library、Playwright；原生沿用 JUnit。检查随重构阶段落实。
- Q17：建立统一 `typecheck`、`lint`、`format`、`arch:check`、`test:e2e`、`check` 等本地入口；保留原有 dev/test/build/Gradle 能力，不建立远程 CI。
- Q18：按领域、应用、契约、基础设施、UI、E2E、原生分层验证，以真实行为和不变式为重点。
- Q19：常规测试使用可公开提交的合成 fixture；生产全量导出通过路径参数进行本地只读、隔离回归，固定计算时刻与时区，禁止写回原文件。
- Q20：建立 Java/TS 共享行为契约，明确既有语义差异，不在结构重构中擅自修改规则。
- Q21：沿用 `AGENTS.md`、`GLOSSARY.md`、项目导航、状态与 outcome 体系，补充架构地图、数据生命周期及必要 ADR。

### 用户补充的验证要求

参考用户提供的《Claude Code 团队如何做代码验证》文章（其中第三类称“差分测试”，原文链接 `https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/`；本轮依据用户提供的文章内容，未单独核验原文）：

1. **E2E**：构建 APK，使用本机 MuMu Android 模拟器安装和实际操作；结合生产备份在隔离环境中回归。浏览器 E2E 是快速补充，不替代原生行为验证。
2. **属性测试**：对周期、活动段、分类、存储/恢复等明确不变式生成输入；建议 TS 使用 fast-check，保留可复现的失败 seed 和最小反例。
3. **差分测试**（用户称“拆分测试”，依文章语境理解为新旧实现比较）：在相同输入、时间和时区下比较 v0.9.0 基线与重构实现；分别覆盖统计、备份恢复及关键状态转换。活动段拆分另作为领域属性/契约案例。基线的既有错误与差异须分类记录，不能以修改预期掩盖回归。

## 8. 第五轮决策（用户已全部确认）

- Q22：分阶段迁移，从工具链及 v0.9.0 行为基线开始，依次进行领域、应用与适配器、UI、全量集成和交付；独立工作并行。
- Q23：独立验证代理从 Phase 0 起维护契约、属性/差分测试和原生 E2E；实现代理不得擅自降低验收标准。同一检查连续三轮修复仍失败时升级处理。
- Q24：MuMu 仅使用明确识别并隔离的测试实例；生产备份只读，真实手机不操作。
- Q25：建立项目级 verify 技能与脚本，按改动选择可靠性检查；新规则先观察后强制。
- Q26：按模块规则、行为保持、质量门、三类验证、生产回归、APK 与文档全部验收。
- Q27：方案确认后授权 Dynamic Workflow 安装开发依赖、组织子代理、修改代码、验证及构建并在隔离 MuMu 安装；提交、推送、合并 main 和实际手机安装仍需明确授权。

### MuMu E2E 路线补充（用户要求）

当前会话存在 `agent-desktop` 技能：基于 OS accessibility tree 自主 observe/act/verify；可否读取或操作 MuMu 的 Android 内容尚未实测。用户提供 MuMu 自带 adb 路径，实际连接与截图、UI 自动化能力也尚未实测。工作流 Phase 0 并行推进 ADB 路线和 Computer Use 路线的能力调查，与领域/测试基线工作异步；同一设备的安装及交互串行，只允许一个活动所有者。

优先用 ADB/UI Automator 的语义定位与确定性脚本作为可重复质量门；Computer Use 适合探索真实 UI、验证视觉与难以脚本定位的操作，若 Windows accessibility tree 不暴露 Android 内容，则需实测其截图与交互能力。两条路线均以实际观察、操作、读回结果为准，不能仅凭工具存在或安装成功宣布 E2E 可用。未授权的物理桌面输入不能作为 headless 失败的绕行方式；必要时向用户确认。所有生产数据回归本地处理，不将真实备注、截图或导出内容写进公开文档或外发。

设计问题已收敛，进入实施规格与工作流安排；当前尚未启动工作流，未使用真实数据或安装 APK。
