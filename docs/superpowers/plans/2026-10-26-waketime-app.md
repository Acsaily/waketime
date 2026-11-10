# 清醒时光：实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可侧载到 Redmi Note 12 Turbo（HyperOS 3 / Android 15 级）的 APK：录入睡眠起止后自动得到清醒预算与倒计时，秒表计次带备注，通知栏常驻双计时并可直接打字备注，按天存档并导出 TXT/PDF/JSON。

**Architecture:** Capacitor 8 壳（Vite + React + TS 前端）+ 应用内原生 Java 层：`TimerService`（前台服务，两条 Chronometer 通知 + RemoteInput 备注）+ `TimerRepository`（SharedPreferences 持有 live 状态，唯一真相来源）+ `WakeTimerPlugin`（桥）。JS 侧负责界面、时间派生、`data.json` 历史镜像、导出与备份；所有计时显示由时间戳重算，通知秒级跳动交给系统 Chronometer。

**Tech Stack:** React 19.2.0 / TS 5.9.3 / Vite 7.3.7 / Capacitor 8.0.0 / Java 21 / AGP 8.13.0 / Gradle 8.14.3 / compileSdk+targetSdk 36 / minSdk 24 / PDF 用 `android.graphics.pdf.PdfDocument` / 测试 vitest + JUnit4。

**Spec:** `docs/superpowers/specs/2026-10-26-waketime-design.md`

## Global Constraints

- 包名固定 `com.personal.waketime`，应用名「清醒时光」，不设 `.debug` 后缀。
- 所有构建（含调试）用 M1 生成的自有 keystore 签名；applicationId 不变，保证覆盖升级。
- JDK 用 `.toolchain/jdk21`（21.x），**禁止**用系统 JDK 25；AGP 8.13.0 / Gradle 8.14.3 / compileSdk 36 / buildTools 35.0.0 / minSdk 24 不得漂移。
- 工具链、Gradle 缓存、npm 缓存全部落在工作区内：`.toolchain/jdk21`、`.toolchain/android-sdk`、`.toolchain/gradle-home`、`.toolchain/npm-cache`。
- 依赖精确版本 + 提交 `package-lock.json`；不引用任何 CDN，APK 离线可用。
- 时间一律 UTC 毫秒存储；先做交叉校验，界面只做展示格式化。
- 不依赖后台每秒循环；通知跳动只用 `setUsesChronometer(true)`。
- 用户数据只存本机；导出/备份不得包含 IMEI、账号、手机号等设备标识。
- 中文文案全部硬编码在源码里（不引 i18n 框架）；不引入 UI 组件库，样式手写。
- 单位换算：24h = 86,400,000 ms；`targetAtMs = sleepAtMs + 86_400_000`。

## Review Focus

1. **系统时间被改 / 跨天**：用户改钟后秒表时长不得跟着跳；跨午夜段在两天日报中时长之和必须等于原段。→ Task 5、9 的单测 + Task 19 真机。
2. **进程被杀 / 手机重启后恢复**：重新打开时状态、段、备注必须完整，不能丢最后一段。→ Task 8/9 真机 + Task 11 镜像。
3. **通知栏 RemoteInput 在 HyperOS 上的可用性**：按钮弹不出输入框或发送后不落库时必须兜底（点通知开 App 的备注弹窗）。→ Task 8 真机验收。
4. **长中文备注的 PDF 换行/分页**：100 段 + 长备注不能重叠、截断、乱码。→ Task 14 与 Task 19。
5. **权限被拒的降级**：拒绝通知权限/未开自启动时，App 仍必须能计时、能记录，只是不显示通知，且明确提示。→ Task 8/17。

---

### Task 1: 工具链落盘（JDK 21 + Android SDK + Gradle）

**Files:**
- Create: `scripts/download-toolchain.mjs`（已存在）、`scripts/install-sdk.ps1`、`scripts/env.ps1`
- Verify: `.toolchain/jdk21/bin/java.exe`、`.toolchain/android-sdk/cmdline-tools/latest/bin/sdkmanager.bat`

**Interfaces:**
- Produces: `scripts/env.ps1` 可被点源，设置 `JAVA_HOME`、`ANDROID_HOME`、`GRADLE_USER_HOME`、`npm_config_cache`、`PATH`；后续所有任务用 `. .\scripts\env.ps1` 开头。

- [ ] **Step 1: 下载（后台任务 pwsh-719，已启动）**：确认 `.toolchain/downloads/` 下有三个 zip 且大小合理（JDK≈200MB、cmdline-tools≈130MB、gradle≈137MB）。
- [ ] **Step 2: 解压 JDK**：`Expand-Archive jdk21-win-x64.zip -DestinationPath .toolchain\`
- [ ] **Step 3: 解压并被验证 Java**：`.toolchain\jdk21\bin\java.exe -version`，输出必须为 `21.x`。
- [ ] **Step 4: 解压 cmdline-tools 到规范结构**：`.toolchain/android-sdk/cmdline-tools/latest/bin/sdkmanager.bat`（zip 内多一层 `cmdline-tools/`，需移动成 `latest/`）。
- [ ] **Step 5: 写 `scripts/env.ps1`**（见 Interfaces）。
- [ ] **Step 6: 装 SDK 组件**：`. .\scripts\env.ps1; sdkmanager --licenses`（自动 `y`）、`sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"`。
- [ ] **Step 7: 验证**：`sdkmanager --list_installed` 有上述三项；`adb version` 可执行。
- [ ] **Step 8: 验证 adb 能看到手机**：`adb devices` 出现设备（USB）或 `adb connect` 无线调试成功；若两者都失败 → 记录并切"手动安装 + 用户截图"模式（不阻塞后续任务）。

### Task 2: 项目骨架与版本锁定

**Files:**
- Create: `package.json`、`tsconfig.json`、`vite.config.ts`、`index.html`、`src/main.tsx`、`src/App.tsx`、`.gitignore`
- Verify: `dist/`、`capacitor.config.ts`

**Interfaces:**
- Produces: `npm run build`（tsc + vite build）产出 `dist`；`npx cap sync android` 可用。

- [ ] **Step 1: 初始化 git 仓库与 `.gitignore`**（忽略 `node_modules`、`dist`、`.toolchain`、`android/app/build`）。
- [ ] **Step 2: 按 Global Constraints 的精确版本安装依赖**（react/react-dom/vitest/vite/ts/plugin-react/@capacitor/*）。
- [ ] **Step 3: 写最小 `App.tsx`（显示版本号与"骨架就绪"）**，`npm run build` 通过。
- [ ] **Step 4: `cap init` + `cap add android` + `cap sync android`**，检查 `android/variables.gradle` = minSdk 24 / target 36 / compile 36，`android/build.gradle` 的 AGP = 8.13.0。
- [ ] **Step 5: 提交**。

### Task 3: 自有签名 + 空壳 APK 装机（M1 关口）

**Files:**
- Create: `.toolchain/keys/waketime-release.jks`（不提交）、`android/app/build.gradle` 签名配置、`scripts/build-apk.ps1`
- Verify: `android/app/build/outputs/apk/debug/app-debug.apk`

**Interfaces:**
- Produces: `scripts/build-apk.ps1` = 构建 + 签名 + 校验 + （有设备时）安装 + 输出 SHA256；后续任务都用它。

- [ ] **Step 1: `keytool -genkeypair`** 生成 3072 位 RSA、10000 天、alias `waketime` 的 keystore；密码写进 `.toolchain/keys/keystore.properties`（不提交）。
- [ ] **Step 2: 在 `android/app/build.gradle` 配置 `signingConfigs.release` 并把 debug 构建也指向它**。
- [ ] **Step 3: 构建** `. .\scripts\env.ps1; cd android; .\gradlew.bat :app:assembleDebug --stacktrace`，必须 `BUILD SUCCESSFUL` 且 `gradlew --version` 显示 JVM 21。
- [ ] **Step 4: 验签** `apksigner verify --print-certs`，证书指纹与 keystore 一致。
- [ ] **Step 5: 安装到手机**（adb 可用则 `adb install -r`；否则把 APK 给用户手动装）→ **用户确认能启动**。
- [ ] **Step 6: 提交并归档 APK SHA256**。

### Task 4: 时间核心纯函数（TDD）

**Files:**
- Create: `src/core/time.ts`、`tests/core/time.test.ts`

**Interfaces:**
- Produces:
  - `computeCycle(input:{sleepAtMs:number; wakeAtMs:number}): {sleepDurationMs:number; awakeBudgetMs:number; targetAtMs:number}`
  - `remainingMs(targetAtMs:number, nowMs:number): number`（可为负 = 超出）
  - `formatDuration(ms:number): string`（`16:30:00`）
  - `formatHuman(ms:number): string`（`7h30m`）
  - `splitByDay(seg:{startAtMs:number;endAtMs:number}, dayStartMs:number, nextDayStartMs:number): {startAtMs:number;endAtMs:number;durationMs:number} | null`
  - `validateSleepInput({sleepAtMs, wakeAtMs}): {ok:boolean; reason?:'order'|'too-long'|'zero'}`
- 后续所有页面只调用这些函数，不自己算。

- [ ] **Step 1: 写失败测试**（`tests/core/time.test.ts`）：
  - `computeCycle` 对 23:30→07:00 返回 27,000,000 / 59,400,000，且 `targetAtMs === sleepAtMs + 86_400_000`。
  - `remainingMs(23:30 目标, 09:00)` = 14.5h；`remainingMs(目标, 23:45)` = −15min。
  - `splitByDay` 对 23:50→00:10 在两天分别返回 10min/10min；对完全在一天内的段返回 null。
  - `validateSleepInput` 对 07:00→23:30 返回 `{ok:false, reason:'order'}`；25h 跨度返回 `too-long`。
- [ ] **Step 2: 跑测试确认失败**：`npx vitest run tests/core/time.test.ts`。
- [ ] **Step 3: 实现 `src/core/time.ts`**。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: 提交**。

### Task 5: 段状态机纯函数（TDD）

**Files:**
- Create: `src/core/segments.ts`、`tests/core/segments.test.ts`

**Interfaces:**
- Produces:
  - `startSession(nowMs:number, nowMonoMs:number): Segment`
  - `lapOn(segments:Segment[], nowMs:number, nowMonoMs:number, note:string, source:'app'|'notification'): Segment[]`
  - `reopenNote(segments, segId, note): Segment[]`
  - `totalDuration(segments, nowMs): number`
  - `assertInvariants(segments): void`（seq 递增、首尾相接、单段未结束）
- 相同边界时刻重复调用不得产生零长段或重复段。

- [ ] **Step 1: 写失败测试**：首段 → 计次 → 计次 = 3 段；第 2 段 `startAtMs === 第 1 段 endAtMs`；同毫秒连续两次 lap 只产生一段；`assertInvariants` 对断裂数据抛错。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: 提交**。

### Task 6: data.json 仓库（TDD，浏览器/Node 双环境）

**Files:**
- Create: `src/data/schema.ts`、`src/data/storage.ts`（Capacitor Filesystem + localStorage 开发兜底）、`src/data/repository.ts`、`tests/data/repository.test.ts`

**Interfaces:**
- Produces:
  - `loadData(): Promise<AppData>` / `saveData(d:AppData): Promise<void>`（临时文件 + 原子替换 + 备份一份）
  - `upsertCycle(d, cycle)` / `closeCycle(d, cycleId, closedAtMs)` / `backfillCycle(d, input)`（`flags:'backfilled'`）
  - `applyLiveState(d, live: LiveState): AppData`（把原生 live 状态镜像进当前 cycle）
  - `exportAll(d): BackupPayload` / `restoreFrom(backup, mode:'overwrite'|'merge'): AppData`
  - `sortCyclesDesc(d)`
- 数据形状严格按 spec §10；`schemaVersion = 1`。

- [ ] **Step 1: 写失败测试**：新建 cycle 后 `loadData` 能读回；`applyLiveState` 后段数/备注一致；同 id 覆盖不重复；`restoreFrom('merge')` 以文件为准且返回差异条数；备份数据 `schemaVersion` 不匹配时抛错。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现**（测试用内存/临时目录 adapter）。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: 提交**。

### Task 7: 原生 TimerRepository（Java，纯逻辑 + JUnit）

**Files:**
- Create: `android/app/src/main/java/com/personal/waketime/timer/TimerMath.java`、`TimerState.java`、`TimerRepository.java`
- Test: `android/app/src/test/java/com/personal/waketime/timer/TimerRepositoryTest.java`
- Modify: `android/app/build.gradle`（加 `testImplementation 'junit:junit:4.13.2'`）

**Interfaces:**
- Produces:
  - `TimerState`（JSON 可序列化）：`cycleId, sleepAtMs, wakeAtMs, targetAtMs, sessionId, status, startedAtMs, startedMonoMs, bootId, segments[]{id,seq,startAtMs,startMonoMs,endAtMs,endMonoMs,note,source}, clockAnomaly`
  - `TimerRepository.startCycle(long sleepAtMs, long wakeAtMs, long nowMs, long nowMonoMs, String bootId)`
  - `TimerRepository.lap(long nowMs, long nowMonoMs, String note, String source)`（幂等：同一 mono 值重复调用不产生新段）
  - `TimerRepository.setNote(String segId, String note)` / `endSession(...)` / `closeCycle(...)`
  - `TimerRepository.load()` / `save()`（SharedPreferences 同步 commit；JSON 用 `org.json`）
  - `TimerMath`：`targetAt(sleepAtMs)`、`budgetMs(sleepDurationMs)`、`remainingMs(target, now)`、`detectClockAnomaly(wallDelta, monoDelta)`
- 通知层与插件层只能通过它改状态。

- [ ] **Step 1: 写失败 JUnit 测试**：startCycle 后 segments=1 且在跑；lap 后 2 段首尾相接；同 mono 重复 lap 不变；setNote 生效；`detectClockAnomaly(3600_000, 0)` 为 true、(1000,1000) 为 false；序列化往返一致。
- [ ] **Step 2: 跑测试确认失败**：`. .\scripts\env.ps1; cd android; .\gradlew.bat :app:testDebugUnitTest`。
- [ ] **Step 3: 实现**（Repository 的持久化用可注入的 `KeyValueStore` 接口，测试用内存实现，避免依赖 Android）。
- [ ] **Step 4: 跑测试确认通过**。
- [ ] **Step 5: 提交**。

### Task 8: 前台服务 + 双通知 + RemoteInput（M2 关口）

**Files:**
- Create: `timer/TimerService.java`、`timer/TimerNotifications.java`、`WakeTimerPlugin.java`（先只暴露 getState/lap）、`MainActivity.java` 注册插件
- Modify: `android/app/src/main/AndroidManifest.xml`（权限 + service + specialUse property）、`android/app/build.gradle`（`androidx.core:core:1.13.1`）
- Test: 真机验收（本节 Step 5 清单）

**Interfaces:**
- Produces: 通知渠道 `waketime_stopwatch` / `waketime_countdown`；action 常量 `ACTION_LAP_REPLY`、`ACTION_END_SESSION`、`ACTION_CLOSE_CYCLE`；`TimerService.start(context)` / `stop(context)`。

- [ ] **Step 1: Manifest**：`POST_NOTIFICATIONS`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_SPECIAL_USE`、`POST_NOTIFICATIONS`；service 声明 `android:foregroundServiceType="specialUse"` + `<property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="daily awake timer"/>`。
- [ ] **Step 2: 实现两条通知**：秒表 `setUsesChronometer(true).setWhen(wakeAtMs)`；倒计时 `setUsesChronometer(true).setChronometerCountDown(true).setWhen(targetAtMs)`，到点后改静态"已超出 xx"；渠道 IMPORTANCE_LOW、`setOnlyAlertOnce(true)`、ongoing。
- [ ] **Step 3: RemoteInput**：动作「计次并备注」→ `RemoteInput("lap_note")` + `PendingIntent.getForegroundService(ACTION_LAP_REPLY)`；`onStartCommand` 里 `getResultsFromIntent` 取文本 → `repository.lap(...)` → 再次 `notify` 关闭输入框；空白文本也要成功分段。
- [ ] **Step 4: 生命周期**：`startForeground` 用秒表通知；`ACTION_END_SESSION` 停服务并移除两条通知；开机/进程被杀后由 App 启动时 `TimerService.start` 重建。
- [ ] **Step 5: 真机验收（必须逐条记录结果）**：
  - 通知栏出现两条、秒数跳动（录屏/截图）；
  - 切后台 10 分钟、锁屏 10 分钟后时间正确；
  - 通知里点「计次并备注」→ 输入框出现 → 发送 → App 内段数 +1 且备注正确（截图）；
  - 空白发送也能分段；
  - 强制结束进程 → 重开 App → 状态/段/备注都在；
  - 重启手机 → 重开 App → 状态还在（时间按墙钟重算）；
  - 若 RemoteInput 不可用 → 记录并启用兜底：点通知正文打开 App 自动弹备注框（Task 16 实现）。

### Task 9: 插件桥补齐（state 同步 / 事件 / 权限 / 设备信息）

**Files:**
- Create: `src/native/wakeTimer.ts`、`src/native/contracts.ts`
- Modify: `WakeTimerPlugin.java`（getState/startCycle/lap/setNote/endSession/closeCycle/setNotificationsEnabled/drainEvents/getDeviceInfo）、`MainActivity.java`（前后台切换时 rebuild 通知）

**Interfaces:**
- Produces: TS 封装 `wakeTimer.{startCycle,getState,lap,setNote,endSession,closeCycle,setNotificationsEnabled,drainEvents,getDeviceInfo}`；`contracts.ts` 里 `LiveState`/`Segment`/`TimerEvent`/`DeviceInfo` 类型；事件 `stateChanged`、`cycleEnded`。
- `getDeviceInfo()` 返回 `{sdkInt, androidRelease, webViewVersion, appVersion, bootId, notificationsGranted}`。

- [ ] **Step 1: 先在 JS 写类型与封装 + 一个调试页**（按钮调用各方法并打印状态）。
- [ ] **Step 2: 实现 Java 侧 + 注册插件**。
- [ ] **Step 3: 真机验证**：调试页每个按钮都能拿到正确 state；`drainEvents` 能取到通知栏产生的计次事件且取完清空。
- [ ] **Step 4: 验证 Android 版本分支**：`getDeviceInfo` 记录实际 sdkInt（预期 35/36），确认 specialUse/FGS 行为。
- [ ] **Step 5: 提交**。

### Task 10: 今日页骨架（睡眠录入 + 双计时卡）

**Files:**
- Create: `src/pages/Today.tsx`、`src/components/SleepDialog.tsx`、`src/components/CountdownCard.tsx`、`src/components/StopwatchCard.tsx`、`src/styles.css`
- Modify: `src/App.tsx`（路由：今日/历史/导出/设置，手写简单状态路由）

**Interfaces:**
- Consumes: `computeCycle`、`remainingMs`、`formatDuration`、`wakeTimer.*`、`repository.*`
- Produces: 首页数据流：无 cycle → 显示「录入昨晚睡眠」；有 cycle → 双计时卡 + 时间轴占位。

- [ ] **Step 1: 睡眠录入弹窗**：日期 + 时间输入（`<input type="datetime-local">` 量级或用两个 number 输入）；默认醒来=现在、入睡=昨日同时段；校验走 `validateSleepInput`；可选得分/手表总时长/备注。
- [ ] **Step 2: 保存** → 调原生 `startCycle` → 写 `data.json` → 首页进入计时态。
- [ ] **Step 3: 双计时卡**：倒计时（剩余 / 已超出）+ 截止时刻 + 进度条；秒表（已清醒）+ 计次 + 结束计时。
- [ ] **Step 4: 刷新**：单 `requestAnimationFrame`/1s 定时器统一驱动两个卡片，页面隐藏时停止。
- [ ] **Step 5: 浏览器验证**（`npm run dev`，无原生时用 mock adapter）+ 真机验证显示正确。

### Task 11: 计次与备注、时间轴、镜像落盘

**Files:**
- Create: `src/components/Timeline.tsx`、`src/components/NoteSheet.tsx`
- Modify: `Today.tsx`、`src/data/repository.ts`（`applyLiveState` 调用点）

**Interfaces:**
- Consumes: `lapOn`、`totalDuration`、`wakeTimer.lap/setNote`
- Produces: 每次 `stateChanged` → `applyLiveState` → `saveData`；时间轴项展示 `HH:mm–HH:mm · 时长 · 备注`，进行中的段高亮且无结束时间。

- [ ] **Step 1: 计次流程**：点「计次」→ 立即 `lap({note:''})` → 弹 `NoteSheet`（常用词 chips + 自由输入）→ 保存调 `setNote`；跳过则无备注。
- [ ] **Step 2: 时间轴**：正序展示；跨日段标「跨日」；点击某段可改备注（改起止留 v2）。
- [ ] **Step 3: 镜像**：App 前后台切换/事件回调时 `applyLiveState` 落盘；启动时用 `drainEvents` 补齐通知栏产生的变更。
- [ ] **Step 4: 真机走查**：三段计次 + 中文备注 → 杀进程 → 重开 → 数据一致。
- [ ] **Step 5: 提交**。

### Task 12: 历史页与补录

**Files:**
- Create: `src/pages/History.tsx`、`src/pages/CycleDetail.tsx`
- Modify: `repository.ts`（`backfillCycle` 已定义）

**Interfaces:**
- Produces: 历史列表（日期/睡眠时长/入睡-醒来/段数/合计时长/缺失标记）；详情页复用 `Timeline`。

- [ ] **Step 1: 列表**：倒序；无记录日期显示「无记录」；补录日标「补录」。
- [ ] **Step 2: 详情**：睡眠卡 + 双计时静态值 + 时间轴；跨日裁剪展示（用 `splitByDay`）。
- [ ] **Step 3: 补录入口**：允许选过去日期，只填睡眠数据，写 `backfilled`；未来日期禁用。
- [ ] **Step 4: 真机验证**：补录 3 天前，列表排序正确，不触发关闭最新周期。
- [ ] **Step 5: 提交**。

### Task 13: TXT / JSON 导出 + 分享 + 另存为

**Files:**
- Create: `src/export/txt.ts`、`src/export/json.ts`、`src/pages/Export.tsx`、`src/native/fileSaver.ts`
- Create: `android/.../export/SaveAsPlugin.java`（`ACTION_CREATE_DOCUMENT`）

**Interfaces:**
- Produces: `buildTxt(cycle): string`、`buildJson(cycles): string`；文件名 `waketime-YYYY-MM-DD.txt/.json`；`Filesystem.writeFile` 到 `exports/` → `Share.share` 或 `fileSaver.saveAs`。

- [ ] **Step 1: 写失败测试** `tests/export/txt.test.ts`：含睡眠摘要、每段 `HH:mm–HH:mm 时长 备注`、合计、异常标记；跨日段出现「跨日」字样；UTF-8 BOM 存在。
- [ ] **Step 2: 实现 `txt.ts` / `json.ts`**，测试通过。
- [ ] **Step 3: 导出页**：单日 / 全部；三个格式按钮；导出后给「分享」「另存为」。
- [ ] **Step 4: 真机**：导出 → 微信文件传输助手发到电脑 → 打开验证（PDF 在 Task 14）。
- [ ] **Step 5: 提交**。

### Task 14: 原生 PDF 导出

**Files:**
- Create: `android/.../export/PdfExporter.java`、`PdfExportPlugin.java`
- Create: `src/export/pdfDoc.ts`（把 cycle 转成渲染块）
- Test: 真机 + 电脑打开

**Interfaces:**
- Produces: `PdfExport.export({filename, blocks: Array<{kind:'title'|'h2'|'row'|'para', text|l|r|c}>})`；Java 用 `PdfDocument` A4 + `Paint.breakText` 换行 + 自动分页；返回文件路径。

- [ ] **Step 1: 定义块协议 + JS 侧 `pdfDoc.ts`**（标题/摘要/时间轴行/页脚）。
- [ ] **Step 2: Java 渲染器**：A4 595×842、页边距 40、正文 11pt、表格两列对齐、页脚「第 N 页 / 生成时间 / 版本」。
- [ ] **Step 3: 真机生成含 100 段 + 长中文备注的 PDF**。
- [ ] **Step 4: 电脑打开验收**：中文不乱码、不重叠、分页正确、总段数与 TXT 一致。
- [ ] **Step 5: 提交**。

### Task 15: 备份与恢复

**Files:**
- Create: `src/export/backup.ts`、`src/pages/Settings.tsx` 的备份区
- Modify: `repository.ts`（`restoreFrom` 已在 Task 6 定义）

**Interfaces:**
- Produces: `buildBackup(data)`、`restoreBackup(file, 'overwrite'|'merge')`；恢复前自动 `pre-restore-*.json`。

- [ ] **Step 1: 测试**（`tests/data/backup.test.ts`）：合并模式按 cycle.id 去重并返回差异数；覆盖模式完全替换；schemaVersion 不符抛错；恢复前生成 pre-restore 备份。
- [ ] **Step 2: 实现 UI**：导出备份 / 选择文件恢复 / 二次确认 / 结果摘要。
- [ ] **Step 3: 真机验证**：导出备份 → 清空数据（或恢复覆盖）→ 恢复 → 内容一致。
- [ ] **Step 4: 提交**。

### Task 16: 设置页、权限引导与通知开关

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `WakeTimerPlugin.java`（`openNotificationSettings`/`openAppSettings`/`requestNotificationPermission`）

**Interfaces:**
- Produces: 通知开关（`setNotificationsEnabled`）、常用词编辑（≤8）、权限引导按钮（通知/自启动/电池优化/锁定后台）、版本与设备信息、卸载前请先备份提示。

- [ ] **Step 1: 实现设置项与持久化（settings 段）**。
- [ ] **Step 2: 权限引导**：调系统页面 Intent（`ACTION_APP_NOTIFICATION_SETTINGS`、`ACTION_APPLICATION_DETAILS_SETTINGS`、小米自启动页 `com.miui.securitycenter` 若不存在则回退到应用详情页）。
- [ ] **Step 3: 降级验证**：拒绝通知权限 → App 能计时能记录，首页显示「通知被关闭」提示；重新授权后通知恢复。
- [ ] **Step 4: 真机验证**各项跳转落到正确页面。
- [ ] **Step 5: 提交**。

### Task 17: 趋势图（v1 末）

**Files:**
- Create: `src/components/TrendChart.tsx`、`src/pages/Trends.tsx`、`src/core/trends.ts`、`tests/core/trends.test.ts`

**Interfaces:**
- Produces: `sleepSeries(cycles, days): Array<{date, sleepDurationMs|null, sleepAtHour:number|null, wakeAtHour:number|null}>`；入睡时刻用「以中午为轴」的连续小时编码；缺失日 `null` 不补零。

- [ ] **Step 1: 写失败测试**：7 天含 1 天缺失 → 该点为 null；23:50 与 00:10 的 hour 编码差 20 分钟而非 24h。
- [ ] **Step 2: 实现 `trends.ts`**，测试通过。
- [ ] **Step 3: SVG 折线 + 缺失日留空 + 「已录 N 天」标注**。
- [ ] **Step 4: 真机看效果**。
- [ ] **Step 5: 提交**。

### Task 18: 收尾与正式交付

**Files:**
- Create: `README.md`（如何重新构建、工具链路径、keystore 说明、故障排查）
- Modify: `capacitor.config.ts`（appName 清醒时光）、`res/` 图标与启动底色、`variables.gradle` 版本号

- [ ] **Step 1: 应用名/图标/versionName 0.1.0 / versionCode 1**。
- [ ] **Step 2: 正式 release APK**：`assembleRelease` + zipalign + apksigner，输出 SHA256 与证书指纹。
- [ ] **Step 3: 覆盖安装验证**：装 release 覆盖 debug → 原有数据保留。
- [ ] **Step 4: README 与 keystore 备份交付**。
- [ ] **Step 5: 提交**。

### Task 19: 真机全量验收（交付关口）

- [ ] 睡眠录入 23:30→07:00 → 睡眠 7h30m、预算 16h30m、截止 23:30（截图）。
- [ ] 通知栏两条常驻、秒级跳动、锁屏/后台 10 分钟正确。
- [ ] 通知栏「计次并备注」输入中文 → 落库正确（截图 + 导出 JSON 对照）。
- [ ] App 内连做 3 段计次，起止首尾相接、无重复（导出 JSON 对照）。
- [ ] 杀进程 / 重启手机后恢复，误差 ≤ 2s。
- [ ] 改系统时间 ±1h → 秒表时长不跳变，界面出现异常提示。
- [ ] 跨午夜段（23:50–00:10）在两日导出中各 10 分钟。
- [ ] 导出 TXT/PDF/JSON → 传电脑 → PDF 中文正常、TXT 可读、JSON 可解析。
- [ ] 备份 → 清数据 → 恢复 → 一致。
- [ ] 断网 + 电脑未跑 dev server 时 App 正常启动。
- [ ] 记录：设备信息（型号/Android/WebView）、APK SHA256、证书指纹、每步截图路径。

## 交付判定

- **通过**：上述 11 条都有真实证据（截图/文件/JSON 对照），APK 在用户手机上可复现。
- **需修改**：发现计算错误、丢数据、通知不可用、PDF 乱码、安装失败等。
- **证据不足**：只有浏览器截图或 `BUILD SUCCESSFUL` 日志。
