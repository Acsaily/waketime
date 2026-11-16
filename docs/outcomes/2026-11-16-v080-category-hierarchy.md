---
date: 2026-11-16
status: v0.8.0 已实现；单测/构建/浏览器/真机升级与数据回读验证通过
---

# v0.8.0：分类颜色 + 大小类层级 + 分层统计

来源：用户 2026-11-16 提出四项修改——分类颜色可改、删除标签不丢历史、标签分大小类、统计按大类/细分/下钻查看。方案经用户确认后实施。

## 已实现

### 1. 分类颜色

- 分类定义新增可选 `color`（`#rrggbb`）。
- 新增分类自动取 12 色预置板里第一个未占用的颜色；全部占用时取使用次数最少的。
- 分类管理每行有色块，点开 12 色板即可改色；「自动」清除自定义颜色，回退到系统色/按 ID 生成的颜色。
- 未分类、补觉、睡前时间颜色固定；工作、日常和自定义分类可改色。
- 贴标签宫格、统计图例、环形图、历史/今日分类 chip、时间轴统一使用分类颜色。

### 2. 删除标签不删记录

- 保留并强化既有语义：被历史引用的分类删除时只停用，名称、备注、时长全部保留，之后可在「已停用分类」里改名或恢复，也可把旧段改标到别的分类。
- 没有历史引用的分类才真正移除。
- 删除还有小标签的大类会被阻止，先处理子标签，避免误删整组。

### 3. 大小类（最多两级）

- 分类定义新增 `parentId`；只允许两级，系统分类既不能当子标签也不能当父标签。
- 大类本身可以直接贴成记录（「只记【大类】」），兼容现有工作/日常记录。
- 分类管理：
  - 新增时可选择「作为大类」或归到某个大类。
  - 大类行可 `+ 小标签`、归大类/换大类、组内上移/下移、改名、删除。
  - 子标签缩进显示，显示「小标签」标记和所属路径。
- 贴标签：`CategoryPicker` 宫格先选大类，再选细分；有子标签的大类进入第二层，第一项是「只记【大类】」。合并与睡前时间分配复用同一选择器。
- 历史、时间轴、今日汇总、导出文本显示「大类 / 小类」。

### 4. 分层统计

- 统计页新增「大类 / 细分」层级切换，默认大类。
- 大类层：环形图、图例、趋势都按大类汇总（含下属小标签）。
- 细分层：
  - 未下钻时显示全部细分，大类自身时间显示为「（未细分）」；
  - 点大类图例可下钻，显示面包屑「全部大类 › 某大类」，只看该大类内部的细分；
  - 百分比与环形图分母改为当前层级的合计；下钻时趋势柱/线也只统计该大类。
- 「合计 / 单分类」趋势切换保留，单分类选择器按当前层级列出。
- 睡前时间待分配卡片的「选择分类分配…」打开层级选择器，选中后确认分配。

## 数据模型与迁移

- `CategoryDefinition` 增加 `color?`、`parentId?`；schema 2 → **3**，`APP_VERSION` 0.8.0。
- 读取兼容 schema 1/2/3；写出 3；来自更高版本的数据仍拒绝写盘（`rejectFutureSchema`）。
- 旧数据没有颜色/父级时不改写历史段，只在使用时回退到系统色/哈希色；分类顺序不变。
- `normalizeCategoryTree` 在加载/恢复/每次分类操作后运行：父级不存在、父级被停用、自指、三级关系都会自动拆回大类，防止环。
- `restore.ts` 的分类冲突比较加入颜色与父级；冲突仍逐项确认。
- 导出 JSON 的 `categorySummaries` 增量加入 `parentId`、`parentName`、`color`，原字段保留。
- 不重写历史段；删除只影响分类目录。

## 涉及文件

- 核心：`src/core/categories.ts`、`src/core/categoryColors.ts`、`src/core/categoryStats.ts`。
- 数据：`src/data/store.ts`（schema 3 / 0.8.0）、`src/data/restore.ts`。
- 导出：`src/export/format.ts`。
- UI：`src/components/CategoryPicker.tsx`（新）、`CategoryManager.tsx`、`SegmentEditor.tsx`、`CategoryStatsPanel.tsx`、`Timeline.tsx`、`CycleSummary.tsx`、`HistoryMonthPanel.tsx`、`src/pages/Stats.tsx`、`src/main.tsx`（引入 `styles-v08.css`）。
- 样式：`src/styles-v08.css`（新）。
- 测试：`tests/core/categories.test.ts`、`tests/core/categoryStats.test.ts`、`tests/data/restore.test.ts`、`tests/data/phoneMigration.test.ts`、`tests/core/categoryStats.test.ts`。

## 验证证据

- 本机（2026-11-16）：Vitest **115 用例 / 12 文件全过**；`tsc --noEmit` + Vite 构建通过；安卓原生单测 `TimerRepositoryTest` 34 + 工程示例 1 全过；`:app:assembleDebug` / `:app:assembleRelease` 成功（versionCode 10 / 0.8.0）。交付包 `waketime-0.8.0-release.apk`（3,408,672 字节，SHA256 `0e1e4dd1a210b2b43341de773f7a297ddaa5db96837113f2e8ed03d673ccafd6`）；debug 与 release 证书同为 SHA-256 `4fbcc019d22ecb3e00b8abdf2aefb612254262a5735a5b33d3e1a9edee24488e`（`CN=Personal Waketime`），覆盖安装不丢数据的前提成立。
- 浏览器（2026-11-16，上一会话记录）：375×812 / 360×800 下大类/细分切换、点大类下钻、按层级配色、层级选择器贴标签、睡前时间分配正常，360 宽无横向溢出；未读写真机 `data.json`。
- 真机（2026-11-16，Redmi Note 12 Turbo / `23049RAD8C`，Android 15，无线调试 `192.168.110.27`）：
  - 升级前为 v0.7.0 release（schema 2，不可调试）。同签名覆盖安装 v0.8.0 **debug** 包后、启动前只读读出 **21 周期 / 180 段**，备份到 `docs/backup-from-phone/pre-v080-20261116/`：`before-data.json`（SHA256 `ad2e5138…`）、`before-data.prev.json`（`d7bffacb…`）、`before-timer-state.xml`（`63101c8a…`）。
  - 启动 v0.8.0 触发迁移后回读：schema 2 → **3**、appVersion 0.7.0 → 0.8.0；周期 21 / 段 180 与升级前**逐段 0 缺失、0 变化、0 新增**（比 id/起止/备注/类别/来源）；分类 12 个全保留，仅增补 `parentId: null`，系统分类补固定色。
  - 覆盖安装正式 release 包后再读回：仍 21 周期 / 180 段，与迁移后逐段一致（`after-release-data.json`），分类 12 个不变。
  - 最终装回正式包（0.8.0 / versionCode 10）并启动：今日页数据与计时连续（已完成 5 段、活动计时跨多次安装继续）；统计页「大类 / 细分」切换、大类占比环形图与配色、睡前时间待分配卡、分类管理面板（色块、`+ 小标签`、归大类/上移/下移/改名/删除）在真机渲染正常；`logcat -b crash` 无 App 崩溃记录。截图 `docs/shots/phone-v080-{today,stats,stats-sub,catmanager,final-today}.png`。

## 未完成 / 待补

- 模拟器未升级（仍是 v0.7.0）；本轮真机验证已覆盖升级路径。
- 真机未实际新建「大类 / 小标签」（避免改动用户当天真实分类目录）；层级增删改由单测与浏览器演示覆盖，日常使用时顺带确认即可。
- 未提交、未推送 git（按项目守则需用户明确授权）。
