---
title: 清醒时光 / waketime
profile: software-repository
landed: 2026-10-29
template: meta-codex-land/minimal@0.1.0
---

# 清醒时光 / waketime

## Purpose

自用的安卓 App：记录每天睡眠起止与清醒时间（倒计时 / 秒表 / 计次备注），按天存档，可导出 TXT / PDF / JSON 给电脑上的 AI 做作息分析。侧载安装、不联网、无账号。

## Current focus

v0.6.0 历史页已改为「周趋势 / 每日明细」两块面板并同签名覆盖安装；真机记录 15 周期 / 124 段逐段零变化（原有 1 条零时长段被清理），用户已确认新历史页正常。2026-11-14 已按确认方案实施 v0.7.0：独立统计页、导出移入设置、分类管理进统计页、睡前时间（待分配）、分段刻度盘/合并滑条/计次反馈；本机 105 用例、类型检查与构建通过，浏览器 375/360 与模拟器升级验证通过；真机 Redmi Note 12 Turbo 覆盖安装后 19 周期 / 163 段逐段 0 变化，并修复长屏底栏被图表遮挡的问题。实现记录 `docs/outcomes/2026-11-14-v070-implementation.md`。

2026-11-16 实施 v0.8.0：分类颜色可改、删除标签不删记录、标签分大类/小类（最多两级）、统计页按大类/细分切换并可下钻；schema 2→3。本机 115 用例、类型检查与构建通过；真机 Redmi Note 12 Turbo 同签名覆盖安装后 21 周期 / 180 段逐段 0 变化，正式包已装回。实现记录 `docs/outcomes/2026-11-16-v080-category-hierarchy.md`。

2026-11-17 v0.8.1：今日页分类汇总块改为大类合计，点大类下钻看细分，点框内任意处返回大类；导出页保持完整路径汇总。本机 118 用例、类型检查与构建通过，浏览器块级验证通过；真机 Redmi Note 12 Turbo 覆盖安装后 22 周期 / 187 段逐段 0 变化，正式包已装回。记录 `docs/outcomes/2026-11-17-v081-today-summary-drilldown.md`。

## Sources of truth

- 当前状态：`docs/project/STATUS.md`
- 可复用结论：`docs/outcomes/`
- 产品与构建说明：`README.md`
- 设计文档：`docs/superpowers/specs/2026-10-26-waketime-design.md`
- 交互预览：`docs/previews/`
- 实施计划：`docs/superpowers/plans/2026-10-26-waketime-app.md`
- GPT 协作记录：`docs/gpt-ds/`
- 真机证据：`docs/shots/`、`docs/backup-from-phone/`
- 交付物：仓库根目录 `waketime-<version>-release.apk`（当前 0.1.0 ~ 0.8.1）

## 代码地图

```text
src/            React + TS 前端（pages / components / core / data / native / export / state）
android/        Capacitor 安卓工程 + 自有 Java 插件（timer/ 计时与通知，export/ PDF）
tests/          vitest 单测（core/time、core/trends、data/liveState、data/recovery）
scripts/        工具链下载、env.ps1、vite 沙箱补丁
docs/           设计/计划、GPT 记录、真机截图、数据恢复样本
.toolchain/     JDK21 / Android SDK / Gradle / npm 缓存 / 签名 key（gitignore）
```

## Collaboration loop

```text
chat → outcome（docs/outcomes/）→ 应用或适配 → 验证（单测/构建/真机证据）→ 更新 STATUS → 下一个 outcome
```

## Structure decisions

- 保留既有结构：React/TS + Capacitor + Java 原生插件的目录不变，README 与 `docs/superpowers/*` 继续作为产品/设计文档。
- 新增治理路径：根 `AGENTS.md`、`docs/project/INDEX.md`、`docs/project/STATUS.md`、`docs/outcomes/`。
- 复用既有权威：`README.md`（构建/签名/数据/限制）、设计文档与实施计划（方案来源）、`docs/shots/`（真机证据）。
- 不适配项：不新建 `outputs/` 目录（交付物已在根目录且按版本命名），不触碰 `out/`、`tools/`（其它工作线），不把历史笔记 `docs/session-notes.md` 当状态来源。

## Landing record

见 `docs/outcomes/2026-10-29-initial-landing.md`（观察 / 推断 / 决定 / 验证证据 / 待决问题）。
