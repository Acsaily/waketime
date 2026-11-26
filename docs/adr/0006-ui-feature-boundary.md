# ADR 0006：UI feature 边界与 AppApi 公开契约

- 状态：已采纳（用户确认 Q10、Q12、Q13、Q14、Q15；计划 Task 5）
- 日期：2026-11-26
- 来源：[实施计划](../superpowers/plans/2026-11-26-engineering-refactor.md)、[模块地图](../architecture/module-map.md)

## 背景

原 `pages` / `components` 通过一个 `useApp` 返回的全局 `AppApi` 共享状态和操作；部分页面仍直接调用 Capacitor 文件/分享/PDF 插件。重构要把业务编排移出 React，同时保留现有页面、按钮、滚动/滑动、统计下钻、分类管理、导出/恢复交互。

## 决定

- UI 按页面 feature 组织：`today`、`history`、`statistics`、`settings`；跨 feature 的通用控件放 `shared/ui`；样式按基础/公共/feature 归属。
- `AppApi` 保留既有业务动作，并补充经过批准的窄操作（设备信息、导出、恢复、反馈）；由 `application/index.ts` 公开。
- React 只通过 `useSyncExternalStore` 订阅快照，管理显示时钟、生命周期和操作转发；不直接持久化、不直接调用计时业务插件。
- 不引入 Redux/Zustand 或第二个可写 store。
- 页面依赖 `AppApi` 和模块公开只读查询；显示格式可用模块公开函数，但不在 UI 重写业务规则。
- 新的平台能力先加 `ports.ts` 窄接口，再由 `infrastructure` 实现，不从 feature 直接 import Capacitor。

## 后果

- 页面可以在不启动 Android 的情况下用 RTL/浏览器 E2E 测关键交互。
- `AppApi` 成为稳定的 UI 契约，新增动作需要明确命名和测试，不暴露任意全局状态修改。
- 迁移期间旧 `pages/components` 桥接已移除；若发现遗漏调用方，必须回到统一应用操作，而不是恢复页面直连插件。
- 视觉不能因目录/CSS 整理而重画；以 375×812 / 360×800 截图和关键交互为基线。

## 验证

- `tests/ui/features.test.tsx`：今日/历史/统计/设置关键交互。
- `tests/e2e/features.spec.ts`：375×812 / 360×800 历史编辑/拆分/合并、统计展开/下钻/分类管理、设置导出/恢复冲突。
- `npm run arch:strict`：feature 不得直连持久化/原生/适配器；只能引用 `application/index.ts`。
- 22 组配对视觉状态（18 精确、4 单字形像素差）为迁移期视觉证据；最终以实际集成验收为准。

## 回滚

`8307835` 保留旧 `pages`/`components`/`useApp` 实现。若 feature 方案失败，可从基线恢复页面与旧 `AppApi` 适配，但必须保留已通过的领域/应用测试和统一写入队列；不得恢复多个竞争 store。回滚不涉及用户数据。
