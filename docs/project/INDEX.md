---
title: 清醒时光 / waketime
profile: software-repository
landed: 2026-10-29
template: meta-codex-land/minimal@0.1.0
---

# 清醒时光 / waketime

## Purpose

自用的安卓 App：记录每天睡眠起止与清醒时间（倒计时 / 秒表 / 计次备注），按天存档，可导出 TXT / PDF / JSON 给电脑上的 AI 做作息分析。侧载安装、不联网、无账号。

## Current work（2026-11-27）

`refactor/eng` 分支已完成行为保持式源码重构与本地严格验收：领域优先模块化单体、统一应用协调、UI feature 化、可执行本地质量门与独立验证。行为/数据基线是 v0.9.0（`8307835`，schema 3）；用户数据与已发布版本不变。用户确认本轮按现有证据收尾。

- [架构总览](../architecture/overview.md) / [模块地图](../architecture/module-map.md) / [数据生命周期](../architecture/data-lifecycle.md)
- [验证与质量门](../architecture/verification.md) / [项目 verify skill](../skills/verify/SKILL.md)
- [ADR](../adr/0001-domain-first-modular-monolith.md) / [实施计划](../superpowers/plans/2026-11-26-engineering-refactor.md)
- [验收记录与后续缺口](../outcomes/2026-11-27-engineering-refactor-acceptance.md)：严格本地门、真实生产 JSON 差分、MuMu 同测试签名升级与核心 E2E 通过；剩余系统交互暂缓。候选 `waketime-0.9.0-eng-debug.apk` 仅供测试，正式签名缺失，尚未发布。

## 历史焦点（v0.6.0–v0.9.0）

v0.6.0 历史页已改为「周趋势 / 每日明细」两块面板并同签名覆盖安装；真机记录 15 周期 / 124 段逐段零变化（原有 1 条零时长段被清理），用户已确认新历史页正常。2026-11-14 已按确认方案实施 v0.7.0：独立统计页、导出移入设置、分类管理进统计页、睡前时间（待分配）、分段刻度盘/合并滑条/计次反馈；本机 105 用例、类型检查与构建通过，浏览器 375/360 与模拟器升级验证通过；真机 Redmi Note 12 Turbo 覆盖安装后 19 周期 / 163 段逐段 0 变化，并修复长屏底栏被图表遮挡的问题。实现记录 `docs/outcomes/2026-11-14-v070-implementation.md`。

2026-11-16 实施 v0.8.0：分类颜色可改、删除标签不删记录、标签分大类/小类（最多两级）、统计页按大类/细分切换并可下钻；schema 2→3。本机 115 用例、类型检查与构建通过；真机 Redmi Note 12 Turbo 同签名覆盖安装后 21 周期 / 180 段逐段 0 变化，正式包已装回。实现记录 `docs/outcomes/2026-11-16-v080-category-hierarchy.md`。

2026-11-17 v0.8.1：今日页分类汇总块改为大类合计，点大类下钻看细分，点框内任意处返回大类；导出页保持完整路径汇总。本机 118 用例、类型检查与构建通过，浏览器块级验证通过；真机 Redmi Note 12 Turbo 覆盖安装后 22 周期 / 187 段逐段 0 变化，正式包已装回。记录 `docs/outcomes/2026-11-17-v081-today-summary-drilldown.md`。

2026-11-23 v0.9.0：统计页周/月/年总览卡可点开展示总睡眠与「清醒 : 睡眠」比例，再点收起；分类管理的大类可收起/展开小标签。本机 118 用例、类型检查与构建通过，浏览器 375/360 验证通过；真机覆盖安装后 27 周期 / 236 段逐段 0 变化，正式包已装回。记录 `docs/outcomes/2026-11-23-v090-stats-expand-category-collapse.md`。

## Sources of truth

- 当前状态：`docs/project/STATUS.md`
- 可复用结论：`docs/outcomes/`
- 产品与构建说明：`README.md`
- 架构、模块与数据：`docs/architecture/`
- 决策记录：`docs/adr/`
- 验证入口：`scripts/verify.mjs`、`docs/architecture/verification.md`
- 项目 verify skill：`docs/skills/verify/SKILL.md`
- 设计文档：`docs/superpowers/specs/2026-10-26-waketime-design.md`
- 交互预览：`docs/previews/`
- 实施计划：`docs/superpowers/plans/2026-10-26-waketime-app.md`
- GPT 协作记录：`docs/gpt-ds/`
- 真机证据：`docs/shots/`、`docs/backup-from-phone/`
- 交付物：仓库根目录 `waketime-<version>-release.apk`（当前 0.1.0 ~ 0.9.0）

## 代码地图

```text
src/
  app/             装配、React 订阅、生命周期、导航
  application/     跨域操作、唯一写入队列、ports、备份/恢复/导出
  modules/
    time-tracking/ 周期、主睡眠、补觉、活动段、计时与历史规则
    classification/ 分类目录、颜色、两级层级
    analytics/     周/月/年统计、趋势、分类聚合（只读）
  infrastructure/  Capacitor/文件/原生桥/反馈适配
  features/        today / history / statistics / settings
  shared/ui/       通用控件与样式
android/           Capacitor 安卓工程 + Java 原生计时/通知/PDF
contracts/         TS/Java 共享行为案例
tests/             领域、应用、数据、契约、属性、差分、UI、E2E、工具配置
scripts/           工具链、架构门、差分、verify.mjs、MuMu harness
docs/              架构、ADR、设计/计划、真机截图、恢复样本
.toolchain/        JDK21 / Android SDK / Gradle / npm 缓存 / 签名 key（gitignore）
```

## Collaboration loop

```text
chat → outcome（docs/outcomes/）→ 应用或适配 → 验证（`node scripts/verify.mjs check` / `strict`、差分、真机证据）→ 更新 STATUS → 下一个 outcome
```

## Structure decisions

- 2026-11-26 重构更新：保留 React/TypeScript/Capacitor/Java 技术栈、包名、schema 3 与数据契约，但 TS 目录改为领域优先的 `app/application/modules/infrastructure/features/shared`；详见 [架构总览](../architecture/overview.md)。以下为首次落地时的历史结构决定，目录部分已被本次重构取代。
- 保留既有结构：React/TS + Capacitor + Java 原生插件的目录不变，README 与 `docs/superpowers/*` 继续作为产品/设计文档。
- 新增治理路径：根 `AGENTS.md`、`docs/project/INDEX.md`、`docs/project/STATUS.md`、`docs/outcomes/`。
- 复用既有权威：`README.md`（构建/签名/数据/限制）、设计文档与实施计划（方案来源）、`docs/shots/`（真机证据）。
- 不适配项：不新建 `outputs/` 目录（交付物已在根目录且按版本命名），不触碰 `out/`、`tools/`（其它工作线），不把历史笔记 `docs/session-notes.md` 当状态来源。

## Landing record

见 `docs/outcomes/2026-10-29-initial-landing.md`（观察 / 推断 / 决定 / 验证证据 / 待决问题）。
