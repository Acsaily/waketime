# v0.6.0 历史页改版：周趋势 + 每日明细

日期：2026-11-11。性质：CONTINUE，按 2026-11-10 的交互预览实施；沿用现有周期、段与分类数据模型，不改 schema。

## 交付功能

- **历史页两块面板**：顶部「周趋势 / 每日明细」tab，支持点击与横向滑动切换；切换时回到页面顶部。
- **周趋势**
  - 周条按周一至周日分组，默认最近有记录的一周，点击或左右滑动周条切换；
  - 周概览：平均总睡眠、平均入睡/起床、入睡波动（最早/最晚/跨度）、平均每晚偏移、最晚的一晚；
  - 每天睡眠柱状图、入睡→起床区间图、相对参考截止的偏移图；
  - 自动摘要与「为什么关注睡眠波动？」研究依据折叠区（Windred 2024、Zuraikat 2020、Zhang & Qin 2023）。
- **每日明细**
  - 右上角月份胶囊打开年月选择器，有记录的月份带小圆点；
  - 月历按周一至周日排列，每格显示总睡眠与带符号偏移；今天有标记，未来日期淡化；
  - 点日期看当天详情：主睡眠/补觉、入睡/起床/总睡眠/实际清醒、分类 chips、完整时间轴；
  - 保留原有编辑能力：点任一时间段打开编辑器，可改分类备注、拆分、与相邻连续段合并。

## 数据口径

- 按**起床日**归档，与 App 原有历史 id / 月历一致。
- 周从周一开始；同一天多条周期全部保留，图表主睡眠取当天总睡眠最长的一条，日详情按周期分别展示。
- 入睡按 `clockMinutesLateNight` 折算到同一夜轴（凌晨 +24h）；起床用「入睡 + 主睡眠时长」计算，午后起床不会被折回上午。
- 偏移 = 恰好下一天主睡眠的入睡 − 本次参考截止；缺失下一天记录为「—」，不跨日硬算。
- 周/月平均睡眠按天汇总（同一天多周期相加）；总睡眠含补觉，实际清醒不含补觉。

## 验证

- Vitest：**91 用例 / 10 文件全过**（新增 `tests/core/history.test.ts`，覆盖按天聚合、跨午夜入睡平均、drift 仅下一天、周起点、月历空位/未来日期、午后起床等）。
- `tsc --noEmit` + Vite 构建通过；原生 `:app:testDebugUnitTest` 通过（`TimerRepositoryTest` 34 用例 + 1 个工程示例）。
- 浏览器 375×812 / 360×800 隔离演示数据验证：周条切换、横向滑动切面板、月份选择器、点日期滚动到详情、时间轴点开编辑器、无横向溢出；截图见 `docs/shots/app-history-*.png`。
- 演示数据只写浏览器 localStorage，不读写手机 `data.json`。

## 真机安装与数据安全（Redmi Note 12 Turbo）

- 安装前只读备份（2026-11-11）：`docs/backup-from-phone/pre-v060-20261111/data-before-install.json`，schema 2、**15 周期 / 125 段**，SHA256 `d4adad05849fa5ca829bf2736ad75971d45000abdf51bd7db22ee41da63f9251`；同时保存计时状态 `timer-state-before-install.xml`（SHA256 `5fa17d86f0b70409f310dbe17e884d613577e1822a47e0330eb15977a35f3203`）。
- 同签名覆盖安装 v0.6.0（versionCode 8），启动新版后读回：15 周期 / 124 段，`0` 处边界/备注/类别变化；少的 1 段是原有 `sanitizeSegments` 清理的**零时长段**（2026-11-06，start=end，空备注），不是用户记录丢失。读回文件 `data-after-debug.json`，SHA256 `ccbf45595188e35d27e1b9a7b00eae3330d696c76edabcadac6db1388387d01e`。
- 再装正式 v0.6.0 后再次读回：仍为 15 周期 / 124 段，0 处变化，`data-after-release.json`，SHA256 `d72f953ebd07206d7850353f09cde4b116a655d7ed6a4307927403c6c10a812f`；随后换回正式包，最终安装 `versionName 0.6.0 / versionCode 8`。
- 证书 SHA-256 仍为 `4F:BC:C0:19:D2:2E:CB:3E:00:B8:AB:DF:2A:EF:B6:12:25:42:62:A5:73:5A:5B:33:D3:E1:A9:ED:EE:24:48:8E`，覆盖安装不丢数据。
- 交付物：`waketime-0.6.0-release.apk`（根目录），SHA256 `1fd5940070ffe2465ba25720be6ae9e71d126b2b63423e1ce815d2f6c4724414`。
- 公开发布（2026-11-11）：<https://github.com/Acsaily/waketime>，v0.6.0 Release <https://github.com/Acsaily/waketime/releases/tag/v0.6.0>。公开仓按 `.gitignore` 排除个人备份、真机截图、`docs/gpt-ds/`、`out/`、`tools/`、`.claude/` 与签名 key；APK 只作为 Release 资产上传。

## 未验证 / 待用户确认

- 用户已于 2026-11-11 确认新历史页正常、可以收尾；本轮没有取得解锁状态下的真机界面截图，浏览器截图作为 UI 证据。
- 真机上实际编辑/拆分后的历史展示（编辑器沿用 v0.5.0 路径，单测与浏览器已验证）。
- v0.5.0 遗留的「用户实际保存一次拆分 + 恢复一次备份」真机试用仍未单独记录；本次读回显示用户已有 125 段记录，说明期间用过应用，但未验证恢复 UI。

## 文件

- 新增：`src/core/history.ts`、`src/components/HistoryCharts.tsx`、`src/components/HistoryWeekPanel.tsx`、`src/components/HistoryMonthPanel.tsx`、`tests/core/history.test.ts`。
- 修改：`src/pages/History.tsx`、`src/styles.css`、`src/data/store.ts`（APP_VERSION 0.6.0）、`package.json`、`package-lock.json`、`android/app/build.gradle`（versionCode 8）、`README.md`、`tests/core/segments.test.ts`。
- 设计依据：`docs/previews/history-redesign-preview.html`、`docs/outcomes/2026-11-10-history-redesign-preview.md`。
- 旧 `src/components/TrendCharts.tsx` 保留但历史页不再引用，后续确认无复用需求再清理。
