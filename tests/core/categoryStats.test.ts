import { describe, expect, it } from 'vitest';
import type { Cycle, Segment } from '../../src/data/store';
import { changeCategories, defaultCategories, PRE_SLEEP_CATEGORY } from '../../src/core/categories';
import { buildDayMetrics } from '../../src/core/history';
import {
  buildCategoryDayTotals, buildCategoryPeriod, canNextPeriod, canPrevPeriod,
  categoryEntries, entryBucketMs, percentMap, shiftPeriod, summaryRows,
} from '../../src/core/categoryStats';
import { H, cycle } from '../fixtures';

function local(month: number, day: number, hour = 0, minute = 0): number {
  return new Date(2026, month - 1, day, hour, minute).getTime();
}
function day(id: string, wakeAtMs: number, segments: Segment[], closedAtMs: number): Cycle {
  return {
    ...cycle(segments, id),
    sleepAtMs: wakeAtMs - 8 * H,
    wakeAtMs,
    targetAtMs: wakeAtMs + 16 * H,
    closedAtMs,
    createdAtMs: wakeAtMs,
    updatedAtMs: wakeAtMs,
    session: { id: `s-${id}`, status: 'ended', startedAtMs: wakeAtMs, segments },
  };
}
function seg(id: string, startMs: number, endMs: number, category: string, note = ''): Segment {
  return { id, seq: 1, startAtMs: startMs, endAtMs: endMs, category: category as Segment['category'], note, source: 'app' };
}

const now = local(11, 12, 12);
const cycles = [
  day('d9', local(11, 9, 8), [
    seg('w9', local(11, 9, 8), local(11, 9, 10), 'work'),
    seg('n9', local(11, 9, 10), local(11, 9, 11), 'daily'),
    seg('p9', local(11, 9, 11), local(11, 9, 11, 30), PRE_SLEEP_CATEGORY),
  ], local(11, 9, 11, 30)),
  day('d10', local(11, 10, 8), [
    seg('w10', local(11, 10, 8), local(11, 10, 11), 'work'),
    seg('nap10', local(11, 10, 11), local(11, 10, 12), 'sleep'),
  ], local(11, 10, 12)),
  day('d3', local(11, 3, 8), [seg('w3', local(11, 3, 8), local(11, 3, 9), 'work')], local(11, 3, 9)),
];
const days = buildDayMetrics(cycles, now);

describe('分类统计聚合', () => {
  it('按起床日合计，多周期相加，补觉与主睡眠不进入分类', () => {
    const totals = buildCategoryDayTotals(days, now);
    expect(totals.get('2026-11-09')?.categoryMs).toMatchObject({ work: 2 * H, daily: 1 * H, [PRE_SLEEP_CATEGORY]: 0.5 * H });
    expect(totals.get('2026-11-10')?.categoryMs).toMatchObject({ work: 3 * H });
    expect(totals.get('2026-11-10')?.categoryMs.sleep).toBeUndefined();
    expect(totals.get('2026-11-10')?.totalMs).toBe(3 * H);
  });

  it('周视图从周一开始，统计本期并对比上周同期', () => {
    const period = buildCategoryPeriod(days, 'week', local(11, 10, 9), now);
    expect(period.startMs).toBe(local(11, 9));
    expect(period.label).toBe('11/9 – 11/15');
    expect(period.buckets).toHaveLength(7);
    expect(period.ongoing).toBe(true);
    expect(period.recordedDays).toBe(2);
    expect(period.totalMs).toBe(6.5 * H);
    expect(period.totals).toMatchObject({ work: 5 * H, daily: H, [PRE_SLEEP_CATEGORY]: 0.5 * H });
    expect(period.previousTotals).toMatchObject({ work: H });
    expect(period.previousTotalMs).toBe(H);
    expect(period.prevLabel).toBe('上周同期');
  });

  it('月视图逐日分桶，年视图逐月分桶', () => {
    const month = buildCategoryPeriod(days, 'month', local(11, 15), now);
    expect(month.label).toBe('2026年11月');
    expect(month.buckets).toHaveLength(30);
    expect(month.buckets[8]).toMatchObject({ key: '2026-11-09', totalMs: 3.5 * H });
    expect(month.totalMs).toBe(7.5 * H);
    const year = buildCategoryPeriod(days, 'year', local(11, 15), now);
    expect(year.buckets).toHaveLength(12);
    expect(year.buckets[10]).toMatchObject({ label: '11月', totalMs: 7.5 * H });
  });

  it('分类条目按总时长排序，睡前时间标记为待分配', () => {
    const period = buildCategoryPeriod(days, 'week', local(11, 10, 9), now);
    const entries = categoryEntries(period, defaultCategories());
    expect(entries.map((e) => e.id)).toEqual(['work', 'daily', PRE_SLEEP_CATEGORY]);
    expect(entries[2]).toMatchObject({ name: '睡前时间（待分配）', preSleep: true, ms: 0.5 * H });
  });

  it('百分比用最大余数法，合计恰好 100%', () => {
    const entries = [
      { id: 'a', ms: 5 * H }, { id: 'b', ms: H }, { id: 'c', ms: 0.5 * H },
    ];
    const pct = percentMap(entries, 6.5 * H);
    expect([...pct.values()].reduce((sum, n) => sum + n, 0)).toBe(100);
    expect(pct.get('a')).toBe(77);
    expect(pct.get('b')).toBe(15);
    expect(pct.get('c')).toBe(8);
    expect(percentMap(entries, 0).size).toBe(0);
  });

  it('周期切换按周 / 月 / 年移动，并能判断边界', () => {
    expect(shiftPeriod('week', local(11, 10), -1)).toBe(local(11, 2));
    expect(shiftPeriod('month', local(11, 30), 1)).toBe(local(12, 1));
    expect(shiftPeriod('year', local(11, 10), 1)).toBe(new Date(2027, 0, 1).getTime());
    expect(canNextPeriod('week', local(11, 10), now)).toBe(false);
    expect(canNextPeriod('week', local(11, 1), now)).toBe(true);
    expect(canPrevPeriod('week', local(11, 10), local(11, 3))).toBe(true);
    expect(canPrevPeriod('week', local(11, 10), local(11, 9))).toBe(false);
    expect(canPrevPeriod('month', local(11, 15), null)).toBe(false);
  });
});

describe('v0.8 大类与细分统计', () => {
  function hierarchy() {
    let catalog = defaultCategories();
    catalog = changeCategories(catalog, { kind: 'add', id: 'cat-jp', name: '学日语', parentId: 'work' }, new Set());
    catalog = changeCategories(catalog, { kind: 'add', id: 'cat-mech', name: '机械', parentId: 'work' }, new Set());
    return changeCategories(catalog, { kind: 'setParent', id: 'daily', parentId: 'work' }, new Set());
  }
  const period = buildCategoryPeriod(days, 'week', local(11, 10, 9), now);

  it('大类层把小标签时间汇总到父级，并统计含几个小标签', () => {
    const entries = categoryEntries(period, hierarchy(), 'parent');
    expect(entries.map((e) => e.id)).toEqual(['work', PRE_SLEEP_CATEGORY]);
    expect(entries[0]).toMatchObject({ name: '工作', ms: 6 * H, childCount: 1, parentId: null });
    expect(entries.reduce((sum, e) => sum + e.ms, 0)).toBe(period.totalMs);
  });

  it('全部细分包含大类自身时间桶和「大类 · 小类」路径', () => {
    const entries = categoryEntries(period, hierarchy(), 'child');
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get('work')).toMatchObject({ name: '工作（未细分）', ms: 5 * H, parentBucket: true });
    expect(byId.get('daily')).toMatchObject({ name: '工作 · 日常', ms: H, parentName: '工作' });
    expect(byId.get(PRE_SLEEP_CATEGORY)?.ms).toBe(0.5 * H);
    expect(entries.reduce((sum, e) => sum + e.ms, 0)).toBe(period.totalMs);
  });

  it('下钻某个大类只看它内部的细分，总数不丢', () => {
    const entries = categoryEntries(period, hierarchy(), 'child', 'work');
    expect(entries.map((e) => e.name)).toEqual(['工作（未细分）', '日常']);
    expect(entries.map((e) => e.ms)).toEqual([5 * H, H]);
    expect(entries.reduce((sum, e) => sum + e.ms, 0)).toBe(6 * H);
  });

  it('趋势桶按当前层级取值，大类层把子标签一起算', () => {
    const catalog = hierarchy();
    const bucket = period.buckets[0]; // 11/9：work 2h + daily 1h + 睡前 0.5h
    expect(entryBucketMs(bucket.categoryMs, { id: 'work' }, 'parent', catalog)).toBe(3 * H);
    expect(entryBucketMs(bucket.categoryMs, { id: 'daily' }, 'child', catalog)).toBe(H);
    expect(entryBucketMs(bucket.categoryMs, { id: 'work' }, 'child', catalog)).toBe(2 * H);
  });
});

describe('今日页分类汇总块', () => {
  const catalog = changeCategories(
    changeCategories(defaultCategories(), { kind: 'add', id: 'cat-jp', name: '学日语', parentId: 'work' }, new Set()),
    { kind: 'add', id: 'cat-mech', name: '机械', parentId: 'work' },
    new Set(),
  );

  it('顶层只列大类：小标签时间并入大类，零时长隐藏，未分类保留', () => {
    const rows = summaryRows({ work: H, 'cat-jp': 2 * H, daily: 3 * H }, catalog);
    expect(rows.map((r) => [r.id, r.ms])).toEqual([['work', 3 * H], ['daily', 3 * H], ['unclassified', 0]]);
    expect(rows[0]).toMatchObject({ label: '工作', drillable: true });
    expect(rows[1]).toMatchObject({ label: '日常', drillable: false });
  });

  it('下钻只看该大类细分：未细分桶在前，零时长小标签隐藏，顺序跟目录', () => {
    const rows = summaryRows({ work: H, 'cat-jp': 2 * H, daily: 3 * H }, catalog, 'work');
    expect(rows.map((r) => [r.label, r.ms])).toEqual([['工作（未细分）', H], ['学日语', 2 * H]]);
    expect(rows[0]).toMatchObject({ parentBucket: true, drillable: false });
  });

  it('没有自身时间的下钻不出现未细分桶', () => {
    const rows = summaryRows({ 'cat-mech': 4 * H }, catalog, 'work');
    expect(rows.map((r) => r.label)).toEqual(['机械']);
  });
});
