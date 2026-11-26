import type { AppData } from '../../src/application/index';
import type { Cycle, Segment } from '../../src/modules/time-tracking/index';
import schema1 from './schema-1.json';
import schema2 from './schema-2.json';
import schema3 from './schema-3.json';

export const H = 3_600_000;
export const T = Date.parse('2026-11-09T07:00:00+08:00');
export const N = T + 77 * H;
export const schemas = [schema1, schema2, schema3];
export const golden = (): AppData => structuredClone(schema3) as AppData;

// Independent constructor: deliberately no production factories or normalization.
export function makeCycle(
  id: string,
  wake: number,
  sleepMs: number,
  close: number | null,
  segments: Segment[] | null,
): Cycle {
  return {
    id,
    timeZone: 'Asia/Shanghai',
    sleepAtMs: wake - sleepMs,
    wakeAtMs: wake,
    sleepDurationMs: sleepMs,
    awakeBudgetMs: 24 * H - sleepMs,
    targetAtMs: wake - sleepMs + 24 * H,
    sleepMetrics: { score: 83, reportedTotalMs: sleepMs - 1, note: '合成睡眠\n备注' },
    screenshotPath: 'synthetic/sleep.png',
    source: 'backfill',
    session:
      segments === null
        ? null
        : {
            id: `session-${id}`,
            startedAtMs: wake,
            status: segments.some((s) => s.endAtMs === 0) ? 'running' : 'ended',
            segments,
          },
    closedAtMs: close,
    flags: ['clock_anomaly'],
    createdAtMs: wake,
    updatedAtMs: wake + 1,
  };
}

export function makeSegment(
  id: string,
  seq: number,
  start: number,
  end: number,
  category = 'work',
  note = '',
): Segment {
  return { id, seq, startAtMs: start, endAtMs: end, category, note, source: 'app' };
}

// The calendar golden assertions also run on a developer's default time zone.
// Translate the fixed fixture as a whole to the same LOCAL November calendar.
// The process-isolated differential runner separately verifies actual TZ values.
export function localGolden(): { data: AppData; now: number; t: number } {
  const t = new Date(2026, 10, 9, 7).getTime();
  const shift = t - T;
  const data = golden();
  for (const c of data.cycles) {
    c.sleepAtMs += shift;
    c.wakeAtMs += shift;
    c.targetAtMs += shift;
    c.createdAtMs += shift;
    c.updatedAtMs += shift;
    if (c.closedAtMs !== null) c.closedAtMs += shift;
    if (c.session) {
      c.session.startedAtMs += shift;
      for (const s of c.session.segments) {
        s.startAtMs += shift;
        if (s.endAtMs !== 0) s.endAtMs += shift;
      }
    }
  }
  return { data, now: t + 77 * H, t };
}
