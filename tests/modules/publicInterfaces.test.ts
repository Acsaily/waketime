import { describe, expect, it } from 'vitest';
import {
  completeCategories,
  changeCategories,
  defaultCategories,
  type CategoryId,
} from '../../src/modules/classification/index';
import {
  computeCycle,
  summarizeCycle,
  closeForNextSleep,
  sanitizeCycle,
  type Cycle,
  type Segment,
  type SleepMetrics,
  type TimerSession,
} from '../../src/modules/time-tracking/index';
import {
  buildDayMetrics,
  buildCategoryPeriod,
  categoryEntries,
} from '../../src/modules/analytics/index';

const H = 3_600_000;
const wake = new Date(2026, 10, 9, 7).getTime();
const metrics: SleepMetrics = { score: 80, reportedTotalMs: 8 * H, note: '合成睡眠' };
const segments: Segment[] = [
  {
    id: 'a',
    seq: 1,
    startAtMs: wake,
    endAtMs: wake + H,
    note: '合成',
    source: 'app',
    category: 'cat-study',
  },
  {
    id: 'b',
    seq: 2,
    startAtMs: wake + H,
    endAtMs: wake + 2 * H,
    note: '',
    source: 'app',
    category: 'sleep',
  },
  {
    id: 'c',
    seq: 3,
    startAtMs: wake + 2 * H,
    endAtMs: 0,
    note: '合成开放段',
    source: 'notification',
  },
];
const session: TimerSession = { id: 'session', status: 'running', startedAtMs: wake, segments };
const cycle: Cycle = {
  id: '2026-11-09',
  timeZone: 'Asia/Shanghai',
  sleepAtMs: wake - 8 * H,
  wakeAtMs: wake,
  sleepDurationMs: 8 * H,
  awakeBudgetMs: 16 * H,
  targetAtMs: wake + 16 * H,
  sleepMetrics: metrics,
  screenshotPath: null,
  source: 'manual',
  session,
  closedAtMs: null,
  flags: [],
  createdAtMs: wake,
  updatedAtMs: wake,
};

describe('pure domain public interfaces', () => {
  it('completes a classification catalog from references without a cycle or timer', () => {
    const id: CategoryId = 'cat-study';
    const completed = completeCategories(defaultCategories(), [{ category: id }]);
    expect(completed.find((entry) => entry.id === id)).toEqual({
      id,
      name: '待确认分类1',
      archived: true,
      parentId: null,
    });
    const restored = changeCategories(completed, { kind: 'restore', id }, new Set([id]));
    expect(
      changeCategories(restored, { kind: 'delete', id }, new Set([id])).find(
        (entry) => entry.id === id,
      )?.archived,
    ).toBe(true);
  });

  it('preserves the main sleep target, subtracts naps, and marks the old unclassified open tail', () => {
    expect(computeCycle(cycle)).toEqual({
      sleepDurationMs: 8 * H,
      awakeBudgetMs: 16 * H,
      targetAtMs: wake + 16 * H,
    });
    expect(summarizeCycle(cycle, wake + 4 * H)).toMatchObject({
      totalSleepMs: 9 * H,
      napMs: H,
      awakeMs: 3 * H,
      categoryMs: { 'cat-study': H, unclassified: 2 * H },
    });
    const closed = closeForNextSleep(sanitizeCycle(cycle), wake + 4 * H, wake + 12 * H);
    expect(closed).toMatchObject({
      closedAtMs: wake + 4 * H,
      updatedAtMs: wake + 12 * H,
      sleepMetrics: metrics,
    });
    expect(closed.session?.status).toBe('ended');
    expect(closed.session?.segments[2]).toEqual({
      ...segments[2],
      endAtMs: wake + 4 * H,
      category: 'pre-sleep',
    });
    expect(cycle.session?.segments[2].endAtMs).toBe(0);
  });

  it('aggregates domain records through the analytics public interface', () => {
    const catalog = changeCategories(
      defaultCategories(),
      { kind: 'add', id: 'cat-study', name: '学习', parentId: 'work' },
      new Set(),
    );
    const now = wake + 4 * H;
    const days = buildDayMetrics([cycle], now);
    expect(days.get('2026-11-09')?.totalSleepMs).toBe(9 * H);
    const period = buildCategoryPeriod(days, 'week', wake, now);
    expect(period).toMatchObject({ totalMs: 3 * H, sleepMs: 9 * H, recordedDays: 1 });
    expect(categoryEntries(period, catalog).map(({ id, ms }) => ({ id, ms }))).toEqual([
      { id: 'unclassified', ms: 2 * H },
      { id: 'work', ms: H },
    ]);
  });
});
