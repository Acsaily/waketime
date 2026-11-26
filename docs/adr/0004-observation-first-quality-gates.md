# ADR 0004：先观察后强制的可执行质量门

- 状态：已采纳（用户确认 Q16、Q17、Q18、Q21、Q25；计划 Global Constraints）
- 日期：2026-11-26
- 来源：[实施计划](../superpowers/plans/2026-11-26-engineering-refactor.md)、[验证文档](../architecture/verification.md)

## 背景

v0.9.0 已有严格 TypeScript、Vitest、JUnit、浏览器和真机检查，但没有受跟踪的 lint/format/依赖方向配置，也没有统一本地入口。迁移期间旧代码会产生告警；如果一上来就全量阻断，会迫使实现者用删除检查或大规模格式化“过关”，掩盖真实回归。

## 决定

- 建立本地可执行质量门：ESLint + typescript-eslint、Prettier、dependency-cruiser、Vitest、React Testing Library、Playwright；原生沿用 JUnit。
- 新规则先在观察模式（warn）运行，在已整改代码上再提升为 error；不使用远程 CI 或自动发布。
- 区分两个入口：
  - `check`：快速、观察期，供日常迭代；
  - `strict`：阻断式，严格 lint/arch、格式、属性、差分、E2E、原生 JUnit。
- 统一入口是 [scripts/verify.mjs](../../scripts/verify.mjs)，底层继续复用 package scripts。
- 验证者拥有验收契约；实施者不得删除检查、降低断言、把失败当成功，或通过静默重试隐藏失败。
- 同一检查连续三轮实质修复仍失败时升级，不靠重试碰运气。

## 后果

- 迁移期间输出会有 warn，但每条都必须被阅读和收敛。
- `check` 通过不等于验收；`strict` 也不等于 APK/设备验收。
- 格式化只应针对改动文件逐步收敛，禁止借机全仓重排；最终严格门要求 `format:check` 全通过。

## 验证

- `scripts/arch-selftest.mjs`：规则自检与负向 fixture（当前 34 条合成违规）。
- `tests/tooling/config.test.ts`：Vitest 不拾取 E2E、Playwright 不重用未知预览服务器。
- `node scripts/verify.mjs check` / `strict`：实际执行并输出每一步。
- 规则提升前在已迁移代码上跑严格门，确认不会误伤合法依赖。

## 回滚

任一规则若造成大量误报，可保留在 warn/观察模式并记录原因；不得直接删除规则或把 `strict` 改成静默跳过。回滚单位是单条规则 + 其自检 fixture；旧 `package.json` 脚本保留，必要时可回到 `npm run check`/`npm run verify`。
