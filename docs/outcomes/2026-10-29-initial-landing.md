---
title: 首次落地（minimal landing）
created: 2026-10-29
status: completed
promotion: none
---

# 首次落地（minimal landing）

## Goal

给「清醒时光 / waketime」建立一个最小可用的项目治理层：让后续人和 Codex 能快速找到项目目的、权威文档、当前状态与已完成结论，同时不搬动既有代码与文档结构。

## Observations

- 仓库已有完整代码（`src/` 23 个文件、`android/` 原生插件、`tests/` 4 个测试文件）与产品文档（`README.md`、`docs/superpowers/specs|plans`），但**没有** `AGENTS.md`、`STATUS`、`outcomes` 等治理结构。
- git 仓库已 `git init`，但**零提交**；默认分支 master。
- 存在两处"状态类"信息：`README.md`（产品功能，基本准确但停留在 v0.2 前后的描述）与 `docs/session-notes.md`（10-26 15:39 的工作笔记，已被后续实现超越）。
- `out/`（whale-widget 产物）与 `tools/`（codex 补丁脚本）时间戳 10-26 16:33，内容与本 App 无关，疑似同工作区的另一条工作线。
- 交付物直接放仓库根目录：`waketime-0.1.0` 到 `waketime-0.3.1` 五个 release APK。
- `.gitignore` 已覆盖 `node_modules/`、`dist/`、`.toolchain/`、安卓构建产物。

## Inferences

- 该项目处于"自用迭代"阶段，minimal 结构足够；完整 release 治理（输出目录、发布流程、CI）暂不需要。
- `README` 与 `session-notes` 各自承担不同角色（产品说明 vs 历史工作笔记），不需要强制合并；但需要在治理层明确 `STATUS.md` 是唯一"当前状态"来源，避免第三份状态互相矛盾。
- `out/`、`tools/` 不应纳入本项目导航，也不应被清理——归属由用户后续确认。

## Decision or result

采用 `software-repository` profile 的 minimal 落地，新增四个文件、不改任何既有文件：

| 动作 | 目标 | 说明 |
| --- | --- | --- |
| COPY（填充） | `AGENTS.md` | 项目级工作守则：权威来源、构建/验证命令、证据要求、数据安全红线、无关目录边界 |
| ADAPT | `docs/project/INDEX.md` | 项目导航：目的、当前重点、来源清单、代码地图、结构决定 |
| COPY（填充） | `docs/project/STATUS.md` | 唯一当前状态：阶段、已验证事实、已采纳决定、阻塞、下一步 |
| COPY（填充） | `docs/outcomes/2026-10-29-initial-landing.md` | 本文件：观察、推断、决定、证据、待决问题 |

不建 `outputs/`（交付物已在根目录按版本命名，避免双份真相）；不创建 `RESULT.md` / 落盘 `LANDING_REPORT.md`（属于单次结果/报告场景，不适用持续项目）；不提交 git、不建自动化。

## Evidence and artifacts

- 落地层：`AGENTS.md`、`docs/project/INDEX.md`、`docs/project/STATUS.md`、本文件。
- 既有权威：`README.md`、`docs/superpowers/specs/2026-10-26-waketime-design.md`、`docs/superpowers/plans/2026-10-26-waketime-app.md`。
- 真机与数据证据：`docs/shots/phone-recovery-01.png`、`docs/shots/phone-final-today.png`、`docs/shots/phone-final-history.png`、`docs/shots/v3-e2-overrun.png`、`docs/backup-from-phone/data-20261026.json`。
- 校验：`validate_landing.py` 结果与占位符/链接检查见落地交付说明。

## Effect on the project

- 新任务有了固定入口：先读 `STATUS` 与 `outcomes`，再决定是否沿用历史工作线（CONTINUE/REUSE/MERGE/NEW）。
- 明确了"证据优先"和"数据安全"红线，特别是 `data.json` 不得被覆盖/清空，以及构建日志不等于真机验证。
- 明确了 `out/`、`tools/`、`docs/session-notes.md` 的边界，避免后续误改或误当状态来源。

## Open questions

- `out/`、`tools/` 是否属于本项目需要治理的范围？（默认不纳入）
- 是否要把根目录 APK 迁到统一 `outputs/` 或建立版本归档规则？（minimal 阶段不做）
- 是否要为 git 建立首次提交与版本 tag？（需用户显式授权，本轮未做）

## Next action

见 `docs/project/STATUS.md`：在真机上完整走一次「开启第二天」，核对旧周期关闭、新周期段从 1 开始、首页与通知栏切换，并把结果写成新的 outcome。

## Promotion gate

- Candidate rule or template: 无（本次仅落地模板，未产生新规则）
- Validation required: 不适用
- User approval: 用户已批准本次写入范围（4 个文件）
- Rollback path: 删除上述 4 个新增文件即可完全回滚，不影响代码与既有文档
