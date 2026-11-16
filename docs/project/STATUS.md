---
updated: 2026-11-16
status: v0.8.0 已实现；单测/构建/真机升级与数据回读验证通过
---

# Current status

## Stage

v0.6.0（versionCode 8）已把历史页改为「周趋势 / 每日明细」两块面板：周条滑动、平均睡眠与入睡波动、相对参考截止偏移、每日柱状图/睡眠区间、按月日历与当天时间轴；保留原有编辑、拆分、合并入口。已在浏览器 375×812 / 360×800 验证交互，并同签名覆盖安装真机；安装前后逐段比对 0 变化（仅清掉 1 条原有零时长段）。用户已确认新历史页正常（2026-11-11）。

2026-11-14 新增「分类统计」交互预览（**未实施**）：`docs/previews/category-analytics-preview.html`，演示周/月/年堆叠柱状图、合计/分类折线、环形占比、每类总时间，以及分类改名/停用/新增后的联动。只在浏览器用演示数据验证；未改 App 源码、`data.json`、schema 或版本号。待用户确认方案后再决定是否做 v0.7.0。

2026-11-14 方案更新（**未实施**）：按用户决定改为独立「统计」页（今日 / 历史 / 统计 / 设置），导出移入设置，分类管理移到统计页的第二块滑动面板；周/月/年 + 合计/单类两版折线；新增系统分类「睡前时间（待分配）」；分段/合并/计次手感重做。分段交互预览见 `docs/previews/segment-tools-preview.html`，完整方案见 `docs/outcomes/2026-11-14-v070-stats-segment-proposal.md`。

2026-11-14 用户确认实施（**已实现，真机升级已验证**）：独立统计页、导出移入设置、分类管理进统计页、周/月/年、合计/单分类、环形占比；新系统分类「睡前时间（待分配）」在开启第二天时自动标记开放尾段，可改名、可分配、不可删除；拆分改为 1 分钟刻度盘，合并改为右滑确认，计次增加触感/音效但位置和今日页排版不变。版本号 0.7.0 / versionCode 9。实现记录见 `docs/outcomes/2026-11-14-v070-implementation.md`。

2026-11-16 用户提出四项分类改动后确认实施（**已实现，真机升级与数据回读已验证**）：分类颜色可改（12 色板、「自动」回退）、删除标签不删记录（有历史引用只停用）、标签分大类/小类（最多两级，`parentId`）、统计页「大类 / 细分」层级切换与下钻。schema 2 → 3，版本号 0.8.0 / versionCode 10。实现记录见 `docs/outcomes/2026-11-16-v080-category-hierarchy.md`。

v0.5.0 的自定义分类与手动补分段仍保留在基线中；v0.5.0 的「用户实际保存一次拆分 + 恢复备份」真机试用仍未单独收尾。

## Verified facts

- v0.8.0 本机（2026-11-16）：Vitest **115 用例 / 12 文件全过**；`tsc --noEmit` + Vite 构建通过；安卓原生单测 34 + 1 通过；`:app:assembleDebug` / `:app:assembleRelease` 成功（versionCode 10 / 0.8.0）。交付包 `waketime-0.8.0-release.apk`（3,408,672 字节，SHA256 `0e1e4dd1a210b2b43341de773f7a297ddaa5db96837113f2e8ed03d673ccafd6`）；debug 与 release 证书同为 `4fbcc019…`（`CN=Personal Waketime`）。
- v0.8.0 真机（2026-11-16，Redmi Note 12 Turbo / `23049RAD8C`，Android 15，无线调试）：升级前 v0.7.0 release（schema 2）经同签名 v0.8.0 debug 包覆盖后、启动前只读读出 **21 周期 / 180 段**，备份 `docs/backup-from-phone/pre-v080-20261116/before-data.json`（SHA256 `ad2e5138…`）、`before-data.prev.json`（`d7bffacb…`）、`before-timer-state.xml`（`63101c8a…`）；启动迁移后 schema 3 / 0.8.0，**逐段 0 缺失、0 变化、0 新增**，分类 12 个保留并补 `parentId`；覆盖安装正式包后回读仍 **21 周期 / 180 段**、与迁移后逐段一致；最终装回正式包，今日页数据与活动计时连续，统计页「大类/细分」、睡前时间分配卡、分类管理面板正常，`logcat -b crash` 无 App 崩溃。截图 `docs/shots/phone-v080-*.png`。
- v0.8.0 浏览器（2026-11-16，上一会话）：375×812 / 360×800 大类/细分切换、点大类下钻、层级配色、层级选择器贴标签、睡前时间分配正常，360 宽无横向溢出；未读写真机 `data.json`。
- v0.8.0 未在真机新建大类/小标签（避免改动用户当天真实分类目录）；该路径由单测与浏览器演示覆盖。模拟器仍为 v0.7.0，本轮未升级。

- v0.7.0 本机（2026-11-14）：Vitest **105 用例 / 12 文件全过**；`tsc --noEmit` + Vite 构建通过；安卓原生单测 34 + 1 通过；`:app:assembleRelease` 成功（versionCode 9 / 0.7.0，`VIBRATE` 已合并）。发布包 `waketime-0.7.0-release.apk`（3,404,412 字节，SHA256 `fe3442bf307b7913aabc5bf72998a91a5b132bb6d939aba1e8775e3869d08e6a`），签名证书与 v0.6.0 相同。
- v0.7.0 模拟器升级验证（2026-11-14，`product:ali`，Android 15，**非用户手机**）：v0.6.0 旧数据（周期 `2026-11-14`、开放段 `9c6fd63d…`）在同签名覆盖安装最终包后逐项不变；设置补齐反馈开关、分类补齐 `pre-sleep`；「开启第二天」生成新 ID `2026-11-14-2`，旧周期尾段 07:00–10:04 标为 `pre-sleep`；统计页分配回「工作」后起止/备注/总时长不变；拆分（08:44 分界）与右滑合并往返后恢复为原单段、原 ID；计次与反馈开关在设备上正常，`logcat -b crash` 无 App 崩溃。触感/音效体感模拟器无法确认。
- v0.7.0 数据安全修复（2026-11-14）：设备测试中发现同一天从「开启新的一天」重复录入会用相同周期 id 覆盖旧周期；已在 `startCycle` 统一走 `uniqueCycleId`，并加 2 个单测。v0.6.0 仍有这个旧风险，升级后不再出现。
- v0.7.0 浏览器隔离演示数据 375×812 / 360×800：统计页周/月/年、合计/单分类、环形占比、周期翻页正常，360 宽无横向溢出；睡前时间分配、分类改名、刻度拆分保存、滑条合并均写入隔离 `localStorage` 并正确回读。未读写真机 `data.json`。
- v0.7.0 真机（2026-11-14，Redmi Note 12 Turbo / `23049RAD8C`，Android 15）：升级前用可调试 v0.6.0 包只读读出 **19 周期 / 163 段**，备份 `docs/backup-from-phone/pre-v070-20261114/data-before-install.json`（SHA256 `8b9dba4b…`）与 `timer-state-before-install.xml`（`bd9418a2…`）；同签名覆盖安装 v0.7.0 后读回仍为 **19 周期 / 163 段，逐段 0 缺失、0 变化**；分类补 `pre-sleep`、反馈开关默认开；活动计时跨安装继续。真机长屏发现统计图表盖住底栏，补 `.tabbar{z-index:20}` 后重打包（最终 SHA256 `fe3442bf…`）并安装，导航恢复正常。截图 `docs/shots/phone-v070-*.png`。
- v0.7.0 真机未执行（避免改动当天真实记录）：开启第二天触发睡前时间、真实拆分/合并；这些由单测与模拟器覆盖。触感/音效体感待日常使用确认。

- 分段手感预览（2026-11-14）：独立 HTML，演示数据；375×812 / 360×800 验证拆分刻度（1 分钟格、5/15 分钟节拍、滚动/±1 分/保存）、合并滑动确认、计次反馈；无横向溢出、控制台无 JS 错误。预览不读写真实记录；未改 `src/`、`android/`、`data.json`、schema 或版本号。截图 `docs/shots/segment-tools-*.jpg`。
- 分类统计预览（2026-11-14）：独立 HTML，脚本内演示数据；375×812 / 360×800 下验证周/月/年切换、周期翻页、环形图例与折线联动、点柱看构成、分类改名/停用/新增联动，均无横向溢出、控制台无页面错误。预览不读取或写入真实记录；未改 `src/`、`android/`、`data.json`、schema 或版本号。截图 `docs/shots/category-analytics-*.jpg`。
- 公开发布（2026-11-11）：GitHub 公开仓库 <https://github.com/Acsaily/waketime>，v0.6.0 Release <https://github.com/Acsaily/waketime/releases/tag/v0.6.0>；仓库不包含个人备份、真机截图、`docs/gpt-ds/`、`out/`、`tools/` 与签名 key。
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
- [分类统计预览（设计稿，未实施）](../outcomes/2026-11-14-category-analytics-preview.md)
- [v0.7 方案：统计页 + 睡前时间 + 分段手感（未实施）](../outcomes/2026-11-14-v070-stats-segment-proposal.md)
- [v0.7.0 实施记录：统计页 + 睡前时间 + 分段手感](../outcomes/2026-11-14-v070-implementation.md)
- [v0.8.0 实施记录：分类颜色 + 大小类层级 + 分层统计](../outcomes/2026-11-16-v080-category-hierarchy.md)

## Adopted decisions

- 分类：稳定 ID + 设置目录；未分类与补觉保留系统语义；有历史引用的删除改为停用，改名同步历史显示；不根据备注猜类别。旧 schema 1 自动补默认目录，未知引用保留为停用占位。
- 补分段：只补原段内部边界，不修改外侧起止；支持多个分界点、跨午夜、进行中清醒段；原备注复制到子段；原生一次原子提交并校验目标段快照与并发。
- 恢复：整目录版本化备份；冲突逐项确认，不按同名自动合并；覆盖空周期拒绝；保留本机通知/常用备注与当前活动周期。
- 补觉：沿用 v0.4.0 口径（总睡眠含补觉、实际清醒排除补觉、参考截止固定、补觉中禁计次）。
- 历史：按起床日归档，周从周一开始；偏移只与恰好下一天比较，缺一天显示「—」，不跨日硬算；入睡/起床统一到同一夜轴（午后起床用入睡+主睡眠时长计算）；同一天多条周期保留，图表主睡眠取总睡眠最长的一条。

## Blockers

- 无阻塞。无线调试连接端口每次会变，重连需重新获取。

## Next action

1. ~~v0.8.0 真机覆盖安装与数据回读~~ 已完成（2026-11-16）：21 周期 / 180 段逐段 0 变化，见上方 Verified facts。
2. v0.8.0 日常使用时顺带确认：新建一个大类、挂一个小标签、改一次分类颜色，并在统计页点大类下钻看细分；删除一个已用标签应只停用。
3. 若 v0.8.0 使用中发现异常，用 `docs/backup-from-phone/pre-v080-20261116/before-data.json`（schema 2）与 `before-timer-state.xml` 回退，并更新本文件与实现记录。
4. ~~v0.7.0 真机覆盖安装与数据读回~~ 已完成（2026-11-14）：19 周期 / 163 段 0 变化。
5. v0.7.0 遗留：日常使用时顺带确认睡前时间分配、拆分刻度与合并滑条、触感/音效开关（真机未专门执行这些会改动当天记录的步骤）。
6. 可选：在真机点一个时间段打开编辑器，确认可编辑/拆分/合并（沿用 v0.5.0 路径）。
7. 若还需要补做 v0.5.0 的「保存一次拆分 + 恢复一次备份」试用，再按 `docs/outcomes/2026-11-07-v050-custom-categories-and-split.md` 的步骤确认。
8. 保留历史发布包与升级前备份，直到下一次全量导出验证；模拟器升级到 0.8.0 可在需要设备回归时再补。

## 更新方案状态

- 用户已于 2026-11-07 确认按推荐方案实施 v0.5.0；方案文档保留为历史依据：`docs/outcomes/2026-11-06-custom-categories-and-segment-split-proposal.md`。
- v0.5.0 实施结果与验证证据见 `docs/outcomes/2026-11-07-v050-custom-categories-and-split.md`。
- 2026-11-10 用户确认历史页改版预览方向；2026-11-11 按预览实施 v0.6.0，结果见 `docs/outcomes/2026-11-11-v060-history-week-month.md`。
- 2026-11-14 交付分类统计交互预览（未实施），方案与待确认项见 `docs/outcomes/2026-11-14-category-analytics-preview.md`。
- 2026-11-14 按用户决定更新为 v0.7 方案（独立统计页、导出迁移、睡前时间（待分配）、分段手感），见 `docs/outcomes/2026-11-14-v070-stats-segment-proposal.md`；分段交互预览 `docs/previews/segment-tools-preview.html`。
