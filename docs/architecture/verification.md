---
title: 本地验证与质量门
status: refactor/eng 已完成源码重构，本轮按现有验收证据收尾
updated: 2026-11-27
---

# 本地验证与质量门

本页回答四件事：**改完跑什么、失败怎么重放、基线怎么重建、哪些证据不能公开**。入口是 [scripts/verify.mjs](../../scripts/verify.mjs)；它复用 `package.json` 的 `typecheck`、`lint`、`arch`、`test`、`format`、`differential`、`e2e` 脚本，不另造一套检查实现。

## 两种门：check 与 strict

| 维度           | `check`（日常）                 | `strict`（验收）                               |
| -------------- | ------------------------------- | ---------------------------------------------- |
| 目的           | 快速反馈，允许观察期告警        | 阻断式验收，不允许静默跳过                     |
| 类型检查       | `npm run typecheck`             | 同左                                           |
| Lint           | `npm run lint`（规则仍为 warn） | `npm run lint:strict`（`--max-warnings 0`）    |
| 依赖方向       | `npm run arch:check`（warn）    | `npm run arch:strict`（同一规则提升为 error）  |
| 格式           | 不检查                          | `npm run format:check`                         |
| 单元/属性/黄金 | `npm test` 或按 area 选择       | 同左                                           |
| 属性独立入口   | 不额外跑                        | `npm run test:property`                        |
| 差分           | 不跑                            | `test:differential:self` + `test:differential` |
| 浏览器 E2E     | 不跑                            | `test:e2e:strict`                              |
| 原生 JUnit     | 仅 `--with-native`              | 默认 `:app:testDebugUnitTest`                  |
| MuMu/APK E2E   | 不做                            | **也不做**；需单独显式设备命令                 |

```powershell
node scripts/verify.mjs check
node scripts/verify.mjs strict
```

- `check` 是观察期门：`lint`/`arch` 的 warn 不会阻断迁移，但必须阅读输出。它**不能**作为最终验收证据。
- `strict` 是本地代码验收：严格 lint/arch、格式、属性、差分、浏览器 E2E、原生 JUnit。它仍**不等于**完整交付验收，因为 APK 构建/覆盖安装/真实 MuMu 交互是单独的显式步骤。
- `strict --no-native` 只用于工具链确实不可用的临时排查；最终验收不得用它绕过原生测试。

已有的 `npm run check` / `npm run verify` 保留为底层脚本；`verify.mjs strict` 比旧 `npm run verify` 多出原生 JUnit 和按 area 选择，少的是“不隐式声明设备 E2E 已完成”。

## 按改动选 area

```powershell
node scripts/verify.mjs check --areas ui
node scripts/verify.mjs strict --areas domain,application,data
node scripts/verify.mjs strict --areas contract
```

| Area          | Vitest 路径                                                                                         | 触发的严格门             |
| ------------- | --------------------------------------------------------------------------------------------------- | ------------------------ |
| `domain`      | `tests/modules`、`tests/core`                                                                       | property、differential   |
| `application` | `tests/application`、`tests/infrastructure`                                                         | property、differential   |
| `data`        | `tests/data`、`tests/infrastructure/recordStore.test.ts`、`tests/infrastructure/codecClock.test.ts` | property、differential   |
| `contract`    | `tests/contracts`                                                                                   | differential、原生 JUnit |
| `ui`          | `tests/ui`                                                                                          | 浏览器 E2E               |
| `native`      | 无（JUnit only）                                                                                    | 原生 JUnit               |

不传 `--areas` 表示完整范围：所有 Vitest 用例、property、differential、E2E、原生 JUnit。静态检查（typecheck/lint/arch/format）始终运行。`node scripts/verify.mjs list` 可打印同一张表。

## 独立基线：8307835

差分测试比较**真实旧实现**与候选实现。旧实现必须来自隔离目录，不能从当前工作树反向 export，也不能把候选 re-export 当成基线。

默认位置：

```text
.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/
```

检查与重建：

```powershell
node scripts/verify.mjs baseline --check
node scripts/verify.mjs baseline --rebuild
```

手工等价步骤（PowerShell）：

```powershell
$dir = ".superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
git archive --format=tar 8307835 | tar -x -C $dir
Push-Location $dir
npm.cmd ci
Pop-Location
```

手工等价步骤（bash）：

```bash
dir=.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835
mkdir -p "$dir"
git archive --format=tar 8307835 | tar -x -C "$dir"
(cd "$dir" && npm ci)
```

要点：

- `git archive` 只读取提交，不切换分支、不改当前工作树；不需要提交/推送。
- 基线目录只安装它自己的 `package-lock.json` 依赖（`npm ci`），与当前候选的 `node_modules` 隔离。
- [differential-baseline.ts](../../scripts/differential-baseline.ts) 固定绑定基线真实入口；不要为了“跑通”把它改成候选入口。候选绑定在 [differential-candidate.ts](../../scripts/differential-candidate.ts)。
- `.superpowers/sdd` 被忽略；基线、临时产物和证据不进入 Git。
- 基线缺失时 `require-baseline.mjs` 会明确失败，不会静默跳过差分。

## 差分测试

### 自检：先证明检测器有效

```powershell
npm run test:differential:self
```

自检包含 old-v-old（应零差异）和六类故意扰动（应被检出）。先通过自检，才说明“零差异”不是检测器失灵。

### 候选 vs 基线

```powershell
npm run test:differential
```

- 固定 `nowMs` 与 `TZ`（合成案例覆盖 `Asia/Shanghai`、`UTC`、`America/New_York`）。
- 比较字段覆盖周期、段、备注、分类、来源、统计、历史/月/趋势、导出 TXT/JSON/PDF 块、恢复冲突等；数组顺序参与比较，普通对象属性顺序不参与。
- 输出只包含受控字段名和聚合计数；不输出备注内容、真实 ID 或输入文件名。
- 26 组合成差分是目前记录的基线；任何新增差异都要先判断是“基线已有行为”还是回归。

### 生产备份只读差分

```powershell
node scripts/verify.mjs private `
  --backup E:\path-outside-repo\waketime-backup.json `
  --now 1795708800000 `
  --tz Asia/Shanghai
```

- `--backup` 必须是**仓库外的绝对路径**；wrapper 会拒绝仓库内路径。
- `--now` 必须是不早于所有记录边界的 epoch 毫秒；`--tz` 只接受 `Asia/Shanghai`、`UTC`、`America/New_York`。
- 脚本只读原文件，并在结束时再次读取比较原文，确认原文件未改变；不复制、不打印真实内容。
- 输出是聚合差异；失败信息在 private 模式下也不会带出输入细节。
- 已验证记录：**16 个周期 / 140 段，旧/新字段与分类目录差异为 0，原文件未改变**。这是 JSON 数据回归，不等于原生计时状态/覆盖安装证据。

## 属性测试与 seed 重放

```powershell
npm run test:property
node scripts/verify.mjs property --seed 26092601 --path 12:3
```

- [tests/property/domain.test.ts](../../tests/property/domain.test.ts) 使用 fast-check，默认 `numRuns: 200`，每个属性有独立 seed（`26092601 + index`）和独立 oracle（不调用被测实现生成预期）。
- 覆盖：统计守恒、拆分外边界/稳定 ID/开放尾段、非法拆分原子拒绝、合并、分类树无环/生命周期、迁移与恢复保留合法字段、导出恢复往返等。
- 失败时 fast-check 会给出 `seed` 与 `counterexamplePath`；用 `FC_SEED` / `FC_PATH`（或 wrapper 的 `--seed` / `--path`）重放。
- 测试自身包含“故意破坏后能重放最小反例”的检查，防止 seed/path 入口失效。
- 已知基线不满足的更强属性要记录反例并单独决策，不能通过放宽原有行为隐藏回归。

PowerShell 直接设置环境变量：

```powershell
$env:FC_SEED = '26092601'
$env:FC_PATH = '12:3'
npm.cmd run test:property
```

## 原生：JDK 21 + Gradle

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\scripts\env.ps1
.\android\gradlew.bat :app:testDebugUnitTest --console=plain
```

或：

```powershell
node scripts/verify.mjs strict --areas native
```

- 必须使用 `.toolchain/jdk21`；**不要用系统 JDK 25**。`verify.mjs` 在缺少该 JDK 时直接失败，不会悄悄回退系统 Java。
- AGP 8.13.0 / Gradle 8.14.3 / compile+targetSdk 36 / minSdk 24；`GRADLE_USER_HOME` 在 `.toolchain` 下。
- `contracts/timer-cases.json` 已通过 Gradle `inputs.file` 和 `waketime.contracts` system property 接入测试；改 fixture 会让 `:app:testDebugUnitTest` 重新执行，不依赖 UP-TO-DATE 缓存。
- 原生单测不需要读取签名 key；构建 release APK 才需要既有签名配置。当前正式签名配置缺失时，只能使用模拟器 debug 身份做测试，不得把 debug APK 当作 release 交付。

## MuMu 原生 E2E

MuMu 是**单独授权的设备步骤**，不在 `check`/`strict` 里自动运行。主路线是 ADB + UI Automator/截图；Computer Use 仅作可选的视觉探索，且需要明确的前台输入授权。

### 身份与显式目标

已验证过的测试目标是 MuMu 实例 1（`Android Device-1`，Android 15 / SDK 35），serial `127.0.0.1:16416`。端口/实例可能变化，**每次运行都要重新确认**，不能沿用旧端口或盲扫。

```powershell
# 假设备自测：不连接 ADB、不操作 MuMu
node scripts/verify.mjs mumu -- selftest

# 只读身份确认
node scripts/verify.mjs mumu -- identity `
  --adb "<MuMu adb.exe 绝对路径>" `
  --manager "<MuMuManager.exe 绝对路径>" `
  --instance 1 `
  --serial 127.0.0.1:16416

# 先看计划，不执行
node scripts/verify.mjs mumu -- scenario plan <name> `
  --adb "<MuMu adb.exe>" --instance 1 --serial 127.0.0.1:16416

# 显式执行；没有 --execute 时 mumu-cli 只打印计划
node scripts/verify.mjs mumu -- scenario run <name> `
  --adb "<MuMu adb.exe>" --instance 1 --serial 127.0.0.1:16416 --execute
```

守卫要求：

- `MuMuManager info` 中实例索引、名称、`player_state`、`adb_host_ip:adb_port` 必须与 `--serial` 唯一对应；不一致就停止。
- 所有设备命令由守卫加 `-s <verified serial>`；不接受手写 `-s`，不重启共享 ADB server，不扫描未知端口。
- 默认包名 `com.personal.waketime`、Activity `.MainActivity`；可用参数显式覆盖。
- 同一时间只能有一个设备操作所有者；身份不清或设备忙时停止，不阻塞本地代码验证。
- 证据目录默认 `test-results/mumu-e2e/<run>`（已忽略）；截图/UI 树/JSON 不进入追踪文档。
- 不操作用户真实手机；不卸载/清除用户数据；测试实例上的合成数据可重建。

### 原生验收未完成时的表述

候选 APK 构建、同签名覆盖安装、通知栏操作、前后台恢复、PDF/分享、冷启动等仍需要单独执行并读回。**只安装成功、只打开页面、只看截图都不算 E2E 通过。** 在拿到实际 APK 与设备读回证据前，文档只能说“准备/部分证据”，不能说“完整 E2E 或最终 APK 已通过”。

## 证据与隐私

- 追踪文档只写聚合结果、命令和判断；不写真实备注、真实分类名、私人截图、备份路径或签名凭据。
- `docs/backup-from-phone/`、`docs/shots/`、`docs/gpt-ds/`、`test-results/`、`playwright-report/`、`blob-report/`、`waketime-*.apk`、`.toolchain/`、`.claude/` 均被忽略。
- 差分输出只使用受控字段词汇；private 模式失败也不带输入细节。
- 不把生产备份复制到仓库、临时目录之外或外部服务；只读、仓库外、路径由本地参数提供。
- 不新增不必要的敏感文件哈希到追踪文档；已有历史记录保留原样。

## 已知基线行为

差分与契约测试明确保留以下差异/限制；详见 [data-lifecycle.md](data-lifecycle.md) 的“已知基线行为”：

- 刷新失败后可能继续开始新周期；刷新与原生开始之间的通知栏计次不进入旧历史。
- 关闭周期第二次保存失败时，结束态历史保留但重试不补 `closedAtMs`。
- 读取失败后通知开关仍可能先提交原生，本地设置被门禁拒绝。
- 合法但陈旧的读回被接受，不保证字节相等。
- TS/Java 在合并备注 trim/source、`null` 备注、重叠段统计上存在已记录差异。

这些不是本次重构要“顺手修掉”的回归；改变它们需要单独用户确认、契约更新和差分预期更新。

## 当前证据边界

截至 2026-11-27，严格本地门执行成功：

- Vitest **229 通过 / 1 个私人样本显式跳过**；浏览器 Playwright **6 通过**；原生 JUnit **36 通过**。
- 严格 lint、arch、format、类型检查通过；34 条合成架构违规检出；26 组合成差分零差异，自检能检出六类扰动。
- 生产备份差分：**16 周期 / 140 段，字段与分类目录零差异，原文件未改变**。
- 模拟器测试签名 debug APK 已构建并覆盖安装，主要原生业务路径通过，23 组 MuMu helper 假设备自测通过。用户明确暂缓剩余系统交互；idle 快照比较误报仍记录为工具缺口。

当前交付检查点及待验项目见 [工程重构验收记录](../outcomes/2026-11-27-engineering-refactor-acceptance.md)。正式签名缺失，不发布生产 APK。
