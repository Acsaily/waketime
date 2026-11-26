# ADR 0003：schema 3 JSON 兼容与安全写盘

- 状态：已采纳（用户确认 Q3、Q9、Q19；计划 Global Constraints）
- 日期：2026-11-26
- 来源：[v0.9.0 状态](../project/STATUS.md)、[数据生命周期](../architecture/data-lifecycle.md)

## 背景

用户数据全部在应用私有目录的 `data.json`，另有每日备份、`data.prev.json`、`data.tmp.json` 和导出 JSON。Capacitor Filesystem 没有 fsync/原子 rename 保证；历史上已经通过三文件兜底、未来版本拒绝、恢复冲突确认来保护数据。工程重构不能改变字段含义、schema 兼容或恢复语义。

## 决定

- 继续使用 JSON 文件，不引入 SQLite 或新的存储架构。
- 写出 schema 3；读取兼容 schema 1/2/3；未来版本拒绝读取和保存，防止降级覆盖。
- 保留 `waketime/data.json`、`data.tmp.json`、`data.prev.json`、`backups/data-<stamp>.json`（最近 20 份）及浏览器单键存储。
- 保存顺序：写 tmp 并回读校验 → 复制 prev（best effort）→ 写主文件并回读校验 → 失败用 tmp 重试。
- 恢复候选：prev → tmp → 最近备份；主文件缺失=新用户；主文件坏且无候选=报错并保留文件。
- 恢复备份：拒绝空备份覆盖；分类冲突逐项确认；保护活动周期；不按同名自动合并。
- 不删除/覆盖用户 `data.json`；数据相关改动先备份、再改、再验证恢复路径。

## 后果

- 现有用户升级不需要数据迁移工具；旧备份仍可恢复。
- 写盘不是严格原子；契约是“可解析候选可恢复”，测试接受合法但非字节相等的回读。
- 任何强化写盘（例如 fsync/rename）或改变 schema 的决定都需要单独 ADR、迁移与回滚演练。

## 验证

- `tests/infrastructure/recordStore.test.ts`：恢复优先级、坏候选、未来版本、串行写、备份保留 20 份。
- `tests/data/*`、`tests/property/domain.test.ts`：schema 1/2/3 迁移、导出恢复往返、合法字段保留。
- `tests/application/application.test.ts`：恢复冲突、活动周期保护、写失败语义。
- `node scripts/verify.mjs private ...`：生产备份只读差分，确认原文件未改变。

## 回滚

存储实现保留在 `src/infrastructure/recordStore.ts`，基线实现可从 `8307835` 对照。回滚必须先保留当前用户 `data.json` 与备份，不执行清空/覆盖；用合成 fixture 或隔离副本验证恢复路径后再切换。schema 3 已发布，不能通过降级覆盖用户数据回滚。
