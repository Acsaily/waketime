---
title: 数据生命周期
status: refactor/eng 源码重构与本地验收通过
baseline: schema 3 / v0.9.0
updated: 2026-11-27
---

# 数据生命周期

本页说明 `data.json`、原生计时状态、恢复路径和导出之间的关系。核心原则：**原生活动计时是 live 的唯一权威，TS `AppData` 是历史与设置的权威；任何整理都不能改变字段含义、schema 兼容或用户数据安全。**

## 数据模型

```ts
AppData {
  schemaVersion: 3
  appVersion: '0.9.0'
  settings: Settings
  cycles: Cycle[]
}

Settings {
  notificationsEnabled: boolean
  quickNotes: string[]            // 最多 8 个
  categories: CategoryDefinition[]
  hapticsEnabled: boolean
  soundEnabled: boolean
}

Cycle {
  id, timeZone, sleepAtMs, wakeAtMs
  sleepDurationMs, awakeBudgetMs, targetAtMs
  sleepMetrics, screenshotPath, source
  session: TimerSession | null
  closedAtMs, flags, createdAtMs, updatedAtMs
}

TimerSession { id, status: 'running' | 'ended', startedAtMs, segments: Segment[] }

Segment {
  id, seq, startAtMs, endAtMs, note, source
  category?: CategoryId
  splitFromId?: string
}

CategoryDefinition { id, name, archived, color?, parentId? }
```

权威定义在 [recordCodec.ts](../../src/application/recordCodec.ts)、[model.ts](../../src/modules/time-tracking/domain/model.ts)、[categories.ts](../../src/modules/classification/domain/categories.ts)。术语见 [GLOSSARY](../../GLOSSARY.md)。

## 真相来源

```text
Android TimerRepository / SharedPreferences("waketime_timer")
        │  getState / start / lap / split / merge / nap / end / close
        ▼
TS LiveState ──applyLiveState──> AppData.cycles 中的活动周期（整份替换）
        │
        ▼
data.json（历史 + 设置 + live 镜像）──load/normalize──> AppData
        │
        └──exportFormat──> TXT / JSON / PDF / 全量备份
```

- 原生返回的是“当天累计的活动段”，所以 `applyLiveState` **整份替换**该周期 `session.segments`，不与旧镜像拼接。
- 原生 `status === 'idle'` 时，TS 负责历史编辑；活动周期存在时，编辑先走原生命令，再把原生返回的完整段快照镜像落盘。
- `computeCycle` 的派生值随周期保存，但计算规则只在纯领域函数中。

## 启动与读取

`createApplication.initialize()` 的顺序：

1. `store.load()`：读取主文件；未来 schema 先拒绝；主文件可解析则返回 `{data, recoveredFrom: null}`。
2. 发布 `data`；若从 `data.prev.json`、`data.tmp.json` 或每日备份恢复，发布 `recoveredFrom`。
3. `store.save(result.data)`：把归一化/迁移后的数据安全写回；成功后 `safeToWrite = true`。
4. `refreshLive()`：原生非 idle 时读取 `getState`，发布 `live`，并在 `safeToWrite` 后镜像保存。
5. 发布 `ready: true`。

如果第 1 或第 3 步失败：`loadFailed = true`，`safeToWrite = false`，所有修改被拒绝，避免覆盖读不出来的数据；界面提示“已暂停修改以免覆盖数据”。前台刷新仍可读取原生状态，但在安全读取完成前不镜像。

浏览器存储是单键 `waketime.data`：没有 `prev/tmp/backups` 恢复链，未来版本在读写两侧都拒绝，损坏时直接报错。

## 写入顺序

所有业务写入经过 `queueEdit` 串行执行；前一个失败不会让队列永久拒绝后续操作。关键顺序：

| 操作                            | 顺序                                                                                                 | 失败语义                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 开始周期 `startCycle`           | 原生 `startCycle` → 截图（可失败但继续）→ 发布 live → 镜像 `data` → `save`                           | 原生已开始但镜像保存失败时，错误会报告；原生活动计时不回滚                                    |
| 直接开始本周期 `beginNextCycle` | `refreshLive()` → `startCycle`（两个 queued 操作）                                                   | 刷新失败仍可能继续开始；中间的通知栏计次不会进入旧历史（已知基线，见下）                      |
| 计次/备注/结束/重启/补觉        | 原生命令 → 发布 live → 镜像 `data` → `save`                                                          | 原生已提交；镜像失败会明确报错，不把原生数据当作已持久化到历史                                |
| 关闭周期 `closeCycle`           | `getState` → 原生 `endSession` → `save` 结束态 → 发布 → 原生 `closeCycle` → 写 `closedAtMs` → `save` | 第一次保存失败时原生已结束；第二次失败时结束态历史保留，但重试不会补 `closedAtMs`（已知基线） |
| 历史编辑/拆分/合并              | 刷新原生 → 历史保存成功后才发布；活动周期走原生命令并整份镜像                                        | 历史编辑失败不发布半次修改；活动周期变更时要求重新打开                                        |
| 分类管理                        | 取最新原生镜像 → `changeCategories` → `save` → 发布                                                  | 引用集合来自最新数据，不依赖陈旧历史                                                          |
| 设置/常用备注                   | 保存成功后发布；通知开关先写原生再写本地                                                             | 数据层写入失败不发布成功状态                                                                  |
| 恢复备份                        | 取最新原生镜像 → `buildRestoredData` 校验/冲突 → `save` → 发布 → 解除只读门禁                        | 冲突未确认、空备份覆盖、未来版本都在写盘前拒绝                                                |
| 清空记录                        | 原生 `closeCycle` → 发布 live null → 保存空 `cycles` → 发布                                          | 原生先关；磁盘失败保留旧可见/持久历史                                                         |

## 安全写盘与恢复

Android 文件实现见 [recordStore.ts](../../src/infrastructure/recordStore.ts)：

- 路径：`waketime/data.json`、`waketime/data.tmp.json`、`waketime/data.prev.json`、`waketime/backups/data-<stamp>.json`（保留最近 20 份）。
- 保存：先写 `tmp` 并回读解析校验；把当前主文件复制到 `prev`（best effort）；覆盖主文件并回读校验；失败用 `tmp` 重写一次。
- 读取：主文件 → `prev` → `tmp` → 最近备份（新到旧）；跳过读不了/不可解析/空候选；主文件不存在=新用户；主文件存在但坏且无候选=报错并保留文件。
- 未来 schema：主文件 `schemaVersion > 3` 时拒绝读取和保存，防止降级覆盖。
- 浏览器：单键写入串行；没有多文件恢复链。

这不是原子 rename 或 fsync 保证；契约是“候选可解析、主文件尽量可恢复”，测试明确接受**合法但非字节相等**的回读（已知基线）。任何强化写盘保证的改动必须单独决策并验证恢复路径。

## 恢复备份

`readRestoreBackup` 兼容旧的纯 Cycle 数组，以及 schema 1/2/3 文件；结构、分类目录或版本不兼容时拒绝且不改数据。

`buildRestoredData`：

- `overwrite` 且备份没有周期、本机有周期 → 拒绝，不能用空备份清空记录。
- 分类冲突逐项要求 `local` / `backup`；固定系统分类（`unclassified`、`sleep`）不产生冲突。
- 合并模式保留本机周期；覆盖模式只保留受保护的活动周期。
- 备份周期不覆盖受保护的活动周期 ID。
- 最后按 `wakeAtMs` 倒序，并补齐分类目录。

恢复不覆盖本机通知/常用备注等设置语义；它是“记录与分类目录”的恢复，不是整份设置无条件覆盖。

## 导出

`exportRecords` 从当前快照读取，不刷新、不写记录。统一导出卡片在单日仅一周期或明确选择某周期时调用此入口，并传入预览时刻；全量备份在独立「数据」区调用，使用原时钟与全量数据：

- TXT：单日时间轴、睡眠、预算、参考截止、分类汇总、趋势/超时、无备注段数。
- JSON：单日周期 + 设置 + 派生摘要（仍是 `buildBackupJson` 的形状）。
- 全量备份 JSON：`schemaVersion`、`appVersion`、`exportedAtMs`、`settings`、`cycles`、`cycleSummaries`、`trend`、`trendSummary`。
- PDF：原生 `PdfExporter` 渲染 `buildPdfBlocks` 的块。

`exportPeriod` 同样只读。范围按本地起床日筛选（含首尾日、同日全部周期、跨午夜不截断），预览与文件复用 `previewPeriod` 及同一统计时刻。TXT/PDF 组合选中周期明细及范围摘要，JSON 复用 schema 3 的备份形状，仅包含选中周期，新增 `exportRange` 标记起止日期与起床日口径；趋势只使用范围内记录。非法或空范围拒绝生成文件。周期导出不能替代全量备份。

全量备份**不等于**原生计时 XML/SharedPreferences 或截图的完整备份；原生活动状态连续性要靠原生状态测试和覆盖安装验证。

## schema 兼容

- 读取兼容 schema 1/2/3；写出一律 schema 3。
- 缺省字段按既有设计补齐（例如 `source`、`flags`、`sleepMetrics`、分类颜色/`parentId`）。
- 分类目录由 `completeCategories` 补齐；历史引用但目录缺失的分类成为停用占位，不根据备注猜分类。
- 未来版本：拒绝读取/保存，提示使用对应版本，不降级覆盖。
- 旧路径 `src/core`、`src/data`、`src/native`、`src/export` 已移除；兼容入口是 `tests/core/*` 等测试导入路径，不是生产双实现。

## 已知基线行为（保留，不当作本次回归）

以下行为在 v0.9.0 已存在，测试明确标注为 `known baseline limitation` 或 `divergence`。重构不以“顺手修复”改变它们；如要改变，必须单独获得用户确认并更新契约/差分预期。

| 行为                                                       | 影响                                        | 证据                                       |
| ---------------------------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| 刷新失败后仍可能开始下一周期                               | `beginNextCycle` 的两个 queued 操作不是原子 | `tests/application/application.test.ts`    |
| 刷新与原生开始之间的通知栏计次不进入旧历史                 | 旧周期镜像以刷新时快照为准                  | 同上                                       |
| 关闭周期第二次保存失败                                     | 结束态历史保留，但重试不会补 `closedAtMs`   | 同上                                       |
| 读取失败后通知开关仍可能先提交原生                         | 本地设置被只读门禁拒绝，但不覆盖历史        | 同上                                       |
| 合法但陈旧的读回被接受                                     | 不保证字节相等                              | `tests/infrastructure/recordStore.test.ts` |
| TS 合并会 trim 备注并把 notification 提升为 source         | Java 保留首段原文/首段 source               | `contracts/timer-cases.json` `D-merge`     |
| Java `setSegmentDetails(null)` 归一为空串，TS 拒绝非字符串 | 平台差异                                    | `D-null-note`                              |
| 重叠段统计：TS 裁剪 nap，Java 直接求和                     | 平台差异                                    | `D-overlap-summary`                        |

## 数据隐私与操作边界

- 生产备份原文件只读、放在仓库外；只通过 `--backup <绝对路径>` 进入本地差分，不复制、不打印内容。
- 真实备注、私人截图、备份、签名 key 不进入 Git、日志、外部服务或追踪文档。
- `.toolchain/`、`docs/backup-from-phone/`、`docs/shots/`、`docs/gpt-ds/`、`test-results/`、`playwright-report/`、`waketime-*.apk` 均被忽略。
- 任何改数据的测试只用合成 fixture、隔离内存/测试目录或明确授权的专用 MuMu 实例；不操作用户真实手机，不清除用户 `data.json`。
