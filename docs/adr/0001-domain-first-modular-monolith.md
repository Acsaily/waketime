# ADR 0001：领域优先的模块化单体

- 状态：已采纳（用户确认 Q1、Q2、Q5–Q15、Q22）
- 日期：2026-11-26
- 来源：[工程演进调研](../outcomes/2026-11-26-engineering-architecture-research.md)、[实施计划](../superpowers/plans/2026-11-26-engineering-refactor.md)

## 背景

v0.9.0 的 TS 代码按技术角色分在 `pages`、`components`、`core`、`data`、`native`、`export`、`state`。纯计算已经不少，但 `useApp`、`store.ts` 同时承担业务规则、状态编排和平台副作用；类型归属也从 `data`/`native` 反向流入领域计算。运行形态是 APK 内的 React + Capacitor + Java 插件，不需要服务端或拆分部署。

## 决定

采用**领域优先的模块化单体**，保留现有 React / TypeScript / Capacitor / Java 栈：

```text
features → app → application → modules
                         ↘ ports ← infrastructure
```

- 核心域 `time-tracking`：周期、主睡眠、补觉、活动段、计时与历史规则。
- 支撑域 `classification`：分类目录、颜色、两级层级、生命周期。
- 只读 `analytics`：消费周期与分类目录，统一统计查询。
- `application`：跨域操作、唯一写入队列、恢复、导出、端口。
- `infrastructure`：Capacitor/文件/原生桥/反馈适配。
- `features`：按页面组织 UI；`shared/ui` 只放通用控件。
- 每个模块通过 `index.ts` 暴露经过选择的公开接口；跨模块不得深入内部实现。
- 不预建无内容层；只在真实 seam 建立 ports/adapters。

## 后果

- 纯领域可在 Node 测试，不依赖 React/DOM/Capacitor。
- 跨域写入集中到单一协调器，减少多个 store/副本竞争。
- 目录按业务局部性组织，新增功能有明确落点。
- 代价是应用层需要维护端口与队列；不能把“目录名”当作依赖规则本身，必须靠可执行检查。

## 验证

- `npm run arch:strict`：模块公开接口、领域无框架、application 边界、classification 独立。
- `npm run arch:check` + `scripts/arch-selftest.mjs`：规则观察期与负向 fixture。
- `tests/modules/publicInterfaces.test.ts`、`tests/application/*`、`tests/infrastructure/*`。
- `npm run test:differential` 证明行为未因迁移改变。

## 回滚

目录重构不伴随数据迁移；基线提交 `8307835` 保留旧结构。若结构方案失败，可从基线恢复旧目录并保留新测试契约；不需要迁移用户 `data.json`。回滚前必须保留未提交的用户/其他代理改动。
