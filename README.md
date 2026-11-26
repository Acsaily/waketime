# 清醒时光 / waketime

记录"清醒时间"的安卓 App：每天醒来录一次睡眠起止，App 算清醒预算、跑倒计时与秒表，白天随手"计次"并写备注，按天存档，可导出 TXT / PDF / JSON 给电脑上的 AI 做作息分析。

个人项目，公开源码；侧载安装，不联网、无账号。

> `refactor/eng` 分支正在做行为保持式工程重构：v0.9.0（`8307835`）是行为、数据与 schema 3 的基线，用户数据和已发布版本不变。工程结构、ADR 与验证入口见 [docs/architecture/overview.md](docs/architecture/overview.md)。

## 下载 / 安装

- 公开仓库：<https://github.com/Acsaily/waketime>
- 最新 APK：<https://github.com/Acsaily/waketime/releases/latest>
- Android 7.0+（minSdk 24）。把 APK 传到手机点安装，或 `adb install -r waketime-0.9.0-release.apk`。
- 如果手机上已有另一个签名的同包名版本，Android 不允许覆盖；需先导出备份、卸载旧版，再安装。

## 现在有什么

- **分类**：标签分大类（如工作）和小标签（学日语、机械…），贴标签时先选大类再选细分，大类本身也可以直接记录。每个标签有颜色，新增时自动分配并可在统计页的分类管理里改色；删除有历史的标签只会停用，历史名称、备注和时长保留，之后可改标或恢复。
- **今日页**：睡眠录入（起止时间 + 可选得分/手表时长/备注）→ 睡眠时长、清醒预算、参考截止；倒计时大字 + 进度条；秒表大字 + 计次/结束计时；今日时间轴（点开可改备注、分类、拆分或合并）。
- **通知栏**：一条常驻通知，显示「已清醒 HH:MM:SS」+「已完成清醒段 N 段 · 参考剩余」；**长按通知**展开「计次 / 结束计时」。计次可在通知栏完成，备注在 App 中补写；当前 v0.9.0 原生通知未配置直接文字回复。
- **历史页**：周趋势 / 每日明细两块面板。周趋势按周看平均睡眠、入睡波动、相对参考截止偏移、每天时长与睡眠区间；每日明细按月历查看每天，点日期看当天时间轴（可编辑、拆分、合并）。
- **统计页**：分类统计 / 分类管理两块滑动面板。按周 / 月 / 年看总清醒时间、环形占比和堆叠柱状 + 折线趋势，可切换「合计 / 单分类」。统计支持「大类 / 细分」两层：默认看大类，切到细分可看全部小标签，点某个大类可下钻看它内部的细分占比。开启第二天时自动把最后一次计次到入睡的时段标成「睡前时间（待分配）」，可用层级选择器分配。
- **导出（设置页内）**：选择单个作息周期导出 TXT / PDF / JSON，或在「周期导出」填写起止日期（本周、本月、上周、上月、最近 7 天可快速填充），按起床日包含首尾日期，预览周期数、总睡眠和实际清醒后生成一个范围文件。全量备份 JSON 入口保留；导出后走系统分享面板（微信文件传输助手 → 电脑）。
- **设置页**：通知开关、通知权限/应用设置跳转、常用备注词（最多 8 个）、操作反馈（触感 / 音效）、导出与备份、从备份恢复（含分类目录与冲突确认）、清空本机记录、设备信息。
- 计时完全基于"持久化时间戳 + 展示时重算"，锁屏/切后台/杀进程/重开后状态正确；改过系统时间会打 `clock_anomaly` 标记并提示。

## 技术栈（锁死版本）

| 组件                            | 版本                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| React / React DOM               | 19.3.1                                                     |
| TypeScript                      | 5.9.3                                                      |
| Vite / @vitejs/plugin-react     | 8.3.5 / 6.1.2                                              |
| Capacitor (core/cli/android)    | 8.5.3                                                      |
| Capacitor 插件                  | app 8.1.2 / filesystem 8.1.5 / share 8.0.3 / haptics 8.0.2 |
| JDK                             | 21（`.toolchain/jdk21`，**不要用系统 JDK 25**）            |
| AGP / Gradle                    | 8.13.0 / 8.14.3                                            |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24                                               |
| Build Tools                     | 35.0.0                                                     |

包名 `com.personal.waketime`，应用名「清醒时光」。HTML/JS 全部打进 APK，离线可用。

## 目录

```text
src/
  app/             React 装配、订阅、显示时钟、生命周期、导航
  application/     跨域操作、唯一写入队列、状态快照、ports、备份/恢复/导出
  modules/
    time-tracking/ 核心域：周期、主睡眠、补觉、活动段、计时与历史规则
    classification/ 分类目录、颜色、两级层级与生命周期
    analytics/     周/月/年统计、趋势、分类聚合（只读）
  infrastructure/  Capacitor/文件/原生桥/反馈适配
  features/        today / history / statistics / settings 页面
  shared/ui/       跨 feature 的通用控件与样式
android/           Capacitor 安卓工程 + 自有 Java 插件
  app/src/main/java/com/personal/waketime/
    timer/         TimerMath / TimerState / TimerRepository / TimerEnv / TimerNotifications / TimerService
    export/        PdfExporter / PdfExportPlugin
    WakeTimerPlugin.java   ← JS <-> 原生计时状态
contracts/         TS / Java 共用的合成行为案例
tests/             领域、应用、数据、契约、属性、差分、UI、E2E、工具配置测试
scripts/           工具链、架构门、差分、验证入口、MuMu harness
.toolchain/        JDK / Android SDK / Gradle / npm 缓存 / 签名 key（不进 git）
docs/              架构、ADR、设计/计划、真机截图、恢复样本
```

工程细节见 [架构文档](docs/architecture/overview.md)：[模块地图](docs/architecture/module-map.md)、[数据生命周期](docs/architecture/data-lifecycle.md)、[验证与质量门](docs/architecture/verification.md)、[ADR](docs/adr/0001-domain-first-modular-monolith.md)。

## 构建

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\scripts\env.ps1            # 设置 JAVA_HOME / ANDROID_HOME / GRADLE_USER_HOME / npm 缓存

npm.cmd ci                     # 依赖（postinstall 会给 vite 打沙箱补丁）
npm.cmd run build              # tsc + vite build -> dist
npx.cmd cap sync android

cd android
..\..\.toolchain\gradle-8.14.3\bin\gradle.bat :app:assembleDebug
# 或正式版：:app:assembleRelease
```

APK 输出：

- debug：`android/app/build/outputs/apk/debug/app-debug.apk`
- release：`android/app/build/outputs/apk/release/app-release.apk`

安装：手机开 USB 调试 → `adb install -r <apk>`（或直接把 APK 传到手机点安装）。

## 验证

本地入口是 `scripts/verify.mjs`；详细说明、改动范围选择和证据边界见 [docs/architecture/verification.md](docs/architecture/verification.md)。

```powershell
# 日常快速门：类型检查 + 观察模式 lint/arch + 单测
node scripts/verify.mjs check

# 按改动选范围（domain / application / data / contract / ui / native）
node scripts/verify.mjs check --areas ui

# 严格验收：严格 lint/arch、格式、属性、差分、浏览器 E2E、原生 JUnit
node scripts/verify.mjs strict

# 属性失败重放
node scripts/verify.mjs property --seed 26092601 --path 12:3

# 生产备份只读差分（路径必须在仓库外；不复制、不打印内容）
node scripts/verify.mjs private --backup E:\path-outside-repo\waketime-backup.json --now 1795708800000 --tz Asia/Shanghai

# 独立 8307835 基线检查/重建（git archive + npm ci）
node scripts/verify.mjs baseline --check
```

- `check` 通过不等于验收；`strict` 也不构建/安装 APK，不等于原生 E2E 完成。
- 原生单测：`.\android\gradlew.bat :app:testDebugUnitTest`；必须用 `.toolchain/jdk21`，不要用系统 JDK 25。
- MuMu 设备操作是单独授权步骤，默认只读；身份与显式 serial 要求见验证文档。
- 生产备份、真实备注、私人截图、签名 key 不进入 Git、日志或追踪文档。

## 签名

- key：`.toolchain/keys/waketime-release.jks`，alias `waketime`，密码在 `.toolchain/keys/keystore.properties`
- 配置原生产签名时，`android/keystore.properties` 指向原来的 key，debug 和 release 可使用相同签名覆盖安装。缺少该配置时，debug 使用 Android 默认测试签名，只能用于独立测试实例；不可覆盖生产手机上的原签名版本。不要生成替代生产 key。
- 证书 SHA-256：`4F:BC:C0:19:D2:2E:CB:3E:00:B8:AB:DF:2A:EF:B6:12:25:42:62:A5:73:5A:5B:33:D3:E1:A9:ED:EE:24:48:8E`
- **丢了这把 key 就只能卸载重装**（先用「设置 → 导出与备份 → 全量备份 JSON」，装好后用「设置 → 从备份恢复」）。

## 数据

- 全部在应用私有目录，不联网：`files/waketime/data.json`（+ 每日备份 `files/waketime/backups/`）、截图 `files/sleep-shots/`、导出的 PDF 在 `cache/exports/`。
- 原生侧 `SharedPreferences("waketime_timer")` 保存当前活动周期（通知栏没有 WebView 时也要能计次），App 回到前台时镜像进 data.json。
- **卸载即丢**，请先导出全量备份。

## 小米 / HyperOS 注意事项

1. 设置 → 应用设置 → 清醒时光：允许通知、允许自启动、后台运行「不受限制」、最近任务里锁定。
2. 常驻通知要用**长按**才会展开「计次 / 结束计时」。
3. HyperOS 会把同一 App 的多条通知折叠成一张卡，所以这里只做了一条通知；倒计时只在 App 首页显示。

## 已知限制

- 睡眠数据靠手填；手表截图只做了「留着以后识别」的字段准备，OCR 还没做。
- 段起止时间不能任意拖动；漏记活动切换时可在段内补分界点（支持多个、跨午夜和进行中的清醒段），原段外侧边界不变。补录过去的日期也还没做界面。
- 通知栏文字靠亮屏时每秒刷新一次，灭屏时不刷新（省电）；灭屏期间时长按时间戳算，不受影响。
- 时区目前按手机当前时区记录，跨时区旅行不会重新归日。

## 沙箱/环境说明（为什么有些奇怪的补丁）

- DSH 沙箱里 curl/.NET 走 schannel 会失败，但 Node 自带 TLS 可以直连，所以工具链用 `scripts/download-toolchain.mjs` 下载。
- Node 在沙箱里用管道起子进程会 EPERM，Vite 的 `exec("net use")` 探测会崩，`scripts/patch-vite.mjs` 会打补丁（`postinstall` 自动执行）；vitest 用 `pool: 'threads'`。
- Android CLI 新版把 sdkmanager 换成了 `android sdk install`，且需要可写的用户目录，`.toolchain/home` 是这个用途。
