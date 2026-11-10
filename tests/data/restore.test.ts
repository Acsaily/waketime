import { describe, expect, it } from 'vitest';
import { defaultData, parseDataText } from '../../src/data/store';
import { buildRestoredData, categoryConflicts, readRestoreBackup } from '../../src/data/restore';
import { buildBackupJson, buildDayTxt } from '../../src/export/format';
import { buildPdfBlocks } from '../../src/export/pdfDoc';
import { defaultCategories } from '../../src/core/categories';
import { snapshotOf, splitSegments } from '../../src/core/splitSegments';
import { cycle, segment, T, H } from '../fixtures';

describe('分类、拆分、导出与恢复闭环', () => {
  function data() {
    const d = defaultData();
    d.settings.categories.push({ id: 'cat-study', name: '学习', archived: true });
    const s = segment(); let id = 0;
    const parts = splitSegments([s], 'a', { expected: snapshotOf(s), cuts: [T + H],
      parts: [{ category: 'cat-study', note: '原备注\n资料' }, { category: 'daily', note: '生活' }] }, T + 3 * H, () => `split-${++id}`);
    d.cycles = [cycle(parts)];
    return d;
  }
  it('TXT 和 PDF 内容块使用相同动态名称、停用标记和时长', () => {
    const d = data(); const txt = buildDayTxt(d.cycles[0], d.cycles, d.settings.categories);
    const pdf = buildPdfBlocks(d.cycles[0], d.cycles, d.settings.categories).map((b) => b.text).join('\n');
    for (const text of [txt, pdf]) {
      expect(text).toContain('学习（已停用） 1h'); expect(text).toContain('[学习]');
      expect(text).toContain('日常 2h'); expect(text).toContain('原备注\n资料');
    }
  });
  it('单日和全量 JSON 包含完整目录、分段来源、备注和动态汇总', () => {
    const d = data(); const json = buildBackupJson(d.cycles, d.settings); const parsed = JSON.parse(json);
    expect(parsed.settings.categories).toEqual(d.settings.categories);
    expect(parsed.cycleSummaries[0].categoryMs['cat-study']).toBe(H);
    expect(parsed.cycleSummaries[0].categorySummaries).toContainEqual({ id: 'cat-study', name: '学习', archived: true, durationMs: H });
    expect(parseDataText(json)?.cycles).toEqual(d.cycles);
  });
  it('在隔离空记录上恢复再导出，标签、备注和全部边界一致', () => {
    const d = data(); const backup = readRestoreBackup(JSON.parse(buildBackupJson(d.cycles, d.settings)));
    const restored = buildRestoredData(defaultData(), backup, 'overwrite');
    expect(restored.cycles).toEqual(d.cycles); expect(restored.settings.categories).toEqual(d.settings.categories);
    expect(JSON.parse(buildBackupJson(restored.cycles, restored.settings)).cycles).toEqual(d.cycles);
  });
  it('本机通知/常用备注不被恢复改变，同名不同 ID 不自动合并', () => {
    const current = defaultData(); current.settings.notificationsEnabled = false; current.settings.quickNotes = ['自用词'];
    current.settings.categories.push({ id: 'local-study', name: '学习', archived: false });
    const backup = readRestoreBackup(JSON.parse(buildBackupJson(data().cycles, data().settings)));
    const result = buildRestoredData(current, backup, 'merge');
    expect(result.settings.notificationsEnabled).toBe(false); expect(result.settings.quickNotes).toEqual(['自用词']);
    expect(result.settings.categories.filter((c) => c.name === '学习')).toHaveLength(2);
    expect(current.cycles).toHaveLength(0);
  });
  it('同 ID 不同名称或状态必须逐项确认，否则不动输入', () => {
    const d = data(); const backup = readRestoreBackup(JSON.parse(buildBackupJson(d.cycles, d.settings)));
    const current = defaultData(); current.settings.categories.push({ id: 'cat-study', name: '进修', archived: false });
    expect(categoryConflicts(current.settings.categories, backup.categories)).toHaveLength(1);
    const before = JSON.stringify(current);
    expect(() => buildRestoredData(current, backup, 'merge')).toThrow(); expect(JSON.stringify(current)).toBe(before);
    expect(buildRestoredData(current, backup, 'merge', { 'cat-study': 'local' }).settings.categories.find((c) => c.id === 'cat-study')?.name).toBe('进修');
    expect(buildRestoredData(current, backup, 'merge', { 'cat-study': 'backup' }).settings.categories.find((c) => c.id === 'cat-study')?.archived).toBe(true);
  });
  it('兼容 schema 1 与纯周期数组，并补齐旧类别目录', () => {
    for (const raw of [{ schemaVersion: 1, cycles: [cycle()] }, [cycle()]]) {
      const backup = readRestoreBackup(raw);
      expect(backup.categories).toEqual(defaultCategories()); expect(backup.cycles).toHaveLength(1);
    }
  });
  it('拒绝损坏目录、非法周期与未知 schema，不接受空覆盖', () => {
    for (const raw of [{ schemaVersion: 9, cycles: [] }, { schemaVersion: 2, cycles: [], settings: { categories: 'bad' } }, { schemaVersion: 1, cycles: [{ id: 'bad' }] }]) expect(() => readRestoreBackup(raw)).toThrow();
    expect(() => buildRestoredData(data(), { cycles: [], categories: defaultCategories() }, 'overwrite')).toThrow();
    expect(buildRestoredData(data(), { cycles: [], categories: defaultCategories() }, 'merge').cycles).toHaveLength(1);
  });
  it('缺失类别目录的引用保留为待确认停用项，不变成未分类', () => {
    const raw = { schemaVersion: 1, cycles: [cycle([segment('a', T, T + 3 * H, 'cat-lost')])] };
    const result = buildRestoredData(defaultData(), readRestoreBackup(raw), 'merge');
    expect(result.cycles[0].session?.segments[0].category).toBe('cat-lost');
    expect(result.settings.categories.find((c) => c.id === 'cat-lost')?.archived).toBe(true);
  });
  it('覆盖与合并都保留当前原生活动周期，避免下一次镜像覆盖恢复结果', () => {
    const current = data(); const live = { ...cycle([segment('live', T, 0)], 'active'), closedAtMs: null };
    current.cycles.push(live);
    const incoming = { cycles: [cycle([], 'active'), cycle([], 'restored')], categories: defaultCategories() };
    for (const mode of ['merge', 'overwrite'] as const) {
      const result = buildRestoredData(current, incoming, mode, {}, 'active');
      expect(result.cycles.find((c) => c.id === 'active')).toEqual(live);
      expect(result.cycles.find((c) => c.id === 'restored')).toBeDefined();
    }
  });
});
