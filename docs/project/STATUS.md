---
updated: 2026-11-11
status: v0.6.0 已同签名装机；用户确认历史页正常，15 周期记录保留
---

# Current status

## Stage

v0.6.0（versionCode 8）已把历史页改为「周趋势 / 每日明细」两块面板：周条滑动、平均睡眠与入睡波动、相对参考截止偏移、每日柱状图/睡眠区间、按月日历与当天时间轴；保留原有编辑、拆分、合并入口。已在浏览器 375×812 / 360×800 验证交互，并同签名覆盖安装真机；安装前后逐段比对 0 变化（仅清掉 1 条原有零时长段）。用户已确认新历史页正常（2026-11-11）。

v0.5.0 的自定义分类与手动补分段仍保留在基线中；v0.5.0 的「用户实际保存一次拆分 + 恢复备份」真机试用仍未单独收尾。

## Verified facts

- 用户确认（2026-11-11）：v0.6.0 新历史页正常，可以收尾。
- 真机（2026-11-11，Redmi Note 12 Turbo）：`waketime-0.6.0-release.apk` 同签名覆盖安装成功（0.6.0 / versionCode 8，证书 SHA-256 与历史一致）。安装前备份 15 周期 / 125 段（`docs/backup-from-phone/pre-v060-20261111/data-before-install.json`，SHA256 `d4adad05…`）；新版读回 15 周期 / 124 段，逐段比较 **0 处边界/备注/类别变化**，少的 1 段是原有 `sanitizeSegments` 清理的零时长段（start=end、空备注），不是记录丢失。装正式包后再次读回仍为 15/124、0 变化（`data-after-release.json`，SHA256 `d72f953e…`），最终正式包已装回。
- 本机（2026-11-11）：Vitest **91 用例 / 10 文件全过**；`tsc --noEmit` + Vite 构建通过；原生 `:app:testDebugUnitTest` 通过（`TimerRepositoryTest` 34 + 工程示例 1）；`:app:assembleDebug`/`:app:assembleRelease` 成功。
- 浏览器 375×812 / 360×800 隔离演示数据：周条切换、横向滑动切面板、月份选择器、点日期滚动到详情、时间轴打开编辑器均通过，360 宽度无横向溢出；截图 `docs/shots/app-history-*.png`。
- 升级前真机备份（2026-11-06）：11 周期 / 75 段，SHA256 `96010da1dc93d46072372bdc04d63abbeaea8298c4eb5c90a9db7b611b759fcb`；安装前再次只读备份到 `docs/backup-from-phone/pre-v050-20261107/data-before-install.json`（11 周期 / 78 段，SHA256 `0fb204f6c27f0fc6ccdbfb7430f2c34fbfecf4da88ec474e10962d917855ca8e`），并保存源码快照（不含签名）。
- 本机（2026-11-07）：Vitest **80 用例 / 9 文件全过**；`tsc --noEmit` + Vite 构建通过；原生 `TimerRepositoryTest` **34 用例全过**（另有 1 个工程示例用例）；`:app:assembleDebug` 与 `:app:assembleRelease` 成功，versionName 0.5.0 / versionCode 7。
- 真机备份在隔离副本上完成 schema 1→2 迁移：周期、段 ID、毫秒边界、备注、类别、来源全部保留；备份 JSON 恢复往返一致，原备份文件未改写。
- 浏览器 375×812 隔离数据交互：新增/改名/停用分类，历史汇总与时间轴同步；1 小时跨午夜段补 23:20 分界后总毫秒精确不变、原 ID 保留；拆后改自定义分类、再合并，总时长不变。
- 既有 v0.4.0 真机证据保留：v0.4.0 覆盖安装记录完整，补觉/分类/合并冒烟与状态栏显示正常（`docs/shots/phone-v040-*.png`）。
- 真机（2026-11-07，Redmi Note 12 Turbo）：`waketime-0.5.0-release.apk` 同签名覆盖安装成功（0.5.0 / versionCode 7，证书 SHA-256 与历史一致）；读回 `data.json` 为 schema 2、11 周期 / 78 段，与升级前逐段比较 0 缺失、0 变化；设置分类管理、历史动态汇总、编辑器拆分入口正常；打开拆分界面后取消，记录签名未变。证据 `docs/shots/phone-v050-*.png`。

## Completed outcomes

- [首次落地（minimal landing）](../outcomes/2026-10-29-initial-landing.md)
- [真机现状检查](../outcomes/2026-10-29-phone-baseline.md)
- [v0.4.0 补觉、分类与合并](../outcomes/2026-10-30-v040-nap-merge-categories.md)
- [v0.5.0 自定义分类与手动补分段](../outcomes/2026-11-07-v050-custom-categories-and-split.md)
- [历史页改版预览（设计稿）](../outcomes/2026-11-10-history-redesign-preview.md)
- [v0.6.0 历史页周趋势 + 每日明细](../outcomes/2026-11-11-v060-history-week-month.md)

## Adopted decisions

- 分类：稳定 ID + 设置目录；未分类与补觉保留系统语义；有历史引用的删除改为停用，改名同步历史显示；不根据备注猜类别。旧 schema 1 自动补默认目录，未知引用保留为停用占位。
- 补分段：只补原段内部边界，不修改外侧起止；支持多个分界点、跨午夜、进行中清醒段；原备注复制到子段；原生一次原子提交并校验目标段快照与并发。
- 恢复：整目录版本化备份；冲突逐项确认，不按同名自动合并；覆盖空周期拒绝；保留本机通知/常用备注与当前活动周期。
- 补觉：沿用 v0.4.0 口径（总睡眠含补觉、实际清醒排除补觉、参考截止固定、补觉中禁计次）。
- 历史：按起床日归档，周从周一开始；偏移只与恰好下一天比较，缺一天显示「—」，不跨日硬算；入睡/起床统一到同一夜轴（午后起床用入睡+主睡眠时长计算）；同一天多条周期保留，图表主睡眠取总睡眠最长的一条。

## Blockers

- 无阻塞。无线调试连接端口每次会变，重连需重新获取。

## Next action

1. 可选：在真机点一个时间段打开编辑器，确认可编辑/拆分/合并（沿用 v0.5.0 路径）。
2. 若还需要补做 v0.5.0 的「保存一次拆分 + 恢复一次备份」试用，再按 `docs/outcomes/2026-11-07-v050-custom-categories-and-split.md` 的步骤确认。
3. 保留 `waketime-0.6.0-release.apk`；升级前备份保留，直到下一次全量导出验证。
4. v0.6.0 已由用户确认收尾，除非后续发现问题，不再改这一版。

## 更新方案状态

- 用户已于 2026-11-07 确认按推荐方案实施 v0.5.0；方案文档保留为历史依据：`docs/outcomes/2026-11-06-custom-categories-and-segment-split-proposal.md`。
- v0.5.0 实施结果与验证证据见 `docs/outcomes/2026-11-07-v050-custom-categories-and-split.md`。
- 2026-11-10 用户确认历史页改版预览方向；2026-11-11 按预览实施 v0.6.0，结果见 `docs/outcomes/2026-11-11-v060-history-week-month.md`。
