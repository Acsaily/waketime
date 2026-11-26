<!-- meta-codex-template: minimal/AGENTS.md.template@0.1.0 -->

# 清醒时光（waketime）项目工作守则

## 项目目的

自用的安卓 App：记录每天睡眠起止与清醒时间（倒计时 / 秒表 / 计次备注），按天存档，可导出 TXT / PDF / JSON 给电脑上的 AI 做作息分析。侧载安装、不联网、无账号。

## 权威来源（先读这些，不要重复造）

- 项目导航：`docs/project/INDEX.md`
- 当前状态：`docs/project/STATUS.md`
- 可复用结论：`docs/outcomes/`
- 产品与构建说明：`README.md`
- 架构与决策：`docs/architecture/`、`docs/adr/`
- 验证入口与证据边界：`docs/architecture/verification.md`、`scripts/verify.mjs`
- 项目 verify skill：`docs/skills/verify/SKILL.md`（`.claude/` 被忽略，权威文本在 docs）
- 设计与计划：`docs/superpowers/specs/`、`docs/superpowers/plans/`
- GPT 协作记录：`docs/gpt-ds/`
- 真机证据（截图 / 导出样本）：`docs/shots/`、`docs/backup-from-phone/`

## 开始一个任务

1. 先定一个预期产出与完成标准，再动手。
2. 有历史依赖（改功能、修 bug、恢复数据）时先查 `STATUS`、`docs/outcomes/` 和 `git status`，给出 `CONTINUE` / `REUSE` / `MERGE` / `NEW` 判断。
3. 只读最小必要上下文，不整库通读。
4. 区分"观察到的 / 推断的 / 建议的 / 已采纳的决定"，不要把推断写成事实。

## 构建与验证命令

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\scripts\env.ps1          # JAVA_HOME=.toolchain/jdk21、ANDROID_HOME、GRADLE_USER_HOME、npm 缓存

npm.cmd ci                   # 依赖（postinstall 给 vite 打沙箱补丁）
npm.cmd run build            # tsc --noEmit + vite build -> dist

node scripts/verify.mjs check    # 日常快速门：typecheck + 观察模式 lint/arch + 单测
node scripts/verify.mjs strict   # 严格本地验收：strict lint/arch + format + 属性 + 差分 + E2E + 原生 JUnit
node scripts/verify.mjs list     # 查看 area 与检查映射

npx.cmd cap sync android
.\android\gradlew.bat :app:testDebugUnitTest      # 原生 JUnit
.\android\gradlew.bat :app:assembleDebug          # 或 :app:assembleRelease
```

- JDK 必须是 `.toolchain/jdk21`，**不要用系统 JDK 25**；AGP 8.13.0 / Gradle 8.14.3 / compile+targetSdk 36 / minSdk 24。
- 差分基线是隔离的 `8307835` 树：`node scripts/verify.mjs baseline --check`；缺失时按 `docs/architecture/verification.md` 用 `git archive` + `npm ci` 重建。不要用候选 re-export 冒充基线。
- 属性失败用 `node scripts/verify.mjs property --seed <n> --path <path>` 重放；生产备份只用 `node scripts/verify.mjs private --backup <仓库外绝对路径> --now <ms> --tz <zone>`，不复制/打印内容。
- 真机：`adb devices`；USB 打不开设备句柄时用无线调试（`adb pair <ip:port> <code>` → `adb connect <ip:port>`），端口每次可能变。MuMu 只在明确授权的测试实例、显式 `--serial` 和 `--execute` 下操作。
- 交付物命名：根目录 `waketime-<version>-release.apk`；debug/release 同一把自有签名 key，覆盖安装不丢数据。正式签名缺失时不得把 debug APK 当作 release 交付。
- `check` 通过不等于验收；`strict` 也不等于 APK/设备 E2E 完成。完整验收证据清单见 `docs/architecture/verification.md`。

## 工程结构与验证（2026-11-26 已确认）

- 代码地图：[docs/architecture/overview.md](docs/architecture/overview.md)、[module-map.md](docs/architecture/module-map.md)、[data-lifecycle.md](docs/architecture/data-lifecycle.md)。
- 关键决定：[docs/adr/](docs/adr/0001-domain-first-modular-monolith.md)。
- 依赖规则：`npm run arch:check` 观察、`npm run arch:strict` 强制；模块只通过 `index.ts` 公开接口，UI 不直接持久化/调用计时插件。
- 验证分层：领域/应用/数据/契约/UI/原生；先证明检测器（差分自检、属性 seed 重放），再比较候选。
- 历史记录、既有 outcome 和本文件原有规则不重写；新增规约必须同时写出来源、范围、验证证据和回滚办法。

### 已确认工程规约

| 规约                                                                            | 来源                                   | 范围                                         | 验证                                    | 回滚                                                        |
| ------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| v0.9.0（`8307835`）行为、统计、导出和 schema 3 是基线，不借结构整理改变数据含义 | 用户 Q3、Q22、Q26                      | 全部重构改动                                 | 差分、属性、共享契约、生产备份只读回归  | 从基线提交恢复实现；不迁移/覆盖用户数据                     |
| 同一共享写入区域/设备同时只有一个所有者                                         | 用户 Q14、Q23；计划 Global Constraints | 源码、配置、MuMu 设备                        | 写入队列测试、依赖门、工作流台账        | 停止该写入者并重新分配；保留已确认数据                      |
| 原生活动计时权威；TS 历史/设置权威；不新增第二个可写 store                      | 用户 Q9、Q13、Q15                      | app/application/infrastructure、Android 计时 | JUnit、TS/Java 契约、应用协调测试、差分 | 从 `8307835` 恢复旧调用顺序；不改 SharedPreferences/JSON 键 |
| 新规则先观察（warn）后强制；不删除检查、不降低断言                              | 用户 Q16–Q18、Q25                      | lint、arch、format、测试入口                 | `arch-selftest`、`check`/`strict` 实跑  | 单条规则退回 warn 并记录原因；不得静默跳过                  |
| 生产备份只读、仓库外、显式参数；不操作真实手机                                  | 用户 Q19、Q24、Q27                     | 差分、MuMu、证据                             | `private` 差分原文件不变、忽略目录检查  | 停止运行并作废该次结果；保留原文件，不尝试“修正”            |

## 产出与证据

- 结论要落成可复用记录（`docs/outcomes/`），不留在聊天里。
- 声称"完成/修好"前必须有证据：单测通过、构建成功、真机截图或读回的文件内容；构建日志本身不算真机验证。
- 改动完成后更新 `docs/project/STATUS.md` 的已验证事实与下一步（小步）。
- 数据相关改动（`src/data/store.ts`、备份/恢复、迁移）必须先备份、再改、再验证恢复路径；**任何情况下不要清掉或覆盖用户 `data.json`**。

## 红线与边界

- 不提交 / 不推送 / 不初始化 git、不建自动化，除非用户明确授权。
- 不复制密钥、签名文件、账号信息到文档或聊天；`.toolchain/` 不进 git。
- 不碰无关目录：`out/`、`tools/` 属于其它工作线；`docs/session-notes.md` 是历史笔记，不当作当前状态。
- 不覆盖既有文件；需要改进时提最小补丁并保留原内容。

## 修改本守则的规则

- 单次纠正先记为观察，不自动升级为规则。
- 规则采纳需要：来源、适用范围、验证证据、用户批准、回滚办法；写进本文件时保持简短，细节放链接。
