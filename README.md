# 清醒时光 / waketime

记录"清醒时间"的安卓 App：每天醒来录一次睡眠起止，App 算清醒预算、跑倒计时与秒表，白天随手"计次"并写备注，按天存档，可导出 TXT / PDF / JSON 给电脑上的 AI 做作息分析。

自用项目，侧载安装，不联网、无账号。

## 现在有什么

- **今日页**：睡眠录入（起止时间 + 可选得分/手表时长/备注）→ 睡眠时长、清醒预算、参考截止；倒计时大字 + 进度条；秒表大字 + 计次/结束计时；今日时间轴（点开可改备注、分类、拆分或合并）。
- **通知栏**：一条常驻通知，显示「已清醒 HH:MM:SS」+「已完成清醒段 N 段 · 参考剩余」；**长按通知**展开「计次并备注 / 结束计时」，点「计次并备注」可直接在通知栏打字，发送即落库。
- **历史页**：周趋势 / 每日明细两块面板。周趋势按周看平均睡眠、入睡波动、相对参考截止偏移、每天时长与睡眠区间；每日明细按月历查看每天，点日期看当天时间轴（可编辑、拆分、合并）。
- **导出页**：选日期导出 TXT / PDF / JSON，或全量备份 JSON；导出后走系统分享面板（微信文件传输助手 → 电脑）。
- **设置页**：分类管理（自定义分类、改名、排序、删除；有历史引用时停用保留）、通知开关、通知权限/应用设置跳转、常用备注词（最多 8 个）、从备份恢复（含分类目录与冲突确认）、清空本机记录、设备信息。
- 计时完全基于"持久化时间戳 + 展示时重算"，锁屏/切后台/杀进程/重开后状态正确；改过系统时间会打 `clock_anomaly` 标记并提示。

## 技术栈（锁死版本）

| 组件 | 版本 |
|---|---|
| React / React DOM | 19.3.1 |
| TypeScript | 5.9.3 |
| Vite / @vitejs/plugin-react | 8.3.5 / 6.1.2 |
| Capacitor (core/cli/android) | 8.5.3 |
| Capacitor 插件 | app 8.1.2 / filesystem 8.1.5 / share 8.0.3 |
| JDK | 21（`.toolchain/jdk21`，**不要用系统 JDK 25**） |
| AGP / Gradle | 8.13.0 / 8.14.3 |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 |
| Build Tools | 35.0.0 |

包名 `com.personal.waketime`，应用名「清醒时光」。HTML/JS 全部打进 APK，离线可用。

## 目录

```
src/             React 前端（pages / components / core / data / native / export）
android/         Capacitor 安卓工程 + 我们自己的 Java 插件
  app/src/main/java/com/personal/waketime/
    timer/       TimerMath / TimerState / TimerRepository / TimerEnv / TimerNotifications / TimerService
    export/      PdfExporter / PdfExportPlugin
    WakeTimerPlugin.java   ← JS <-> 原生计时状态
tests/           vitest 单测（时间核心）
scripts/         工具链下载、env.ps1、vite 补丁
.toolchain/      JDK / Android SDK / Gradle / npm 缓存 / 签名 key（不进 git）
docs/            设计文档、实施计划、真机截图
```

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

## 签名

- key：`.toolchain/keys/waketime-release.jks`，alias `waketime`，密码在 `.toolchain/keys/keystore.properties`
- `android/keystore.properties` 指向这把 key，**debug 和 release 都用它签**，所以版本之间可以互相覆盖安装、数据不丢。
- 证书 SHA-256：`4F:BC:C0:19:D2:2E:CB:3E:00:B8:AB:DF:2A:EF:B6:12:25:42:62:A5:73:5A:5B:33:D3:E1:A9:ED:EE:24:48:8E`
- **丢了这把 key 就只能卸载重装**（先用「导出 → 全量备份 JSON」，装好后用「设置 → 从备份恢复」）。

## 数据

- 全部在应用私有目录，不联网：`files/waketime/data.json`（+ 每日备份 `files/waketime/backups/`）、截图 `files/sleep-shots/`、导出的 PDF 在 `cache/exports/`。
- 原生侧 `SharedPreferences("waketime_timer")` 保存当前活动周期（通知栏没有 WebView 时也要能计次），App 回到前台时镜像进 data.json。
- **卸载即丢**，请先导出全量备份。

## 小米 / HyperOS 注意事项

1. 设置 → 应用设置 → 清醒时光：允许通知、允许自启动、后台运行「不受限制」、最近任务里锁定。
2. 常驻通知要用**长按**才会展开「计次并备注 / 结束计时」。
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
