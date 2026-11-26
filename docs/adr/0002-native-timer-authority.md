# ADR 0002：原生计时权威与 TS 历史权威

- 状态：已采纳（用户确认 Q5、Q9；计划 Task 4）
- 日期：2026-11-26
- 来源：[工程演进调研](../outcomes/2026-11-26-engineering-architecture-research.md)、[数据生命周期](../architecture/data-lifecycle.md)

## 背景

当前活动计时必须在锁屏、切后台、杀进程、通知栏无 WebView 时仍正确。Android 侧已有 `TimerRepository`、单调时钟/墙钟/开机标识、通知服务与快照并发校验；TS 侧 `data.json` 保存历史、设置和原生活动状态的镜像。若把 live 状态迁到 TS 或引入第二个可写 store，会破坏既有失败语义和离线可靠性。

## 决定

- **原生活动计时是 live 的唯一权威**：开始、计次、备注、拆分、合并、补觉、结束、重启、关闭都先走原生；TS 只镜像。
- **TS 是历史与设置的权威**：原生 idle 时的历史编辑、分类目录、导出、恢复由 TS 负责。
- 回前台/刷新时读取原生完整快照，`applyLiveState` **整份替换**活动周期段，不拼接旧镜像。
- 写入统一经过 `createApplication` 的串行队列；不新增第二个可写 store。
- 保留原生 `TimerRepository`/`TimerEnv`/`TimerService` 的状态与时钟机制；结构调整必须先保留 Java 测试与 TS/Java 共享契约。

## 后果

- 锁屏/进程恢复/通知栏操作保持 v0.9.0 行为。
- 原生已提交但镜像保存失败时，必须明确报错，不能显示“全部成功”或丢弃原生数据。
- 保留一些已知非原子路径（刷新后开始、关闭第二次保存失败、通知开关原生先提交），详见 [data-lifecycle.md](../architecture/data-lifecycle.md)。
- 不能在 Web 测试 adapter 上“补出”未经批准的原生能力。

## 验证

- `:app:testDebugUnitTest`：`TimerRepositoryTest` 与 `SharedTimerContractTest`。
- `contracts/timer-cases.json`：TS 与 Java 同一批合成案例，含 `common`、`java-only`、`divergence`、`ts-only`。
- `tests/application/application.test.ts`：原生优先、队列、失败语义、活动/历史编辑、恢复、通知偏好。
- `npm run test:differential`：固定 as-of 时刻比较旧/新活动段镜像与统计。

## 回滚

若原生/TS 协调方案失败，可从 `8307835` 恢复旧 `useApp`/`store`/原生桥的调用顺序；不改变 `SharedPreferences` 键或 JSON 字段。回滚前先用 `data.json` + 原生状态快照验证当前未完成写入，避免丢掉原生已提交的段。
