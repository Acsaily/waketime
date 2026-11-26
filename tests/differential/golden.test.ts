import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarizeCycle } from '../../src/modules/time-tracking/index';
import {
  buildDayMetrics,
  buildMonthView,
  buildWeeks,
  weekStats,
} from '../../src/modules/analytics/index';
import {
  buildCategoryDayTotals,
  buildCategoryPeriod,
  categoryEntries,
  entryBucketMs,
  percentMap,
  summaryRows,
} from '../../src/modules/analytics/index';
import {
  buildTrend,
  summarizeTrend,
  trendWindow,
  clockMinutesLateNight,
} from '../../src/modules/analytics/index';
import {
  computeCycle,
  deriveTimerDisplay,
  splitByDay,
  validateSleepInput,
} from '../../src/modules/time-tracking/index';
import { parseDataText, applyLiveState, type AppData } from '../../src/application/index';
import { sanitizeCycle } from '../../src/modules/time-tracking/index';
import type { LiveState } from '../../src/application/index';
import {
  buildRestoredData,
  readRestoreBackup,
  categoryConflicts,
} from '../../src/application/index';
import { buildBackupJson, buildDayTxt } from '../../src/application/index';
import { buildPdfBlocks } from '../../src/application/index';
import {
  golden,
  localGolden,
  schemas,
  H,
  T,
  N,
  makeCycle,
  makeSegment,
} from '../fixtures/synthetic';

const expected: ReturnType<typeof summarizeCycle>[] = [
  {
    mainSleepMs: 8 * H,
    napMs: H,
    totalSleepMs: 9 * H,
    awakeMs: 7 * H,
    workMs: 2 * H,
    dailyMs: H,
    unclassifiedMs: 3 * H,
    categoryMs: { work: 2 * H, 'cat-study': H, daily: H, unclassified: 3 * H },
  },
  {
    mainSleepMs: 3 * H,
    napMs: 0,
    totalSleepMs: 3 * H,
    awakeMs: 2 * H,
    workMs: 0,
    dailyMs: 0,
    unclassifiedMs: 0,
    categoryMs: { 'cat-old': 2 * H, unclassified: 0 },
  },
  {
    mainSleepMs: 8 * H,
    napMs: 0,
    totalSleepMs: 8 * H,
    awakeMs: H,
    workMs: 0,
    dailyMs: 0,
    unclassifiedMs: 0,
    categoryMs: { 'pre-sleep': H, unclassified: 0 },
  },
  {
    mainSleepMs: 8 * H,
    napMs: H,
    totalSleepMs: 9 * H,
    awakeMs: 4 * H,
    workMs: H,
    dailyMs: 0,
    unclassifiedMs: 0,
    categoryMs: { work: H, 'cat-study': 3 * H, unclassified: 0 },
  },
];
const clock = (now: number) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
};
afterEach(() => vi.useRealTimers());

describe('黄金查询（独立毫秒预期）', () => {
  it('每个周期的主睡眠、补觉、清醒及全部直接分类', () => {
    const { cycles } = golden();
    expect(cycles.map((c) => summarizeCycle(c, N))).toEqual(expected);
    expect(summarizeCycle(cycles[0], N + H)).toEqual(expected[0]);
    expect(summarizeCycle(cycles[3], N + H)).toEqual({
      ...expected[3],
      awakeMs: 5 * H,
      categoryMs: { work: H, 'cat-study': 4 * H, unclassified: 0 },
    });
    const d = cycles[3];
    d.session!.segments[2].category = 'sleep';
    expect(summarizeCycle(d, N)).toMatchObject({
      napMs: 4 * H,
      totalSleepMs: 12 * H,
      awakeMs: H,
      categoryMs: { work: H, unclassified: 0 },
    });
    expect(summarizeCycle(d, N + H)).toMatchObject({
      napMs: 5 * H,
      totalSleepMs: 13 * H,
      awakeMs: H,
    });
    expect(d.targetAtMs).toBe(T + 88 * H);
    expect(d.awakeBudgetMs).toBe(16 * H);
    expect(summarizeCycle({ ...d, session: null }, N)).toEqual({
      mainSleepMs: 8 * H,
      napMs: 0,
      totalSleepMs: 8 * H,
      awakeMs: 5 * H,
      workMs: 0,
      dailyMs: 0,
      unclassifiedMs: 5 * H,
      categoryMs: { unclassified: 5 * H },
    });
  });
  it('醒日聚合、同日主周期与周/月缺日', () => {
    const { data, now } = localGolden();
    const [a, c, b, d] = data.cycles;
    const days = buildDayMetrics(data.cycles, now);
    expect([...days.keys()]).toEqual(['2026-11-09', '2026-11-10', '2026-11-12']);
    expect(days.get('2026-11-09')).toMatchObject({
      cycles: [a, c],
      primary: a,
      totalSleepMs: 12 * H,
      bedMinutes: 1380,
      wakeMinutes: 1860,
      driftMs: H,
    });
    expect(days.get('2026-11-10')).toMatchObject({
      cycles: [b],
      totalSleepMs: 8 * H,
      driftMs: null,
    });
    expect(days.get('2026-11-12')).toMatchObject({
      cycles: [d],
      totalSleepMs: 9 * H,
      driftMs: null,
    });
    const reverse = buildDayMetrics([...data.cycles].reverse(), now);
    expect(reverse.get('2026-11-09')).toEqual(days.get('2026-11-09'));
    const weeks = buildWeeks(days);
    expect(weeks).toHaveLength(1);
    expect(weeks[0].days.map((d) => d?.dateKey ?? null)).toEqual([
      '2026-11-09',
      '2026-11-10',
      null,
      '2026-11-12',
      null,
      null,
      null,
    ]);
    expect(weekStats(weeks[0])).toMatchObject({ recordedDays: 3, avgSleepMs: (29 * H) / 3 });
    const month = buildMonthView(days, 2026, 10, now);
    expect(month.cells.slice(0, 6)).toEqual(Array(6).fill(null));
    expect(month.cells).toHaveLength(42);
    expect(month.cells.filter(Boolean)).toHaveLength(30);
    expect(month.cells.find((c) => c?.dateKey === '2026-11-13')).toMatchObject({
      future: true,
      day: null,
    });
    const tie = makeCycle('tie', a.wakeAtMs + 14 * H, 9 * H, a.wakeAtMs + 14 * H, []);
    expect(buildDayMetrics([a, tie], now).get('2026-11-09')?.primary.id).toBe('tie');
  });
  it('统计三个尺度、父子层级、今日下钻、同比整天边界', () => {
    const { data, now, t } = localGolden();
    const cats = data.settings.categories;
    const days = buildDayMetrics(data.cycles, now);
    expect(buildCategoryDayTotals(days, now).get('2026-11-09')).toMatchObject({
      totalMs: 9 * H,
      sleepMs: 12 * H,
    });
    for (const [mode, length] of [
      ['week', 7],
      ['month', 30],
      ['year', 12],
    ] as const) {
      const period = buildCategoryPeriod(days, mode, now, now);
      expect(period).toMatchObject({ totalMs: 14 * H, sleepMs: 29 * H, recordedDays: 3 });
      expect(period.buckets).toHaveLength(length);
      if (mode === 'week')
        expect(period).toMatchObject({ label: '11/9 – 11/15', prevLabel: '上周同期' });
      if (mode === 'year')
        expect(period.buckets[10]).toMatchObject({ key: '2026-10', totalMs: 14 * H });
      const parent = categoryEntries(period, cats, 'parent');
      expect(parent.map((e) => [e.id, e.ms])).toEqual([
        ['work', 7 * H],
        ['unclassified', 3 * H],
        ['cat-old', 2 * H],
        ['daily', H],
        ['pre-sleep', H],
      ]);
      expect(parent[0].childCount).toBe(1);
      const child = categoryEntries(period, cats, 'child');
      expect(child.find((e) => e.id === 'cat-study')).toMatchObject({
        name: '工作 · 学习',
        ms: 4 * H,
        parentId: 'work',
      });
      expect(child.find((e) => e.id === 'work')).toMatchObject({
        name: '工作（未细分）',
        ms: 3 * H,
        parentBucket: true,
      });
      expect(child.find((e) => e.id === 'cat-old')).toMatchObject({ archived: true, ms: 2 * H });
      expect(categoryEntries(period, cats, 'child', 'work').map((e) => [e.id, e.ms])).toEqual([
        ['cat-study', 4 * H],
        ['work', 3 * H],
      ]);
      expect(entryBucketMs(period.totals, parent[0], 'parent', cats)).toBe(7 * H);
      expect(entryBucketMs(period.totals, parent[0], 'child', cats)).toBe(3 * H);
    }
    const rows = summaryRows(expected[0].categoryMs, cats);
    expect(rows.map((e) => [e.id, e.ms, e.drillable])).toEqual([
      ['work', 3 * H, true],
      ['daily', H, false],
      ['unclassified', 3 * H, false],
    ]);
    expect(summaryRows(expected[0].categoryMs, cats, 'work').map((e) => [e.label, e.ms])).toEqual([
      ['工作（未细分）', 2 * H],
      ['学习', H],
    ]);
    expect(
      summaryRows({ work: 1, unclassified: 0 }, cats).map((e) => [e.id, e.ms, e.drillable]),
    ).toEqual([
      ['work', 1, true],
      ['unclassified', 0, false],
    ]);
    expect([
      ...percentMap(
        [
          { id: 'a', ms: 1 },
          { id: 'b', ms: 1 },
          { id: 'c', ms: 1 },
        ],
        3,
      ),
    ]).toEqual([
      ['a', 34],
      ['b', 33],
      ['c', 33],
    ]);
    expect([...percentMap([], 0)]).toEqual([]);
    const previous = [-7, -4, -3].map((offset, i) => {
      const wake = t + offset * 24 * H;
      return makeCycle(`prev-${i}`, wake, 8 * H, wake + H, [
        makeSegment(`s${i}`, 1, wake, wake + H),
      ]);
    });
    expect(
      buildCategoryPeriod(buildDayMetrics([...data.cycles, ...previous], now), 'week', now, now)
        .previousTotalMs,
    ).toBe(2 * H);
    const lastMonth = [12, 13].map((day) => {
      const wake = new Date(2026, 9, day, 19).getTime();
      return makeCycle(`month-${day}`, wake, 8 * H, wake + H, null);
    });
    expect(
      buildCategoryPeriod(buildDayMetrics([...data.cycles, ...lastMonth], now), 'month', now, now)
        .previousTotalMs,
    ).toBe(H);
    const lastYear = [12, 13].map((day) => {
      const wake = new Date(2025, 10, day, 19).getTime();
      return makeCycle(`year-${day}`, wake, 8 * H, wake + H, null);
    });
    expect(
      buildCategoryPeriod(buildDayMetrics([...data.cycles, ...lastYear], now), 'year', now, now)
        .previousTotalMs,
    ).toBe(H);
    const zero = makeCycle('zero', now - 5 * 24 * H, 8 * H, now - 5 * 24 * H, []);
    const onlyZero = buildDayMetrics([zero], now);
    expect(onlyZero.size).toBe(1);
    expect(buildCategoryPeriod(onlyZero, 'week', zero.wakeAtMs, now).recordedDays).toBe(0);
  });
  it('趋势以周期而非天为单位，展示窗口保留同日最后一条', () => {
    const { data, now } = localGolden();
    const ts = buildTrend(data.cycles, now);
    expect(ts.map((x) => [x.id, x.driftMs, x.durationDeltaMs])).toEqual([
      [data.cycles[0].id, -7 * H, null],
      [data.cycles[1].id, -16 * H, -6 * H],
      [data.cycles[2].id, 23 * H, 5 * H],
      [data.cycles[3].id, null, H],
    ]);
    expect(summarizeTrend(ts)).toMatchObject({
      days: 4,
      totalShrinkMs: -23 * H,
      totalOverrunMs: 23 * H,
      overrunStreak: 1,
      shrinkStreak: 0,
      avgSleepMs: (29 * H) / 4,
    });
    expect(trendWindow(data.cycles, 4, now).map((x) => x?.id ?? null)).toEqual([
      data.cycles[1].id,
      data.cycles[2].id,
      null,
      data.cycles[3].id,
    ]);
  });
  it('参考截止、容差和本地午夜毫秒边界', () => {
    expect(computeCycle({ sleepAtMs: T - 8 * H, wakeAtMs: T })).toEqual({
      sleepDurationMs: 8 * H,
      awakeBudgetMs: 16 * H,
      targetAtMs: T + 16 * H,
    });
    for (const delta of [-1, 0, 1])
      expect(deriveTimerDisplay(T, T + 16 * H, T + 16 * H + delta)).toMatchObject({
        phase: delta < 0 ? 'remaining' : 'overrun',
        valueMs: Math.abs(delta),
        sinceWakeMs: 16 * H + delta,
      });
    expect(deriveTimerDisplay(T, T + 16 * H, T - 1).sinceWakeMs).toBe(0);
    expect(deriveTimerDisplay(T, T + 16 * H, T + 40 * H)).toMatchObject({
      phase: 'overrun',
      valueMs: 24 * H,
      sinceWakeMs: 40 * H,
      progress: 1,
    });
    for (const [duration, expected] of [
      [H, null],
      [H - 1, 'too-short'],
      [24 * H, 'too-long'],
    ] as const)
      expect(validateSleepInput({ sleepAtMs: T - duration, wakeAtMs: T }, T)).toBe(expected);
    expect(validateSleepInput({ sleepAtMs: T - H, wakeAtMs: T }, T - 60_000)).toBeNull();
    expect(validateSleepInput({ sleepAtMs: T - H, wakeAtMs: T }, T - 60_001)).toBe('future');
    const midnight = new Date(2026, 10, 10).getTime();
    const s = makeSegment('cross', 1, midnight - 29_877, midnight + 60_456);
    expect(splitByDay(s, new Date(2026, 10, 9).getTime(), midnight)).toEqual({
      startAtMs: s.startAtMs,
      endAtMs: midnight,
      durationMs: 29_877,
    });
    expect(splitByDay(s, midnight, new Date(2026, 10, 11).getTime())).toEqual({
      startAtMs: midnight,
      endAtMs: s.endAtMs,
      durationMs: 60_456,
    });
    const c = makeCycle('cross', s.startAtMs, H, s.endAtMs, [s]);
    const days = buildDayMetrics([c], s.endAtMs);
    expect([...days.keys()]).toEqual(['2026-11-09']);
    expect(buildCategoryDayTotals(days, s.endAtMs).get('2026-11-09')?.totalMs).toBe(90_333);
  });
});

describe('迁移、恢复与导出黄金契约', () => {
  it('schema 1 不猜备注，schema 2 不猜层级，偏好正规化', () => {
    const old = parseDataText(JSON.stringify(schemas[0]))!;
    expect(old.cycles[0].session!.segments[0]).toMatchObject({
      category: 'unclassified',
      note: '工作 补觉',
    });
    expect(old.settings.categories.find((c) => c.id === 'cat-study')).toEqual({
      id: 'cat-study',
      name: '待确认分类1',
      archived: true,
      parentId: null,
    });
    expect(old.settings).toMatchObject({
      hapticsEnabled: true,
      soundEnabled: true,
      notificationsEnabled: false,
      quickNotes: ['合成词'],
    });
    expect(readRestoreBackup(schemas[0].cycles).cycles).toEqual(old.cycles);
    expect(parseDataText(JSON.stringify(schemas[0].cycles))).toBeNull();
    const v2 = parseDataText(JSON.stringify(schemas[1]))!;
    expect(v2.settings.categories.find((c) => c.id === 'cat-study')).toEqual({
      id: 'cat-study',
      name: '学习',
      archived: false,
      parentId: null,
    });
    expect(v2.settings.categories.find((c) => c.id === 'sleep')).toEqual(
      golden().settings.categories.find((c) => c.id === 'sleep'),
    );
    const d = golden();
    d.settings.categories[0].color = '#ABCDEF';
    d.settings.categories[1].color = 'bad';
    d.settings.categories[1].parentId = 'missing';
    d.settings.categories.find((c) => c.id === 'pre-sleep')!.archived = true;
    d.settings.quickNotes = [null, 'a', 1, 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as string[];
    const result = parseDataText(JSON.stringify(d))!;
    expect(result.settings.quickNotes).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(result.settings.hapticsEnabled).toBe(false);
    expect(result.settings.categories[0].color).toBe('#abcdef');
    expect(result.settings.categories[1]).not.toHaveProperty('color');
    expect(result.settings.categories[1].parentId).toBeNull();
    expect(result.settings.categories.find((c) => c.id === 'pre-sleep')?.archived).toBe(false);
  });
  it('损坏段独立清理：第一合法版本、补空档、序号重排、幂等', () => {
    const d = golden();
    const c = d.cycles[0];
    const s = c.session!.segments;
    s[0].startAtMs += 60_000;
    const valid = structuredClone(s);
    const malformed = { ...s[0], endAtMs: s[0].startAtMs };
    c.session!.segments = [
      s[4],
      malformed,
      s[0],
      { ...s[0], note: 'duplicate' },
      s[3],
      s[2],
      s[1],
      { ...malformed, id: 'zero' },
      { ...malformed, id: 'negative', endAtMs: malformed.startAtMs - 1 },
    ];
    const cleaned = sanitizeCycle(c);
    expect(cleaned.session!.segments).toEqual([
      {
        id: `${c.id}:wake-gap`,
        seq: 1,
        startAtMs: T,
        endAtMs: T + 60_000,
        note: '起床后未记录（补齐）',
        source: 'app',
        category: 'unclassified',
      },
      ...valid.map((s, i) => ({ ...s, seq: i + 2 })),
    ]);
    expect(sanitizeCycle(cleaned)).toEqual(cleaned);
    expect(parseDataText(JSON.stringify(d))!.cycles[0]).toEqual(cleaned);
  });
  it('拒绝表：坏输入不被当作空主文件或空备份', () => {
    const invalid: Array<[string, (d: AppData) => void]> = [
      [
        'schema 99',
        (d) => {
          d.schemaVersion = 99;
        },
      ],
      [
        'schema 0',
        (d) => {
          d.schemaVersion = 0;
        },
      ],
      [
        'non-array',
        (d) => {
          d.cycles = null as unknown as AppData['cycles'];
        },
      ],
      [
        'duplicate cycle',
        (d) => {
          d.cycles.push(d.cycles[0]);
        },
      ],
      [
        'sleep order',
        (d) => {
          d.cycles[0].wakeAtMs = d.cycles[0].sleepAtMs;
        },
      ],
      [
        'close before wake',
        (d) => {
          d.cycles[0].closedAtMs = T - 1;
        },
      ],
      [
        'segment time',
        (d) => {
          d.cycles[0].session!.segments[0].endAtMs = 'bad' as unknown as number;
        },
      ],
      [
        'category id',
        (d) => {
          d.cycles[0].session!.segments[0].category = ' ';
        },
      ],
      [
        'lineage',
        (d) => {
          d.cycles[0].session!.segments[0].splitFromId = '';
        },
      ],
      [
        'duplicate category',
        (d) => {
          d.settings.categories.push(d.settings.categories[0]);
        },
      ],
      [
        'fixed name',
        (d) => {
          d.settings.categories.find((c) => c.id === 'sleep')!.name = '改';
        },
      ],
      [
        'fixed status',
        (d) => {
          d.settings.categories.find((c) => c.id === 'unclassified')!.archived = true;
        },
      ],
      [
        'bad name',
        (d) => {
          d.settings.categories[0].name = ' ';
        },
      ],
      [
        'bad status',
        (d) => {
          d.settings.categories[0].archived = 1 as unknown as boolean;
        },
      ],
      [
        'missing catalog',
        (d) => {
          Reflect.deleteProperty(d.settings, 'categories');
        },
      ],
    ];
    for (const [name, mutate] of invalid) {
      const d = golden();
      mutate(d);
      const before = structuredClone(d);
      expect(parseDataText(JSON.stringify(d)), name).toBeNull();
      expect(() => readRestoreBackup(d), name).toThrow();
      expect(d).toEqual(before);
    }
    for (const version of [1, 2]) {
      const d = golden();
      d.schemaVersion = version;
      d.settings.categories = null as unknown as AppData['settings']['categories'];
      expect(parseDataText(JSON.stringify(d))).toBeNull();
    }
    expect(parseDataText('')).toBeNull();
    expect(parseDataText('{')).toBeNull();
    expect(() => readRestoreBackup(null)).toThrow();
    const d = golden();
    d.cycles = [];
    expect(parseDataText(JSON.stringify(d))).toEqual(d);
  });
  it('merge / overwrite、protected、本机偏好、同名异 ID 与分类冲突矩阵', () => {
    const current = golden();
    const [a, c, b, d] = current.cycles;
    current.cycles = [a, c, d];
    const incoming = golden();
    incoming.cycles = [incoming.cycles[2], incoming.cycles[3], incoming.cycles[0]];
    incoming.cycles[1].flags = ['backup'];
    incoming.cycles[2].session!.segments[0].note = '备份版';
    incoming.settings.quickNotes = ['备份'];
    incoming.settings.notificationsEnabled = true;
    incoming.settings.hapticsEnabled = true;
    incoming.settings.soundEnabled = false;
    incoming.settings.categories.push({
      id: 'other-study',
      name: '学习',
      archived: false,
      parentId: null,
    });
    incoming.settings.categories.find((c) => c.id === 'cat-study')!.name = '学习新';
    const backup = readRestoreBackup(incoming);
    const before = structuredClone({ current, backup });
    expect(
      categoryConflicts(current.settings.categories, backup.categories).map((c) => c.id),
    ).toEqual(['cat-study']);
    expect(() => buildRestoredData(current, backup, 'merge')).toThrow();
    expect(() =>
      buildRestoredData(current, backup, 'merge', { 'cat-study': 'invalid' } as never),
    ).toThrow();
    for (const mode of ['merge', 'overwrite'] as const)
      for (const choice of ['local', 'backup'] as const) {
        const result = buildRestoredData(current, backup, mode, { 'cat-study': choice }, d.id);
        expect(result.cycles).toEqual([d, b, ...(mode === 'merge' ? [c] : []), incoming.cycles[2]]);
        expect(result.settings).toMatchObject({
          quickNotes: current.settings.quickNotes,
          notificationsEnabled: false,
          hapticsEnabled: false,
          soundEnabled: true,
        });
        expect(result.settings.categories.find((c) => c.id === 'cat-study')?.name).toBe(
          choice === 'local' ? '学习' : '学习新',
        );
        expect(result.settings.categories.find((c) => c.id === 'other-study')?.name).toBe('学习');
        expect({ current, backup }).toEqual(before);
      }
    const empty = { cycles: [], categories: backup.categories };
    expect(() =>
      buildRestoredData({ ...current, cycles: [d] }, empty, 'overwrite', {}, d.id),
    ).toThrow();
    expect(buildRestoredData(current, empty, 'merge', { 'cat-study': 'local' }).cycles).toEqual([
      d,
      c,
      a,
    ]);
    for (const patch of [
      { name: '改名' },
      { archived: true },
      { color: '#ffffff' },
      { parentId: 'daily' },
    ]) {
      const cats = structuredClone(current.settings.categories);
      Object.assign(
        cats.find((c) => c.id === 'cat-study')!,
        patch,
      );
      expect(categoryConflicts(current.settings.categories, cats).map((c) => c.id)).toEqual([
        'cat-study',
      ]);
    }
  });
  it('JSON 完整记录及分类汇总，恢复忽略派生数据；TXT/PDF 各自显示格式', () => {
    const { data, now } = localGolden();
    clock(now);
    const cats = data.settings.categories;
    const cycles = data.cycles;
    const raw = JSON.parse(buildBackupJson(cycles, data.settings));
    expect(raw).toMatchObject({
      schemaVersion: 3,
      appVersion: '0.9.0',
      exportedAtMs: now,
      cycles,
      settings: data.settings,
    });
    expect(raw.cycleSummaries).toEqual(
      expected.map((summary, i) => ({
        cycleId: cycles[i].id,
        ...summary,
        categorySummaries: Object.entries(summary.categoryMs).map(([id, durationMs]) => {
          const c = cats.find((c) => c.id === id)!;
          return {
            id,
            name: c.name,
            archived: c.archived,
            durationMs,
            parentId: c.parentId,
            parentName: c.parentId ? cats.find((p) => p.id === c.parentId)!.name : null,
            color: c.color ?? null,
          };
        }),
      })),
    );
    expect(raw.trendSummary).toMatchObject({
      days: 4,
      totalShrinkMs: -23 * H,
      totalOverrunMs: 23 * H,
    });
    const corrupted = {
      ...raw,
      cycleSummaries: [{ awakeMs: 999999 }],
      trend: [],
      trendSummary: { days: 0 },
    };
    expect(readRestoreBackup(corrupted)).toEqual(readRestoreBackup(raw));
    const txt = buildDayTxt(cycles[0], cycles, cats);
    expect(txt).toContain('主睡眠：8h；补觉：1h；总睡眠：9h');
    expect(txt).toContain('清醒预算：15h');
    expect(txt).toContain('实际清醒：7h；工作 3h（学习 1h；未细分 2h）');
    expect(txt).toContain('[工作 / 学习] 合成B');
    expect(txt).toContain('[工作] 合成A\n行');
    expect(raw.cycles[0].session.segments[0].note).toBe('  合成A\n行  ');
    const pdf = buildPdfBlocks(cycles[0], cycles, cats);
    expect(pdf).toContainEqual({ kind: 'row', text: '09:00–10:00  [学习] 合成B', right: '1h' });
    expect(pdf).toContainEqual({ kind: 'row', text: '补觉 1h · 总睡眠 9h', right: '得分 83' });
    expect(buildDayTxt(cycles[3], cycles, cats)).toContain('[进行中]');
    expect(
      buildPdfBlocks(cycles[3], cycles, cats).some((b) => b.text?.includes('–现在  [学习]')),
    ).toBe(true);
  });
});

describe('已知基线限制（单独观测，不当作更强不变量通过）', () => {
  it('重叠异常记录 TS 按先到段裁剪；parser 可接受任意正睡眠时长和不一致 derived 值', () => {
    const c = makeCycle('overlap', T, 8 * H, T + 3 * H, [
      makeSegment('a', 1, T, T + 2 * H),
      makeSegment('b', 2, T + H, T + 3 * H, 'sleep'),
    ]);
    expect(summarizeCycle(c, T + 3 * H)).toMatchObject({ napMs: H, awakeMs: 2 * H });
    const d = golden();
    d.cycles = [{ ...c, sleepAtMs: T - 1, sleepDurationMs: 123 }];
    const parsed = parseDataText(JSON.stringify(d));
    expect(parsed?.cycles[0]).toMatchObject({ sleepAtMs: T - 1, sleepDurationMs: 123 });
  });
  it('原生旧快照直接 apply 可覆盖较新镜像：协调层必须拒绝陈旧捕获', () => {
    const data = golden(),
      d = data.cycles[3];
    const old: LiveState = {
      cycleId: d.id,
      sleepAtMs: d.sleepAtMs,
      wakeAtMs: d.wakeAtMs,
      targetAtMs: d.targetAtMs,
      status: 'running',
      sessionId: d.session!.id,
      sessionStartedAtMs: d.wakeAtMs,
      notificationsEnabled: false,
      clockAnomaly: false,
      segments: d.session!.segments,
    };
    const latest: LiveState = {
      ...old,
      segments: [
        ...old.segments.slice(0, -1),
        { ...old.segments.at(-1)!, endAtMs: N, note: '通知栏新记录', source: 'notification' },
        makeSegment('next', 4, N, 0, 'unclassified'),
      ],
    };
    const mirror = applyLiveState(data, latest, N);
    expect(mirror.cycles.find((c) => c.id === d.id)?.session?.segments).toEqual(latest.segments);
    expect(applyLiveState(mirror, latest, N)).toEqual(mirror);
    expect(
      applyLiveState(mirror, old, N).cycles.find((c) => c.id === d.id)?.session?.segments,
    ).toEqual(old.segments);
  });
  it('默认夜轴 cutoff 12 点，而非注释中的 6 点', () => {
    expect(clockMinutesLateNight(new Date(2026, 10, 9, 11, 59).getTime())).toBe(2159);
    expect(clockMinutesLateNight(new Date(2026, 10, 9, 12).getTime())).toBe(720);
  });
  it('非 ongoing 闰年同比包含本年 1 月 1 日（原边界）', () => {
    const wake = new Date(2024, 0, 1, 7).getTime();
    const now = new Date(2026, 0, 1).getTime();
    const c = makeCycle('leap', wake, H, wake + H, null);
    const result = buildCategoryPeriod(buildDayMetrics([c], now), 'year', wake, now);
    expect(result.totalMs).toBe(H);
    expect(result.previousTotalMs).toBe(H);
  });
});
