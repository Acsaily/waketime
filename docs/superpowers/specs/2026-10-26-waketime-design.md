# 清醒时光（暂定名）— 设计文档（v1）

- 日期：2026-10-26
- 状态：待用户批准（批准后才进入 plan / 实施）
- 作者：DeepSeek（执行方），技术方案基线来自本机 GPT（astra）咨询 taskId `01f89bde-5034-459e-9688-7ecdbb2e59ff`
- 目标用户：一个人（本机主人），自用，安卓手机，侧载安装

---

## 1. 这是什么，为什么做

一个"记录清醒时间"的个人 App。核心不是打卡，而是**把一天的清醒时间自动变成结构化数据**，供用户事后和 AI 一起复盘：

1. 每天醒来录一次「昨晚几点睡、今早几点醒」，App 由此得到睡眠时长；
2. 从醒来时刻起跑两个计时：**倒计时**（到"如果今晚按规律睡，还剩多少清醒时间"归零）和**秒表**（我已清醒多久）；
3. 白天随手点「计次」，把时间切成一段一段，每段带一句备注（这段时间干了什么）；
4. 数据按天存档，可导出 TXT / PDF / JSON 给电脑上的 AI 写分析报告；
5. 手机下拉通知栏里就能看到两个计时、能直接打字补备注，不用反复进 App。

用户原话里的关键点：倒计时"并不是强制要求执行"，是参考；睡眠波动会让每天倒计时长度自动变；睡眠数据来自红米手表，但小米运动健康没有开放接口，所以先手动填、截图留证，识图放后面。

## 2. 目标 / 非目标 / 反目标

### 目标（v1 必须做到）
- 一个能装到自己安卓手机上、离线可用的 APK。
- 录入睡眠起止 → 自动得出睡眠时长、清醒预算、参考截止时刻。
- 当日双计时：倒计时（剩余）与秒表（已清醒），通知栏常驻可见、秒级跳动。
- 计次（分段）与备注：App 内可做；通知栏里可"直接打字回复"完成计次+备注。
- 按天留档；导出 TXT / PDF / JSON 并分享到电脑。
- 锁屏、切后台、进程被杀、手机重启后，记录不丢、时长不跑偏。
- 跨天、漏填、改系统时间的处理有明确定义（见 §8）。

### 非目标（v1 不做）
- 账号、云同步、多设备、iOS。
- 自动从小米运动健康同步睡眠数据（无公开接口，不做逆向）。
- 截图 OCR 识别（第二批，v1 只存截图 + 手动填时间）。
- App 内嵌 AI 分析（v1 只导出，AI 在电脑上做）。
- 桌面小组件、深浅色主题定制、多语言。

### 反目标（做到这样就算失败）
- 为了"实时"在后台每秒刷新计时——耗电、还会被系统杀。
- 把数据放在云端或需要登录才能用。
- 用打卡、连击、惩罚提醒逼用户按时睡觉——用户明确说这是参考不是纪律。
- 悄悄改写用户填的睡眠时间（例如用 OCR 或推断覆盖手动值）。
- "构建成功"就当交付，没在真机上跑通。

## 3. 约束与已知事实

| 项 | 事实 |
|---|---|
| 设备 | 安卓手机（用户自用，HyperOS 系小米设备可能性大），侧载 APK |
| 开发机 | Windows；工作区 `G:\AI\Deepseek\app-maker`；Node 24.19 / npm 11.17；JDK 25（不能用于本构建链） |
| 缺失 | 无 Flutter、无 Android SDK、无 adb/gradle/ANDROID_HOME |
| 沙箱 | workspace-write：只能写工作区与临时目录。因此 JDK、SDK、Gradle 缓存、npm 缓存全部装进工作区 `.toolchain/` |
| 网络 | 沙箱内 curl/.NET 的 TLS 失败（schannel 无凭证），但 **Node 自带 TLS 可直连**（已实测 registry.npmjs.org 200）。下载优先走 Node 脚本；JVM 的下载能力在 M0 验证 |
| 磁盘 | G: 剩余 13.1 GB，足够（预算 4–6 GB） |
| 数据来源 | 手表睡眠数据无 API。v1 手动录入 + 可存截图 |
| 验收 | 只能在用户真机上验收 |
| 设备连接 | 沙箱内 PnP/USB 设备枚举被拒（access denied），adb 能否认到手机待 M1 验证。计划：①优先 USB（需开 USB 调试并授权）②不行走**无线调试**（`adb pair` + `adb connect`，走 TCP 局域网，不受 USB 权限限制）③再不行就手动装 APK + 用户回传截图 |
| 设备信息 | 待用户提供：机型、Android 版本、WebView 版本（决定 §9.3 前台服务分支与权限引导页） |

## 4. 方案选择

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **A. Capacitor 8 + React + TS + 小段原生 Java 插件** | 复用已有 Node；界面迭代快；通知栏/PDF/文件用原生补齐完全可行；WebView 也能跑 | 需要自己写前台服务、通知、RemoteInput、PDF 原生代码 | **采用** |
| B. Flutter | UI 一致性强，原生能力直接 | 另装整套 Flutter/Dart，体量与学习成本更高；已确定用 A 后无额外收益 | 不采用 |
| C. 纯网页 PWA | 零安装 | **通知栏常驻计时 + 通知内打字回复做不到**，直接违背第 5 条需求 | 排除 |

用户已确认按 A 走。

## 5. 核心概念（术语先对齐）

- **睡眠周期 cycle**：一次"昨晚睡下 → 今早醒来"形成的记录单元，以醒来日期命名（如 `2026-10-26`）。
- **睡眠时长** = 醒来时刻 − 入睡时刻。
- **清醒预算** = 24h − 睡眠时长（例：睡 7h30m → 16h30m）。
- **参考截止时刻** = 醒来时刻 + 清醒预算 = **入睡时刻 + 24h**（这两个算法等价，实现用后者更稳）。
- **已清醒时长** = 现在 − 醒来时刻。
- **参考剩余** = max(0, 参考截止 − 现在)；**超出** = max(0, 现在 − 参考截止)。
- **段 segment**：秒表切出来的一段时间，有起点、终点（可空）、备注。
- **计次**：把"当前段"在某一刻结束、同时开始新的一段。备注描述的是**刚结束的那段**。

## 6. 每天怎么用

**第一天 / 首次使用**
1. 打开 App → 首页提示"录入昨晚的睡眠"。
2. 填入睡（默认昨天 23:30 之类可改）、醒来（默认现在），可选填睡眠得分/手表总时长/备注，可选加一张手表截图。
3. 保存 → 立即开始：倒计时 + 秒表，通知栏出现两条常驻通知。

**白天**
- 干完一段事点「计次」：当前段立刻封口，弹出/展开一个备注输入条（可选常用词快选），保存或跳过。
- 懒得进 App：下拉通知栏，在秒表那条通知里点「计次」→ 直接打字 → 发送。发送那一刻即分段边界，文字成为刚结束那段的备注。
- 想看还剩多久：看通知栏或桌面。

**倒计时归零后**
- 通知与首页显示"参考清醒时间已用完，已超出 00:xx:xx"，不倒扣、不自动结束、不打断秒表。

**第二天醒来**
- 再点"录入睡眠" → 填新的入睡/醒来 → 保存时在同一个事务里**关闭上一周期**（上一周期实际清醒结束时间 = 本次入睡时刻，但备注为"手动录入"），开启新周期。

## 7. 界面（v1 四个页面）

### 7.1 今日（首页）
```
┌──────────────────────────────┐
│ 10月26日 周一        [设置]   │
│ ┌──────────────────────────┐ │
│ │ 睡眠  23:30 → 07:00      │ │
│ │ 时长 7h30m  得分 82  [编辑]│ │
│ └──────────────────────────┘ │
│                              │
│      参考清醒剩余             │
│        16:30:00              │
│   截止 23:30 · 已清醒 00:00   │
│   [====================----] │
│                              │
│      已清醒（秒表）           │
│        00:00:12              │
│   [计次]      [结束计时]      │
│                              │
│  今日时间轴                   │
│  07:00-08:10  1h10m  洗漱早饭 │
│  08:10-09:40  1h30m  写方案   │
│  09:40-      …       ←进行中  │
└──────────────────────────────┘
```
- 还没录睡眠时，整页只显示"录入昨晚睡眠"按钮 + 历史入口。
- 时间轴按时间倒序或正序（默认正序，进行中的固定在底部并高亮）。
- 点击某段可改备注/改起止（改起止仅限手工修正，标 `edited`）。

### 7.2 历史
- 按日期列出周期：日期、睡眠时长、入睡/起床时刻、清醒段数、总记录时长、有无备注缺失。
- 点开某天 → 当天详情（同一套时间轴组件）+ 导出按钮。
- v1 就做列表 + 详情，不做搜索。

### 7.3 导出
- 默认"导出今天"，也可选一段日期范围（v1 支持单日 + 全部）。
- 三种格式按钮：TXT（给 AI 读）、PDF（人看/存档）、JSON（给 AI 精确计算）。
- 导出后：`分享`（系统分享面板，可发微信文件传输助手/邮箱/蓝牙）或 `另存为`（系统文件选择器，落到下载目录方便数据线拷）。

### 7.4 设置
- 通知开关（关掉即停前台服务，计时仍在 App 内可见）。
- 常用备注词条（最多 8 个，编辑/排序）。
- 权限引导：通知权限、自启动、后台运行不受限制、电池优化白名单——每项一个按钮跳到系统对应页面，附文字说明。
- 数据：导出全量 JSON 备份 / 从备份导入（v1 只做导出备份，导入留 v2）。
- 关于：版本、数据库 schema 版本、设备信息（Android 版本 / WebView 版本）。

## 8. 计时与时间规则（这一节是正确性的核心）

### 8.1 时间锚点，不靠"每秒累加"
- 持久化的是**时刻**（wall clock ms）与**单调时钟值**（`SystemClock.elapsedRealtime()`），一切显示由"现在"重算。
- 界面靠 `requestAnimationFrame`/`setInterval` 刷新显示，刷新失败不影响记录。
- 通知栏秒级跳动由 Android 系统的 `Notification.setUsesChronometer(true)` 负责，不靠 App 每秒推通知。

### 8.2 录入规则
- 录入时必须存**完整日期时间**，不能只存 `HH:mm`。
- 醒来时刻默认"现在"，入睡时刻默认"今天之前最近一个比醒来早的时间"，但用户可改日期。
- 校验：入睡 < 醒来；跨度 > 0 且 < 24h；跨度 < 1h 或 > 16h 时二次确认（防手滑）。
- 若用户是中午才补录：一律按填入的时刻计算，不按"保存时刻"计算。

### 8.3 跨天
- 周期以醒来日期归属。
- 段跨午夜：原始记录完整保留；看某天日报时按 00:00 裁开，两天的时长之和 = 原段时长，并标注"跨日"。
- 一秒都不许丢：裁剪只在展示/导出层做。

### 8.4 改系统时间 / 重启
- 存 `wallMs` + `elapsedRealtimeMs` + 一次开机的 `bootId`（用 `SystemClock.elapsedRealtime()` 的基线与开机时间推断，或用 `Settings.Global.BOOT_COUNT` 读，读不到就退化）。
- 同一次开机内：时长以单调时钟为准；发现 `wall 差 − mono 差` 超过 5 秒 → 打 `clock_anomaly` 标记并在界面提示"检测到系统时间被调整，时长可能不准"。
- 跨重启且系统时间也被改：无法离线还原真实时长，标记为"待确认"，宁可标不确定也不编造。

### 8.5 次日录入时的周期关闭
- 保存新周期时事务性关闭旧周期：`closedAt` = 新入睡时刻，`status = closed`。
- 若旧周期秒表还在跑，先把当前段在"新入睡时刻"封口，再关；不静默丢弃。
- 漏填一天：历史里明确显示"该日无记录"，不补造。

### 8.6 手动结束与重新开始（状态机）

- 两条通知上的按钮统一为**一个动作：结束本次计时**。点它 = 当前段在点击时刻封口、`session.status = ended`、`endedAtMs` 记录、前台服务停止、两条通知消失。
- 结束之后**当天允许重新开始计时**：在首页点「开始计时」→ 新建一个 session（新的 sessionId，从点击时刻起算，`source=manual_restart`），段序列在新 session 内重新从 1 开始，旧 session 的段原样保留。一天里可以有多个 session，展示时全部按时间顺序拼接。
- **周期（cycle）不会因为"结束计时"而关闭**。cycle 只在两种情况下关闭：①次日录入新的睡眠（§8.5）②用户在睡眠卡片上点「结束今天」。关闭后当天仍可查看、导出，但不能新增段。
- 结束计时后倒计时不再出现在通知栏（没有前台服务了），但首页照常按时间显示剩余/超出——它本来就是算出来的参考值。
- 状态机：`idle`（当日无 session）→ `running` → `ended`；从 `ended` 可再 `running`。`cycle.closed` 与 session 状态相互独立。

### 8.7 补录过去的日期

- 允许补录**过去任意一天**的睡眠（录入页带日期选择器），用于漏填后的补齐。
- 补录只写睡眠数据（睡眠起止、时长、预算、截止、评分等），**不生成秒表段**，`flags` 标 `backfilled`，界面与导出都注明"该日为补录，无当日时间轴"。
- 补录插入后按 `wakeDate` 重新排序；乱序插入不触发"关闭上一周期"逻辑（关闭只发生在录入**比现有最新日期更新**的一天时）。
- 不允许录入未来日期。

### 8.8 卸载/换机与数据安全

- 数据在 App 私有目录，卸载即失；导出备份在私有目录，卸载同样丢失。
- 因此：①v1 必须提供「从 JSON 备份恢复」（§11.5）②设置页显著位置提示"卸载前先导出备份"③正式签名固定后**覆盖安装升级不丢数据**（见 §13 签名策略），日常升级不需要卸载。

## 9. 通知栏设计（本项目最硬的部分）

### 9.1 两条常驻通知
| 通知 | 内容 | 显示方式 | 按钮 |
|---|---|---|---|
| 倒计时 | "参考清醒剩余 16:30:00" / 截止 23:30 | `setUsesChronometer(true)` + `setChronometerCountDown(true)` + `setWhen(参考截止)` | 结束今日 |
| 秒表 | "已清醒 01:23:45" | `setUsesChronometer(true)`，`setWhen(醒来时刻)` | **计次（带输入框）**、结束计时 |

- 两个独立 `notificationId`，同一 `IMPORTANCE_LOW` 通知渠道（静音、不弹窗、不亮屏）。
- `setOnlyAlertOnce(true)`，避免每次更新响铃。
- 沉没式（ongoing）通知，用户不能划掉。
- 倒计时归零后：切换为静态文本"参考时间已用完 · 已超出 00:12:34"（`Chronometer` 到点不会自动变负，需一次性更新），之后不再频繁刷新。

### 9.2 通知里直接打字备注
- 秒表通知的「计次」用 `RemoteInput`（`addRemoteInput`）+ `PendingIntent.getForegroundService`。
- 用户点按钮 → 系统弹出输入框 → 打字 → 发送 = 分段时刻，文字成为刚结束那段的备注。
- 空白发送 = 只分段不写备注。
- 兜底：如果某 ROM 不支持 RemoteInput 或样式异常，点通知正文打开 App 并自动弹出备注条。**必须真机验证这一条。**

### 9.3 前台服务
- `TimerService`：`startForeground` 挂秒表通知；倒计时通知用普通 `notify` 更新。
- 服务只负责"通知呈现 + 接收通知动作 + 维护 live 状态"，不做每秒循环。
- Android 14+ 用 `specialUse` 前台服务类型（`PROPERTY_SPECIAL_USE_FGS_SUBTYPE = "timer"`），并声明 `FOREGROUND_SERVICE_SPECIAL_USE`；Android 13+ 需要 `POST_NOTIFICATIONS` 运行时权限。
- HyperOS 额外要用户开：自启动、后台运行、锁定后台任务。设置页做引导，不假装能绕过。
- 若系统还是把进程杀了：下次打开 App 时按时间戳重算并重建通知（记录不丢）。

### 9.4 唯一真相来源
- **原生侧**（SharedPreferences，每次变更同步落盘）持有"当前周期 + 段列表 + 状态"，因为通知在没有 WebView 时也要能操作。
- **JS 侧** 通过插件读 state、发命令；每次变更后 JS 把完整快照镜像进 `data.json`（历史 + 当前周期）。
- 冲突规则：原生 live 状态优先；`data.json` 是可读的历史/备份。若两者不一致（例如 App 被卸载重装），以各自存在的数据为准并提示，不静默删除。

## 10. 数据模型（v1 用 JSON 文件，不用 SQLite）

**为什么不用 SQLite**：v1 数据量极小（一年 365 个周期、几千段），JSON 单文件足够；省掉一个原生数据库插件的构建/迁移风险，而且导出/备份天然就是 JSON。所有读写走统一的 repository 层，v2 若需要复杂查询再换 SQLite，接口不变。

**位置**：App 私有目录 `data/data.json`；备份 `data/backups/data-YYYYMMDD-HHmmss.json`（保留最近 10 份 + 每日 1 份）；截图 `files/sleep-shots/`；导出 `exports/`。

```jsonc
{
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "settings": {
    "notificationsEnabled": true,
    "quickNotes": ["工作", "吃饭", "休息", "刷手机"],
    "freeNotesEnabled": true
  },
  "cycles": [
    {
      "id": "2026-10-26",
      "timeZone": "Asia/Shanghai",
      "sleepAtMs": 0,            // 入睡时刻（UTC ms）
      "wakeAtMs": 0,             // 醒来时刻
      "sleepDurationMs": 0,
      "awakeBudgetMs": 0,
      "targetAtMs": 0,           // = sleepAtMs + 86400000
      "sleepMetrics": {          // 全部可空，null 不写 0
        "score": null, "scoreScale": 100,
        "reportedTotalMs": null, "deepMs": null, "lightMs": null, "remMs": null,
        "note": null
      },
      "screenshotPath": null,
      "source": "manual",        // manual | ocr（v2）
      "session": {
        "id": "uuid",
        "startedAtMs": 0,
        "startedMonoMs": 0,
        "bootId": null,
        "status": "running",     // running | ended
        "endedAtMs": null,
        "segments": [
          {
            "id": "uuid",
            "seq": 1,
            "startAtMs": 0,
            "startMonoMs": 0,
            "endAtMs": null,
            "endMonoMs": null,
            "durationMs": null,
            "note": "写方案",
            "source": "app",     // app | notification
            "editedAtMs": null
          }
        ]
      },
      "closedAtMs": null,
      "flags": [],               // clock_anomaly | edited | missing_note ...
      "createdAtMs": 0,
      "updatedAtMs": 0
    }
  ]
}
```

**不变式**
- 同一时刻最多一个"进行中段"；`seq` 唯一递增；段的 `startAtMs` 严格递增。
- `targetAtMs === sleepAtMs + 86400000`；`awakeBudgetMs === 86400000 − sleepDurationMs`。派生值只在写入时算一次，展示时不再重算，避免口径漂移。
- 所有时间为 UTC 毫秒；`timeZone` 记录录入时区；跨时区不改历史归属。
- 写盘用"临时文件 + 原子替换"；每次写前保留上一版为备份。

## 11. 导出

### 11.1 TXT（给 AI 读，最重要）
- 文件头：schema 版本、导出时间、时区、说明"这是一天的清醒记录，时间为本地时间，单位分钟"。
- 睡眠摘要：入睡、醒来、时长、手表指标（有则写）、得分。
- 时间轴：`HH:mm–HH:mm  Xh Ym  备注`，跨日的段标注；合计清醒段数/记录总时长/未备注段数。
- 尾部：异常标记说明（改钟、漏填、手工编辑）。
- 编码 UTF-8（可带 BOM，兼容老 Windows 记事本）。

### 11.2 JSON（给 AI 精确算）
- 直接输出该周期（多日则数组）+ `schemaVersion` + 导出元信息。
- 不含设备隐私信息（无 IMEI、无手机号、无账号）。

### 11.3 PDF（人看/存档）
- 用**原生 `android.graphics.pdf.PdfDocument`** 生成 A4，使用系统中文字体（设备自带，避免嵌入字体与授权问题；jsPDF 那套嵌中文字体的坑绕开）。
- 一页纸：标题（日期+星期）、睡眠摘要块、倒计时信息、时间轴表格（自动分页）、页脚（生成时间/版本）。
- 中文按字符宽度换行；长备注截断到 N 字并提示"完整内容见 TXT/JSON"。

### 11.4 文件与分享
- 文件名：`waketime-2026-10-26.txt/.pdf/.json`（ASCII，避免各种传输链路的编码问题）。
- 生成到 App 私有 `exports/`；点分享时复制到 `cache/` 交给系统分享面板。
- 「另存为」用 `ACTION_CREATE_DOCUMENT`，让用户存到下载目录，数据线一拷就上电脑。
- 验收标准：**真机导出 → 传到电脑 → Windows 打开 PDF 不乱码、TXT 可读、JSON 可解析**。

### 11.5 备份与恢复（v1 必须有）

- 「导出全量备份」= 一个 JSON 文件，含全部 cycles + settings + schemaVersion + 导出时间。
- 「从备份恢复」：选一个之前导出的 JSON → 校验 schemaVersion → 两种模式：
  - **覆盖**：清空后写入（用于换机/重装）；
  - **合并**：按 `cycle.id` 去重，同一天以文件里的为准并提示差异条数。
- 恢复前自动把现有数据另存为 `pre-restore-*.json`。
- 恢复是唯一会一次性改大量数据的操作，必须二次确认 + 结果摘要（恢复 N 天、跳过 M 天）。
- 备份文件本身走「分享」或「另存为」落到电脑/微信，不只留在私有目录——否则卸载一样丢。

## 12. 趋势（第二批，v1 末可带最简版）

- 7 天 / 30 天：睡眠时长折线、入睡时刻折线（以中午为轴心，避免 23:50→00:10 画成跳变）、起床时刻折线。
- 手写 SVG，不引图表库；缺失日留空不补零；图上标注"已录 N 天"。
- 目标：看睡眠波动趋势，不做预测、不做评分建议。

## 13. 技术栈与锁定版本

| 组件 | 版本 |
|---|---|
| Node / npm | 24.19.0 / 11.17.0（已有） |
| React / React DOM | 19.2.0 |
| TypeScript | 5.9.3 |
| Vite / @vitejs/plugin-react | 7.3.7 / 5.1.2 |
| @capacitor/core / cli / android / app / filesystem / share | 8.0.0 |
| Android Gradle Plugin | 8.13.0 |
| Gradle Wrapper | 8.14.3（bin） |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 |
| Build Tools | 35.0.0 |
| JDK | Microsoft OpenJDK 21（装进 `.toolchain/jdk21`，**不用系统的 25**） |
| Android cmdline-tools | 19.0（装进 `.toolchain/android-sdk`） |

- 依赖精确版本 + 提交 `package-lock.json`，后续 `npm ci`。
- 所有依赖、字体（用系统字体，无额外字体文件）、JS 全部打包进 APK，**离线可运行**。
- 包名固定 `com.personal.waketime`（**不加 `.debug` 后缀**）。
- **签名策略（从 M1 就定死）**：M1 生成一把自有 keystore（放在工作区 `.toolchain\keys\`，另存一份给用户保管），**所有构建（包括调试阶段）都用这把 key 签名**，`applicationId` 始终不变。这样后续换新版本直接覆盖安装、数据保留，不需要"卸载 debug 包再装 release 包"。丢掉 keystore 就再也无法覆盖升级，只能卸载重装（那时靠 §11.5 备份恢复）。

## 14. 架构与代码布局

```
G:\AI\Deepseek\app-maker\
├─ .toolchain\            # jdk21、android-sdk（不进 git）
├─ docs\superpowers\specs\ # 本设计文档
├─ src\                   # React + TS
│  ├─ app\                # 路由/壳
│  ├─ pages\Today, History, Export, Settings
│  ├─ components\CountdownCard, StopwatchCard, Timeline, NoteSheet, TrendChart
│  ├─ core\               # 纯函数：时间计算、跨日裁剪、格式化（可单测）
│  ├─ data\               # repository：读写 data.json、备份、迁移
│  ├─ native\             # Capacitor 插件 JS 封装（WakeTimer / PdfExport / FileSaver）
│  └─ styles\
├─ android\               # Capacitor 生成的安卓工程（含我们的原生插件）
│  └─ app\src\main\java\com\personal\waketime\
│     ├─ MainActivity.java
│     ├─ timer\TimerRepository.java, TimerService.java, TimerState.java, BootId.java
│     ├─ timer\WakeTimerPlugin.java
│     └─ export\PdfExporter.java, PdfExportPlugin.java, SaveAsPlugin.java
├─ tests\                 # core 纯函数单测（node/vitest）
└─ scripts\               # 工具链下载/校验、构建脚本
```

**JS ↔ 原生接口（WakeTimer）**
- `startCycle({sleepAtMs, wakeAtMs}) → State`
- `getState() → State`
- `lap({note?}) → State`
- `setNote({segId, note}) → State`
- `endCycle() → ClosedCycle`
- `setNotificationsEnabled({enabled})`
- `drainEvents() → Event[]`（App 复活后补齐通知里产生的变更）
- 事件：`stateChanged` / `cycleEnded` / `permissionRequired`
- `PdfExport.export({filename, doc})`、`FileSaver.saveAs({filename, mimeType, base64})`

## 15. 分阶段实施与每阶段验收

| 阶段 | 内容 | 验收（真实证据） |
|---|---|---|
| **M0 工具链** | 下载/校验 JDK21、cmdline-tools、Gradle 分发；装 SDK 组件；`gradlew --version` | 版本表 + JDK/SDK 实际安装路径 + `gradlew --version` 输出（JVM 必须 21） |
| **M1 空壳 APK** | Vite 空页面 + Capacitor android；生成自有 keystore 并配置签名；assembleDebug（用自有 key 签）；装到真机 | APK 文件 + SHA256 + 手机上能启动 + 证书指纹与 keystore 一致（adb 截图或用户确认） |
| **M2 原生计时核心** | TimerService + 两条 Chronometer 通知 + RemoteInput + Repository；最小调试页 | 通知跳秒视频/截图；切后台 10 分钟、锁屏、杀进程、重启后状态正确；通知里打字回复落库 |
| **M3 业务界面** | 今日页（录入/双计时/计次备注/时间轴）+ 历史页 + 编辑 | 真机完整走一遍一天流程；三段计次起止无缝、无重复 |
| **M4 导出与备份** | TXT/PDF/JSON 导出 + 分享 + 另存为 + 全量备份/恢复 | 真机导出 → 电脑打开：PDF 中文不乱码、TXT 可读、JSON 可解析；备份→清数据→恢复→内容一致 |
| **M5 收尾** | 设置页、权限引导、趋势图、正式签名 APK、构建说明 | 覆盖安装保留数据；正式 APK SHA256/证书指纹；断网可启动 |

M1 一完成就把 APK 给用户装一次，先确认"能装能开"，避免后面白干。

## 16. 交付物

1. 源码（React + 安卓工程）与 `package-lock.json`、构建脚本、`.toolchain` 说明。
2. `android/app/build/outputs/apk/...` 下的 APK（自有 key 签名，可直接覆盖升级）。
3. 设计文档 + 实施计划 + 真机验收记录（截图/导出样本）。
4. 一份"怎么重新构建"的 README。
5. keystore 文件 + 密码说明（用户自己保管；丢了就只能卸载重装 + 备份恢复）。

## 17. 风险与前 5 个坑

| 风险 | 规避 |
|---|---|
| 下载失败（SDK/JDK/Gradle/Maven） | 全部用 Node 脚本下载并校验 SHA256；JVM 下载能力在 M0 先验证；npm 走可用 registry；失败就换镜像并记录 |
| JDK/AGP/Gradle 版本错配 | 锁死版本；`gradlew --version` 必须显示 JVM 21；不用 JDK25、不用 `--force` |
| 沙箱写入限制 | 全部工具链/缓存放工作区；Gradle 用 `GRADLE_USER_HOME=工作区`；npm cache 同理 |
| HyperOS 杀后台 / 通知不显示 | 权限引导页 + 真机逐项验证；进程被杀后靠时间戳恢复，绝不宣称"永不被杀" |
| RemoteInput / 通知样式 ROM 差异 | 真机先验；兜底为点通知开 App 的备注弹窗 |
| PDF 中文乱码 | 用设备系统中文字体；必须真机导出 + 电脑打开验证 |
| 时间计算错（跨天/改钟） | 核心时间逻辑写成纯函数 + 单测；真机测跨午夜、改钟、重启 |

## 18. 我替你做的决定（你看到不对就说）

1. 应用名 **清醒时光**、包名 `com.personal.waketime`（都能改，改名越早越好）。
2. v1 用 **JSON 文件存储**（按天/按周期），不上 SQLite；好处是简单、可直接当备份、导出就是 JSON。
3. 秒表 v1 **不做暂停**，只有「计次」和「结束计时」；暂停会让"这段时间算不算清醒"变含糊。
4. 通知栏里「计次」的**分段时刻 = 你点发送那一刻**（不是点按钮那一刻），因为系统输入框回传的只有发送动作。
5. 睡眠质量 v1 只留 **得分 / 手表总时长 / 备注** 三个可选手填字段，深睡/浅睡等留给 OCR 阶段。
6. **不做分类标签体系**，改用「常用备注词条」快选（最多 8 个），AI 分析靠备注文本自己归类。
7. 导出文件名用 ASCII（`waketime-2026-10-26.pdf`），标题内容仍中文。
8. 趋势图放 **M5**（正事做完再做），第一批交付里可能只有最简折线。
9. 截图 v1 只做"存进 App 并在当天记录里能看"，不做识别。
10. 不做"提醒你几点睡"的功能——倒计时只是参考。
11. **结束计时 ≠ 结束今天**：两条通知上的按钮都是"结束本次计时"，当天还可以在首页重新开始；cycle 只在次日录入或手动"结束今天"时关闭（§8.6）。
12. **允许补录过去日期**（只补睡眠数据、标记 backfilled，不伪造时间轴），避免漏一天就永久缺口（§8.7）。
13. **v1 就做"从 JSON 备份恢复"**，并把签名从 M1 定死，避免"换正式包必须卸载、数据全丢"（§8.8 / §11.5 / §13）。
14. 设备连接优先 USB + adb；不行用无线调试（adb pair over TCP）；再不行手动装 APK 你截图回传——三种方式我都能推进，只是迭代速度不同。

## 19. 第二批（v2 备份思路，不在本次范围）

- 截图 OCR（大模型识图或端侧 OCR）识别入睡/醒来/得分，人工确认后写入；
- 趋势图增强（按周/月聚合、睡眠与清醒段相关性）；
- 数据导入恢复、周报/月报一键导出；
- 桌面小组件、快捷设置磁贴（下拉控制中心直接"计次"）；
- 逐段手工编辑起止时间的完整编辑器。

---

**批准方式**：回复"设计通过"（或指出要改的点），我就进入实施计划（writing-plans）→ 搭工具链 → M1 空壳 APK。
