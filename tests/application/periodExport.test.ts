import { describe, expect, it } from 'vitest';
import { periodRange, previewPeriod } from '../../src/application/index';
import { cycle, H } from '../fixtures';
import type { Cycle } from '../../src/modules/time-tracking/index';

const local = (day: number, hour = 8) => new Date(2026, 10, day, hour).getTime();
function record(day: number, id: string, hour = 8, open = false): Cycle {
  const wake = local(day, hour);
  return {
    ...cycle([], id),
    sleepAtMs: wake - 8 * H,
    wakeAtMs: wake,
    closedAtMs: open ? null : wake + 16 * H,
  };
}

describe('period export selection', () => {
  it('includes both wake dates, same-day cycles and complete overnight intervals', () => {
    const now = local(12, 12);
    const records = [
      record(13, 'outside'),
      record(12, 'open', 8, true),
      record(9, 'suffix-2', 10),
      record(8, 'outside-start'),
      record(9, 'unrelated-id'),
    ];
    const preview = previewPeriod(records, { startDate: '2026-11-09', endDate: '2026-11-12' }, now);
    expect(preview.cycles.map((c) => c.id)).toEqual(['unrelated-id', 'suffix-2', 'open']);
    expect(preview.recordedDays).toBe(2);
    expect(preview.openCycles).toBe(1);
    expect(preview.totalSleepMs).toBe(24 * H);
    expect(preview.awakeMs).toBe(36 * H);
  });
  it('rejects missing, impossible and reversed dates, but allows empty valid ranges', () => {
    for (const startDate of ['', '2026-02-30', '2026-13-01', '2026-1-1', '2026-12-01']) {
      expect(() => previewPeriod([], { startDate, endDate: '2026-11-12' }, local(12))).toThrow();
    }
    expect(
      previewPeriod([], { startDate: '2026-11-12', endDate: '2026-11-12' }, local(12)).cycles,
    ).toEqual([]);
  });
  it('includes both sides of a month boundary without including surrounding wake dates', () => {
    const records = [
      record(-1, 'oct-30'),
      record(0, 'oct-31'),
      record(1, 'nov-1'),
      record(2, 'nov-2'),
    ];
    expect(
      previewPeriod(
        records,
        { startDate: '2026-10-31', endDate: '2026-11-01' },
        local(3),
      ).cycles.map((c) => c.id),
    ).toEqual(['oct-31', 'nov-1']);
  });
  it('uses local calendar boundaries for shortcuts including rollover and leap February', () => {
    const n = new Date(2024, 2, 1, 10).getTime();
    expect(periodRange('this-week', n)).toEqual({ startDate: '2024-02-26', endDate: '2024-03-03' });
    expect(periodRange('last-week', n)).toEqual({ startDate: '2024-02-19', endDate: '2024-02-25' });
    expect(periodRange('this-month', n)).toEqual({
      startDate: '2024-03-01',
      endDate: '2024-03-31',
    });
    expect(periodRange('last-month', n)).toEqual({
      startDate: '2024-02-01',
      endDate: '2024-02-29',
    });
    expect(periodRange('last-7-days', n)).toEqual({
      startDate: '2024-02-24',
      endDate: '2024-03-01',
    });
  });
});
