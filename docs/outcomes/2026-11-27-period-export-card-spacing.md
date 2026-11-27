# 卡片间距与周期导出增量验收

## 变更范围

基于 `refactor/eng` 的 `7159ce7`，增量分支 `feat/period-export-card-spacing`。设计见 [自问式决策](../superpowers/specs/2026-11-27-period-export-card-spacing-design.md)。保留 schema 3、版本 0.9.0、原生计时、既有单周期导出和全量备份。

### 卡片间距

观察：分类统计面板的 `.history-panel` 是普通 block，直接相邻卡片之间测得 0px；历史周趋势和每日明细子面板原有 12px gap。改为共享面板纵向 flex，gap 12px，范围限于历史、统计面板，未修改全局卡片 margin。历史原有节奏保持。

- 红灯：两种尺寸的统计卡片几何检查失败（0px），历史通过。
- 绿灯：375×812、360×800 的统计和历史四项检查通过；统计展开/收起、历史两个子面板、全程滚动、末卡与底栏距离及无横溢出均有断言。

### 周期导出

设置 → 导出与备份（统一卡片）。负责人体验首版后明确要求去除双卡片；单个日期范围、一个动态预览、一组格式按钮。单日只有一周期自动使用原单周期文件；同日多周期默认全部，可精确选择其中一个，日期编辑清除选择。单周期保留分类汇总和原 TXT/PDF 全历史趋势，统计时刻与预览一致。全量备份独立放在「数据」区。五个快捷项直接填充可编辑日期；默认本周。按本地起床日含首尾，保留同日多周期与跨午夜完整记录。预览展示有记录的天数、周期数、总睡眠、实际清醒、未结束提醒。无数据/非法范围禁用范围导出，应用层拒绝不合法请求。TXT/PDF 组合范围摘要和原有逐周期明细；JSON 复用原有字段结构，仅包含所选周期，带 `exportRange` 起止日期与归档口径。范围统计在选中记录内计算，开放周期以预览时刻为准；只读快照，不刷新、改写或迁移记录。

## 验证证据

- `npx vitest run tests/application/periodExport.test.ts tests/application/application.test.ts`：4 个新增检查先因接口未实现失败，再 43/43 通过。
- `npx vitest run tests/ui/features.test.tsx`：新增交互红灯后 6/6 通过。验证快捷项可编辑、开放周期提醒、倒序、共享导出锁。
- `node scripts/verify.mjs strict`：exit 0；类型、严格 lint/arch、格式通过；Vitest 237 通过/1 私人样本显式跳过；属性 9 通过；差分自检识别 6 类扰动，26 组合成基线差分无差异；Playwright 14 通过（含新增的空统计面板检查），原生 JUnit Gradle 成功（原生输入未改，使用 UP-TO-DATE 结果）。
- `npx playwright test tests/e2e/period-export.spec.ts tests/e2e/spacing.spec.ts`：6 通过。浏览器实际下载并解析 TXT/JSON；合成范围 1 天 / 2 周期、总睡眠 12h、实际清醒 9h，预览和文件一致；范围外记录未导出，localStorage 数据原文未变；PDF 请求由应用端口测试，浏览器提示原生限制。
- 视觉证据：忽略目录 `test-results/spacing-*/` 中 `stats-*-top|expanded|bottom.png`、`history-week|days-*-top|bottom.png`；`test-results/period-export-*/period-preview.png`、`period-empty.png`。均使用合成记录，重跑对应 E2E 可再生成。

### 统一入口体验反馈回归

- 红灯：旧布局仍有第二组「周期 JSON」按钮；单周期导出未使用预览时刻，4h 开放周期被导出成 5h。修订后应用/UI 47/47 通过。
- 375×812、360×800 浏览器实际下载：单日全部 2 周期（12h 睡眠/9h 清醒），精确选择 `2026-11-09-2`（3h/2h，单周期原文件名，无范围标记），跨日 4 周期，单日唯一周期自动单文件，全量备份 4 周期（独立数据区，无范围标记）；原始运行数据不变。完整严格门 14 E2E 通过。截图另含 `single-cycle-preview.png`。

## 独立评审与修订

独立代理按原始需求及 `7159ce7` 增量评审，无阻断发现。接受并修正：TXT/PDF 范围末尾趋势提示、空统计卡片 36px → 12px（两个尺寸先失败）、JSON `exportRange` 元数据、预览明确“记录 X 天”、日期错误的无障碍提示；新增跨月选择用例，范围单测在 `America/New_York` 下 4/4 通过。相关应用/UI 测试修订后 50/50 通过。单周期原有趋势提示默认不变。

统一入口独立复审无阻断问题。采纳修订：无周期时也能备份设置/分类；共享操作状态只显示一次，数据与导出操作清理相互过时提示；可选导出时刻对全量入口一致。旧 APK 保留，新包按新提交命名。

## 剩余范围

未执行 Android 真机/MuMu 本轮新功能操作、原生多周期 PDF 渲染及分享面板；未制作正式 APK。旧重构 PR 的设备证据及签名缺口仍独立有效。本轮提交独立待审 PR，不合并。
