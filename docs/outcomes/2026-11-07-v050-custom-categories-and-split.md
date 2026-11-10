# v0.5.0 自定义分类与手动补分段（实现 + 验证）

日期：2026-11-07。性质：CONTINUE，沿用 v0.4.0 的段编辑、合并、原生计时与恢复机制。

## 交付功能

- **分类管理（设置页）**：新增分类、改名、上移/下移、删除。有历史引用时删除只停用，历史名称、备注与时长保留；未使用分类才真正移除。未分类和补觉为系统类别，不能改名或删除。工作和日常与自定义分类一样可改名、停用。
- **动态分类统计**：今日、历史、导出预览、TXT、PDF、JSON 均按类别目录汇总；停用类别带「已停用」标记，空档归未分类，补觉不计清醒。
- **手动补分段**：段编辑器可添加多个分界点（按日期时刻或经过分钟），逐段选分类、改备注，先预览再保存。保持原段外侧起止与总时长，支持跨午夜与精确到秒的时间；原备注复制到各子段并提示可修改。
- **进行中段补分段**：只在已发生时间内加分界，尾段继续计时；拆分不暂停计时，不把打开编辑器的时间当作结束时间。开放补觉段先结束补觉再拆。
- **安全与兼容**：JS 与原生均校验分界点严格递增、位于原段内、不产生重叠/空段/未来时间；原生在副本上一次原子提交，校验周期、目标段快照、通知栏并发计次和写盘失败。schema 2 保存分类目录，读取兼容 schema 1；旧数据未引用类别保留为停用「待确认分类」，不静默改成未分类。
- **备份恢复**：全量/单日备份包含分类目录与动态汇总；恢复会校验版本与目录，逐项确认同 ID 不同定义的冲突，并保留本机无关设置与当前原生活动周期。旧纯周期数组备份仍可导入。

## 数据安全

- 升级实现前已取得真机备份：`docs/backup-from-phone/pre-v050-20261106/data-before-v050.json`（11 周期 / 75 段，SHA256 `96010da1dc93d46072372bdc04d63abbeaea8298c4eb5c90a9db7b611b759fcb`），同时保存原生计时状态与源码快照。
- 安装前再次只读备份到 `docs/backup-from-phone/pre-v050-20261107/data-before-install.json`：11 周期 / 78 段，SHA256 `0fb204f6c27f0fc6ccdbfb7430f2c34fbfecf4da88ec474e10962d917855ca8e`（比首次备份多 3 段，为这期间新增计次）。
- 真机备份逐段迁移测试：原 ID、毫秒边界、备注、类别、来源全部保留，迁移前后数量一致；恢复往返后与迁移结果完全相等，原备份文件未被改写。
- 数据文件来自更新版本时拒绝读取并停止保存，避免降级后回退旧备份覆盖；读取成功后才允许修改并立即安全落盘。
- 所有写操作串行：导出恢复、分类管理、段编辑、分裂、合并、补觉、开始/结束周期；失败不发布会话中的半次修改。历史编辑先写盘成功再更新界面。

## 已验证

- Vitest：**80 用例 / 9 文件全过**（分类增删改停用、迁移、动态汇总、多分界点跨午夜、开放尾段、陈旧快照、导出、恢复冲突/空覆盖/未来版本）。
- 原生 `TimerRepositoryTest`：**34 用例全过**（含自定义类别往返、原子拆分、通知并发拒绝、重启锚点、补觉保护、存储失败不半写）。
- `tsc --noEmit` 与 Vite 构建通过；`:app:assembleDebug` 生成 versionName 0.5.0 / versionCode 7；`:app:assembleRelease` 同签名。
- 浏览器 375×812 隔离数据交互验证：
  - 设置页新增「学习」，写入稳定 ID，无横向溢出。
  - 历史段（23:00:12–00:00:12）补 23:20 分界，预览显示跨午夜日期、两段 19/40 分钟、合计不变；保存后总毫秒精确保持 3,600,000，原段 ID 与 splitFromId 记录正确。
  - 把第二段改成「学习」，历史汇总显示「学习 40m」；改名为「进修」后历史同步显示；删除已引用分类后变为停用，历史仍显示「进修（已停用）40m」，其他段编辑器不再提供该类别。
  - 合并相邻两段后恢复为一段，总时长不变，两条备注按规则保留。

## 尚未验证

- 真机实际保存一次拆分、进行中段拆分与恢复 UI 的完整操作（本轮在真机只打开拆分界面并取消，未改动用户记录；保存路径由前端隔离交互与原生 JVM 34 用例覆盖）。
- 旧版本 APK 读取 schema 2 不支持也不建议；回退需使用升级前备份。

## 真机覆盖安装（2026-11-07，Redmi Note 12 Turbo）

- `waketime-0.5.0-release.apk` 同签名覆盖安装成功：versionName 0.5.0 / versionCode 7；证书 SHA-256 `4F:BC:C0:19:D2:2E:CB:3E:00:B8:AB:DF:2A:EF:B6:12:25:42:62:A5:73:5A:5B:33:D3:E1:A9:ED:EE:24:48:8E`，与历史版本一致。
- 升级后读回 `data.json`：schema 2、11 周期 / 78 段，分类目录为工作/日常/未分类/补觉；与升级前 78 段逐段比较，缺失周期 0、边界/备注/类别变化 0。
- 真机界面：今日页记录与计时正常；设置页「分类管理」可新增、上下移、改名、删除；历史页动态汇总与「编辑 / 拆分 / 合并」入口正常；段编辑器可打开「拆分这一段」，跨午夜日期输入与预览按钮可用。打开拆分后点「取消拆分」，读回记录签名与操作前完全一致。
- 因正式包不可调试，读回比对时临时安装同签名 debug 包完成，随后已换回正式包并再次确认 versionName 0.5.0。
- 证据：`docs/shots/phone-v050-today.png`、`phone-v050-settings-categories.png`、`phone-v050-history.png`、`phone-v050-history-detail.png`、`phone-v050-segment-editor.png`、`phone-v050-split-editor.png`；升级后读回文件 `docs/backup-from-phone/pre-v050-20261107/data-after-install.json`。

## 文件

- 新增：`src/core/categories.ts`、`src/core/splitSegments.ts`、`src/components/CategoryManager.tsx`、`src/components/CycleSummary.tsx`、`src/components/SegmentSplitter.tsx`、`src/data/restore.ts`。
- 修改：`src/data/store.ts`、`src/state/useApp.ts`、`src/pages/Settings.tsx`、`Today.tsx`、`History.tsx`、`Export.tsx`、`src/export/format.ts`、`pdfDoc.ts`、`src/components/SegmentEditor.tsx`、`Timeline.tsx`、`src/native/wakeTimer.ts`、`contracts.ts`、Java `TimerState`、`TimerRepository`、`WakeTimerPlugin`、`TimerNotifications`、`android/app/build.gradle`、`vite.config.ts`、README、INDEX、STATUS。
