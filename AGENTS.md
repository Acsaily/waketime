<!-- meta-codex-template: minimal/AGENTS.md.template@0.1.0 -->
# 清醒时光（waketime）项目工作守则

## 项目目的

自用的安卓 App：记录每天睡眠起止与清醒时间（倒计时 / 秒表 / 计次备注），按天存档，可导出 TXT / PDF / JSON 给电脑上的 AI 做作息分析。侧载安装、不联网、无账号。

## 权威来源（先读这些，不要重复造）

- 项目导航：`docs/project/INDEX.md`
- 当前状态：`docs/project/STATUS.md`
- 可复用结论：`docs/outcomes/`
- 产品与构建说明：`README.md`
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

npm.cmd run build            # tsc --noEmit + vite build -> dist
npm.cmd test                 # vitest（33 个用例，2026-10-27 基线）
npx.cmd cap sync android
.\android\gradlew.bat :app:assembleDebug   # 或 :app:assembleRelease
```

- JDK 必须是 `.toolchain/jdk21`，**不要用系统 JDK 25**；AGP 8.13.0 / Gradle 8.14.3 / compile+targetSdk 36 / minSdk 24。
- 真机：`adb devices`；USB 打不开设备句柄时用无线调试（`adb pair <ip:port> <code>` → `adb connect <ip:port>`），端口每次可能变。
- 交付物命名：根目录 `waketime-<version>-release.apk`；debug/release 同一把自有签名 key，覆盖安装不丢数据。

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
