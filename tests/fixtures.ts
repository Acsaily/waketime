import type { Cycle, Segment } from '../src/data/store';
export const H = 3_600_000;
export const T = Date.UTC(2026, 10, 5, 16); // 北京时间跨午夜边界
export function segment(id = 'a', start = T, end = T + 3 * H, category = 'work', note = '原备注'): Segment {
  return { id, seq: 1, startAtMs: start, endAtMs: end, category, note, source: 'notification' };
}
export function cycle(segments: Segment[] = [segment()], id = 'c'): Cycle {
  return { id, timeZone: 'Asia/Shanghai', sleepAtMs: T - 8 * H, wakeAtMs: T,
    sleepDurationMs: 8 * H, awakeBudgetMs: 16 * H, targetAtMs: T + 16 * H,
    sleepMetrics: { score: null, reportedTotalMs: null, note: null }, screenshotPath: null,
    source: 'manual', session: { id: 's', status: segments.some((s) => !s.endAtMs) ? 'running' : 'ended', startedAtMs: T, segments },
    closedAtMs: T + 3 * H, flags: [], createdAtMs: T, updatedAtMs: T };
}
