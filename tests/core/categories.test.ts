import { describe, expect, it } from 'vitest';
import { changeCategories, completeCategories, defaultCategories, parseCategories, requireSelectableCategory, selectableCategories } from '../../src/core/categories';
import { categoryLabel, categoryOf, summarizeCycle } from '../../src/core/segments';
import { defaultData, parseDataText } from '../../src/data/store';
import { cycle, H, segment, T } from '../fixtures';

describe('自定义分类与迁移', () => {
  const add = () => changeCategories(defaultCategories(), { kind: 'add', id: 'cat-study', name: '学习' }, new Set());
  it('新增稳定 ID，改名不改变引用和时长', () => {
    const catalog = changeCategories(add(), { kind: 'rename', id: 'cat-study', name: '进修' }, new Set(['cat-study']));
    const s = segment('a', T, T + H, 'cat-study');
    expect(categoryOf(s)).toBe('cat-study'); expect(categoryLabel(categoryOf(s), catalog)).toBe('进修');
    expect(summarizeCycle(cycle([s]), T + 3 * H).categoryMs['cat-study']).toBe(H);
  });
  it('未使用可删除，已引用只停用且可以恢复', () => {
    expect(changeCategories(add(), { kind: 'delete', id: 'cat-study' }, new Set()).some((c) => c.id === 'cat-study')).toBe(false);
    const archived = changeCategories(add(), { kind: 'delete', id: 'cat-study' }, new Set(['cat-study']));
    expect(archived.find((c) => c.id === 'cat-study')?.archived).toBe(true);
    expect(changeCategories(archived, { kind: 'restore', id: 'cat-study' }, new Set()).find((c) => c.id === 'cat-study')?.archived).toBe(false);
  });
  it('停用类别只允许原记录保留，不给其他段新选', () => {
    const catalog = add().map((c) => c.id === 'cat-study' ? { ...c, archived: true } : c);
    expect(selectableCategories(catalog).some((c) => c.id === 'cat-study')).toBe(false);
    expect(selectableCategories(catalog, 'cat-study').some((c) => c.id === 'cat-study')).toBe(true);
    expect(() => requireSelectableCategory('cat-study', 'work', catalog)).toThrow();
    expect(() => requireSelectableCategory('cat-study', 'cat-study', catalog)).not.toThrow();
  });
  it('工作和日常也可改名、停用；系统项受保护', () => {
    expect(changeCategories(defaultCategories(), { kind: 'rename', id: 'work', name: '上班' }, new Set())[0].name).toBe('上班');
    expect(changeCategories(defaultCategories(), { kind: 'delete', id: 'daily' }, new Set(['daily']))[1].archived).toBe(true);
    for (const id of ['sleep', 'unclassified']) expect(() => changeCategories(defaultCategories(), { kind: 'delete', id }, new Set())).toThrow();
  });
  it('拒绝空名、重名、超长名与系统同名', () => {
    for (const name of [' ', '工作', '补觉', '一'.repeat(13)]) expect(() => changeCategories(defaultCategories(), { kind: 'add', id: 'cat-x', name }, new Set())).toThrow();
  });
  it('按显示顺序移动，不改 ID 和系统语义', () => {
    const moved = changeCategories(add(), { kind: 'up', id: 'cat-study' }, new Set());
    expect(moved.map((c) => c.id)).toEqual(['work', 'cat-study', 'daily', 'unclassified', 'sleep']);
  });
  it('旧 schema 1 自动补目录，缺分类不根据备注猜测', () => {
    const s = segment(); delete s.category;
    const data = parseDataText(JSON.stringify({ schemaVersion: 1, cycles: [cycle([s])] }));
    expect(data?.schemaVersion).toBe(2); expect(data?.settings.categories).toEqual(defaultCategories());
    expect(data?.cycles[0].session?.segments[0].category).toBe('unclassified');
  });
  it('schema 2 读写保留目录、停用状态和动态分类', () => {
    const data = defaultData(); data.settings.categories = add(); data.cycles = [cycle([segment('a', T, T + H, 'cat-study')])];
    expect(parseDataText(JSON.stringify(data))).toEqual(data);
  });
  it('未知引用建立停用占位类别，不丢原 ID', () => {
    const result = completeCategories(defaultCategories(), [{ category: 'cat-lost' }]);
    expect(result.find((c) => c.id === 'cat-lost')).toMatchObject({ archived: true });
    expect(categoryOf({ category: 'cat-lost' })).toBe('cat-lost');
  });
  it('目录结构损坏、重复 ID 或新版本一律拒绝', () => {
    expect(parseCategories([{ id: 'sleep', name: '游戏', archived: false }])).toBeNull();
    expect(parseCategories([...defaultCategories(), defaultCategories()[0]])).toBeNull();
    expect(parseDataText(JSON.stringify({ ...defaultData(), settings: { categories: 'broken' } }))).toBeNull();
    expect(parseDataText(JSON.stringify({ ...defaultData(), schemaVersion: 99 }))).toBeNull();
  });
  it('自定义统计包含停用类别，空档归未分类，不重复计入旧固定分类', () => {
    const c = cycle([segment('a', T, T + H, 'cat-study'), segment('b', T + H, T + 2 * H, 'sleep')]);
    const sum = summarizeCycle(c, T + 3 * H);
    expect(sum.categoryMs).toEqual({ 'cat-study': H, unclassified: H });
    expect(Object.values(sum.categoryMs).reduce((a, b) => a + b, 0)).toBe(sum.awakeMs);
    expect(sum.workMs).toBe(0); expect(sum.napMs).toBe(H);
  });
});
