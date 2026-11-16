import { describe, expect, it } from 'vitest';
import {
  PRE_SLEEP_CATEGORY, PRE_SLEEP_DEFAULT_NAME,
  categoryPath, changeCategories, completeCategories, defaultCategories, parseCategories, requireSelectableCategory, selectableCategories,
} from '../../src/core/categories';
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
    expect(moved.map((c) => c.id)).toEqual(['work', 'cat-study', 'daily', 'unclassified', PRE_SLEEP_CATEGORY, 'sleep']);
  });
  it('睡前时间是默认系统项，可改名但不能删除、停用或排序', () => {
    const defaults = defaultCategories();
    expect(defaults.find((c) => c.id === PRE_SLEEP_CATEGORY)).toMatchObject({ name: PRE_SLEEP_DEFAULT_NAME, archived: false });
    const renamed = changeCategories(defaults, { kind: 'rename', id: PRE_SLEEP_CATEGORY, name: '睡前' }, new Set());
    expect(renamed.find((c) => c.id === PRE_SLEEP_CATEGORY)?.name).toBe('睡前');
    for (const kind of ['delete', 'restore', 'up', 'down'] as const) {
      expect(() => changeCategories(defaults, { kind, id: PRE_SLEEP_CATEGORY }, new Set([PRE_SLEEP_CATEGORY]))).toThrow();
    }
  });
  it('睡前时间不能被普通段主动选中，原段仍可保留', () => {
    const catalog = defaultCategories();
    expect(selectableCategories(catalog).some((c) => c.id === PRE_SLEEP_CATEGORY)).toBe(false);
    expect(selectableCategories(catalog, PRE_SLEEP_CATEGORY).some((c) => c.id === PRE_SLEEP_CATEGORY)).toBe(true);
    expect(() => requireSelectableCategory(PRE_SLEEP_CATEGORY, 'work', catalog)).toThrow();
    expect(() => requireSelectableCategory(PRE_SLEEP_CATEGORY, PRE_SLEEP_CATEGORY, catalog)).not.toThrow();
  });
  it('读取旧目录时补入睡前时间，并保留用户改过的名字', () => {
    const old = defaultCategories().filter((c) => c.id !== PRE_SLEEP_CATEGORY);
    const filled = completeCategories(old, []);
    expect(filled.map((c) => c.id)).toEqual(['work', 'daily', 'unclassified', PRE_SLEEP_CATEGORY, 'sleep']);
    const renamed = completeCategories([...old, { id: PRE_SLEEP_CATEGORY, name: '睡前', archived: true }], []);
    expect(renamed.find((c) => c.id === PRE_SLEEP_CATEGORY)).toMatchObject({ name: '睡前', archived: false });
    const parsed = parseCategories([...old, { id: PRE_SLEEP_CATEGORY, name: '睡前', archived: false }]);
    expect(parsed?.find((c) => c.id === PRE_SLEEP_CATEGORY)?.name).toBe('睡前');
  });
  it('旧 schema 1 自动补目录，缺分类不根据备注猜测', () => {
    const s = segment(); delete s.category;
    const data = parseDataText(JSON.stringify({ schemaVersion: 1, cycles: [cycle([s])] }));
    expect(data?.schemaVersion).toBe(3); expect(data?.settings.categories).toEqual(defaultCategories());
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

describe('v0.8 分类颜色与大小类', () => {
  const palette = (id: string) => {
    const c = defaultCategories().find((item) => item.id === id);
    return c?.color;
  };
  it('默认分类带固定颜色，新增分类自动拿到未占用的颜色', () => {
    expect(palette('work')).toBe('#4c8dff');
    const first = changeCategories(defaultCategories(), { kind: 'add', id: 'cat-a', name: '甲' }, new Set());
    const color = first.find((c) => c.id === 'cat-a')?.color;
    expect(color).toBeTruthy();
    const second = changeCategories(first, { kind: 'add', id: 'cat-b', name: '乙' }, new Set());
    expect(second.find((c) => c.id === 'cat-b')?.color).not.toBe(color);
  });

  it('颜色可以修改、清空，系统分类拒绝改色', () => {
    let catalog = changeCategories(defaultCategories(), { kind: 'add', id: 'cat-a', name: '甲' }, new Set());
    catalog = changeCategories(catalog, { kind: 'setColor', id: 'cat-a', color: '#FF6B9D' }, new Set());
    expect(catalog.find((c) => c.id === 'cat-a')?.color).toBe('#ff6b9d');
    catalog = changeCategories(catalog, { kind: 'setColor', id: 'cat-a', color: null }, new Set());
    expect(catalog.find((c) => c.id === 'cat-a')?.color).toBeUndefined();
    for (const id of ['sleep', 'unclassified', PRE_SLEEP_CATEGORY]) expect(() => changeCategories(catalog, { kind: 'setColor', id, color: '#ffffff' }, new Set())).toThrow();
    expect(() => changeCategories(catalog, { kind: 'setColor', id: 'cat-a', color: 'red' }, new Set())).toThrow();
  });

  it('能挂到大类下、移出，并显示两级路径', () => {
    let catalog = changeCategories(defaultCategories(), { kind: 'add', id: 'cat-jp', name: '学日语' }, new Set());
    catalog = changeCategories(catalog, { kind: 'setParent', id: 'cat-jp', parentId: 'work' }, new Set());
    expect(catalog.find((c) => c.id === 'cat-jp')?.parentId).toBe('work');
    expect(categoryPath('cat-jp', catalog)).toBe('工作 / 学日语');
    catalog = changeCategories(catalog, { kind: 'setParent', id: 'cat-jp', parentId: null }, new Set());
    expect(categoryPath('cat-jp', catalog)).toBe('学日语');
  });

  it('不允许三级、系统父子关系或把有子标签的分类降级', () => {
    let catalog = changeCategories(defaultCategories(), { kind: 'add', id: 'cat-jp', name: '学日语', parentId: 'work' }, new Set());
    expect(() => changeCategories(catalog, { kind: 'add', id: 'cat-word', name: '单词', parentId: 'cat-jp' }, new Set())).toThrow();
    expect(() => changeCategories(catalog, { kind: 'setParent', id: 'work', parentId: 'daily' }, new Set())).toThrow();
    expect(() => changeCategories(catalog, { kind: 'setParent', id: 'daily', parentId: 'sleep' }, new Set())).toThrow();
    expect(() => changeCategories(catalog, { kind: 'setParent', id: 'daily', parentId: 'daily' }, new Set())).toThrow();
    catalog = changeCategories(catalog, { kind: 'setParent', id: 'cat-jp', parentId: null }, new Set());
    expect(catalog.find((c) => c.id === 'cat-jp')?.parentId).toBeNull();
  });

  it('删除有子标签的大类被阻止；有历史引用的大类只停用', () => {
    let catalog = changeCategories(defaultCategories(), { kind: 'add', id: 'cat-jp', name: '学日语', parentId: 'work' }, new Set());
    expect(() => changeCategories(catalog, { kind: 'delete', id: 'work' }, new Set())).toThrow();
    catalog = changeCategories(catalog, { kind: 'delete', id: 'cat-jp' }, new Set());
    const archived = changeCategories(catalog, { kind: 'delete', id: 'work' }, new Set(['work']));
    expect(archived.find((c) => c.id === 'work')?.archived).toBe(true);
  });

  it('解析保留颜色和父级，丢弃非法值并拆掉环', () => {
    const parsed = parseCategories([
      ...defaultCategories(),
      { id: 'cat-jp', name: '学日语', archived: false, color: '#9b7bff', parentId: 'work' },
      { id: 'cat-bad', name: '坏颜色', archived: false, color: 'blue', parentId: 'cat-jp' },
    ]);
    expect(parsed?.find((c) => c.id === 'cat-jp')).toMatchObject({ color: '#9b7bff', parentId: 'work' });
    expect(parsed?.find((c) => c.id === 'cat-bad')?.parentId).toBeNull();
    const loop = parseCategories([
      ...defaultCategories(),
      { id: 'cat-a', name: '甲', archived: false, parentId: 'cat-b' },
      { id: 'cat-b', name: '乙', archived: false, parentId: 'cat-a' },
    ]);
    expect(loop?.filter((c) => c.parentId && c.parentId === c.id)).toHaveLength(0);
    expect(loop?.find((c) => c.id === 'cat-a')?.parentId === 'cat-b' && loop?.find((c) => c.id === 'cat-b')?.parentId === 'cat-a').toBe(false);
  });
});
