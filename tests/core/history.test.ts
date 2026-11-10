import { describe, expect, it } from 'vitest';
import type { Cycle } from '../../src/data/store';
import {
  buildDayMetrics,
  buildMonthView,
  buildWeeks,
  formatClockMinutes,
  formatSignedShort,
  formatWeekRange,
  summarizeDay,
  weekStats,
} from '../../src/core/history';

const H = 3_600_000;
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function cycle(id: string, sleepAtMs: number, wakeAtMs: number): Cycle {
  const sleepDurationMs = wakeAtMs - sleepAtMs;
  return {
    id,
    timeZone: 'Asia/Shanghai',
    sleepAtMs,
    wakeAtMs,
    sleepDurationMs,
    awakeBudgetMs: 86_400_000 - sleepDurationMs,
    targetAtMs: sleepAtMs + 86_400_000,
    sleepMetrics: { score: null, reportedTotalMs: null, note: null },
    screenshotPath: null,
    source: 'manual',
    session: { id: `s-${id}`, status: 'ended', startedAtMs: wakeAtMs, segments: [] },
    closedAtMs: null,
    flags: [],
    createdAtMs: wakeAtMs,
    updatedAtMs: wakeAtMs,
  };
}

describe('buildDayMetrics（按起床日聚合）', () => {
  it('同一天多次睡眠保留全部，主睡眠取最长的一条', () => {
    const main = cycle('main', local(2026, 11, 8, 1, 56), local(2026, 11, 8, 9, 42));
    const nap = cycle('nap', local(2026, 11, 8, 14, 0), local(2026, 11, 8, 17, 0));
    const days = buildDayMetrics([main, nap], local(2026, 11, 9, 12));
    const day = days.get('2026-11-08');
    expect(day?.cycles).toHaveLength(2);
    expect(day?.primary.id).toBe('main');
    expect(day?.totalSleepMs).toBe((466 + 180) * 60_000);
    expect(day?.bedMinutes).toBe(1 * 60 + 56 + 24 * 60);
  });

  it('drift 只与恰好下一天比较；缺一天就是 null', () => {
    const d1 = cycle('d1', local(2026, 11, 1, 23, 30), local(2026, 11, 2, 7, 0));
    const d2 = cycle('d2', local(2026, 11, 4, 0, 30), local(2026, 11, 4, 8, 0));
    const days = buildDayMetrics([d1, d2], local(2026, 11, 5, 12));
    expect(days.get('2026-11-02')?.driftMs).toBeNull();
    expect(days.get('2026-11-04')?.driftMs).toBeNull();
  });

  it('相邻两天正常计算跨午夜偏移', () => {
    const d1 = cycle('d1', local(2026, 11, 1, 23, 30), local(2026, 11, 2, 7, 0));
    const d2 = cycle('d2', local(2026, 11, 3, 0, 30), local(2026, 11, 3, 8, 0));
    const days = buildDayMetrics([d1, d2], local(2026, 11, 4, 12));
    // 11/2 的参考截止 = 11/1 23:30 + 24h = 11/2 23:30；下一次入睡 11/3 00:30 → +1h
    expect(days.get('2026-11-02')?.driftMs).toBe(H);
  });

  it('午后起床仍落在同一夜轴上', () => {
    const late = cycle('late', local(2026, 11, 8, 2, 0), local(2026, 11, 8, 13, 30));
    const day = buildDayMetrics([late], local(2026, 11, 9, 18)).get('2026-11-08');
    expect(day?.bedMinutes).toBe(2 * 60 + 24 * 60);
    expect(day?.wakeMinutes).toBe(2 * 60 + 24 * 60 + 11.5 * 60);
    expect(formatClockMinutes(day?.wakeMinutes ?? 0)).toBe('13:30');
  });
});

describe('周聚合', () => {
  const c1 = cycle('c1', local(2026, 10, 26, 23, 30), local(2026, 10, 27, 7, 0));
  const c2 = cycle('c2', local(2026, 10, 28, 0, 30), local(2026, 10, 28, 8, 0));
  const days = buildDayMetrics([c1, c2], local(2026, 10, 30, 12));
  const weeks = buildWeeks(days);

  it('周从周一开始，只保留有记录的周', () => {
    expect(weeks).toHaveLength(1);
    expect(weeks[0].key).toBe('2026-10-26');
    expect(weeks[0].days[1]?.dateKey).toBe('2026-10-27');
    expect(weeks[0].days[2]?.dateKey).toBe('2026-10-28');
    expect(weeks[0].days[6]).toBeNull();
    expect(formatWeekRange(weeks[0])).toBe('10/26 – 11/1');
  });

  it('平均入睡把 23:30 与 00:30 放在同一夜轴上', () => {
    const stats = weekStats(weeks[0]);
    expect(stats?.recordedDays).toBe(2);
    expect(stats?.minBedMinutes).toBe(23 * 60 + 30);
    expect(stats?.maxBedMinutes).toBe(24 * 60 + 30);
    expect(stats?.avgBedMinutes).toBe(24 * 60);
    expect(formatClockMinutes(stats?.avgBedMinutes ?? 0)).toBe('00:00');
    expect(stats?.spreadMinutes).toBe(60);
  });

  it('平均偏移只统计有下一晚记录的天', () => {
    const stats = weekStats(weeks[0]);
    expect(stats?.drifts).toHaveLength(1);
    expect(stats?.drifts.map((d) => d.dateKey)).toEqual(['2026-10-27']);
    expect(stats?.avgAbsDriftMs).toBe(H);
    expect(stats?.maxDrift?.dateKey).toBe('2026-10-27');
  });
});

describe('月聚合', () => {
  const cycles = [
    cycle('a', local(2026, 10, 1, 1, 0), local(2026, 10, 1, 8, 0)),
    cycle('b', local(2026, 10, 2, 2, 0), local(2026, 10, 2, 9, 30)),
    cycle('c', local(2026, 10, 20, 0, 30), local(2026, 10, 20, 7, 30)),
  ];
  const days = buildDayMetrics(cycles, local(2026, 10, 25, 12));
  const view = buildMonthView(days, 2026, 9, local(2026, 10, 25, 12));

  it('10/1 是周四，前面留 3 个空位；31 天补齐到 7 的倍数', () => {
    expect(view.cells[0]).toBeNull();
    expect(view.cells[3]?.dateKey).toBe('2026-10-01');
    expect(view.cells).toHaveLength(35);
  });

  it('记录天数、平均睡眠与未来日期正确', () => {
    expect(view.recordedDays).toBe(3);
    expect(view.avgSleepMs).toBe((7 * H + 7.5 * H + 7 * H) / 3);
    expect(view.cells.find((c) => c?.dateKey === '2026-10-26')?.future).toBe(true);
    expect(view.cells.find((c) => c?.dateKey === '2026-10-24')?.future).toBe(false);
  });

  it('同一天多段的分类汇总相加', () => {
    const day = days.get('2026-10-20');
    expect(day).toBeTruthy();
    const totals = summarizeDay(day!, local(2026, 10, 25, 12));
    expect(totals.totalSleepMs).toBe(7 * H);
  });
});

describe('格式', () => {
  it('窄偏移标签', () => {
    expect(formatSignedShort(52 * 60_000)).toBe('+52m');
    expect(formatSignedShort(-70 * 60_000)).toBe('-1h10');
    expect(formatSignedShort(0)).toBe('0m');
  });
});
