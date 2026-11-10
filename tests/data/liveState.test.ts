import { describe, expect, it } from 'vitest';
import { applyLiveState, defaultData, sanitizeCycle, sanitizeSegments } from '../../src/data/store';
import type { Cycle } from '../../src/data/store';
import type { LiveState, TimerSegment } from '../../src/native/contracts';

const T0 = new Date(2026, 9, 26, 18, 0, 0).getTime();

function seg(id: string, startOffsetMin: number, endOffsetMin: number | null, note = ''): TimerSegment {
  return {
    id,
    seq: 0,
    startAtMs: T0 + startOffsetMin * 60_000,
    endAtMs: endOffsetMin === null ? 0 : T0 + endOffsetMin * 60_000,
    note,
    source: 'app',
  };
}

function liveOf(segments: TimerSegment[], sessionId = 'session-1', status: 'running' | 'ended' = 'running'): LiveState {
  return {
    cycleId: '2026-10-26',
    sleepAtMs: T0 - 8 * 3600_000,
    wakeAtMs: T0,
    targetAtMs: T0 + 16 * 3600_000,
    status,
    sessionId,
    sessionStartedAtMs: T0,
    notificationsEnabled: true,
    clockAnomaly: false,
    segments,
  };
}

function cycleFixture(segments: TimerSegment[]): Cycle {
  return {
    id: '2026-10-26',
    timeZone: 'Asia/Shanghai',
    sleepAtMs: T0 - 8 * 3600_000,
    wakeAtMs: T0,
    sleepDurationMs: 8 * 3600_000,
    awakeBudgetMs: 16 * 3600_000,
    targetAtMs: T0 + 16 * 3600_000,
    sleepMetrics: { score: null, reportedTotalMs: null, note: null },
    screenshotPath: null,
    source: 'manual',
    session: { id: 'session-1', status: 'running', startedAtMs: T0, segments },
    closedAtMs: null,
    flags: [],
    createdAtMs: T0,
    updatedAtMs: T0,
  };
}

describe('applyLiveState（修复历史页重复段）', () => {
  it('同一份 live 连续应用 5 次，段数不增长、无重复 id、无负时长', () => {
    const live = liveOf([seg('a', 0, 1, '起床'), seg('b', 1, null)]);
    let data = defaultData();
    for (let i = 0; i < 5; i++) {
      data = applyLiveState(data, live, T0 + i * 60_000);
    }
    const segments = data.cycles[0].session!.segments;
    expect(segments).toHaveLength(2);
    expect(new Set(segments.map((s) => s.id)).size).toBe(2);
    for (const s of segments) {
      if (s.endAtMs !== 0) expect(s.endAtMs).toBeGreaterThan(s.startAtMs);
    }
  });

  it('同一天重开计时（sessionId 变了）不会重复新旧段', () => {
    const first = liveOf([seg('a', 0, 10, '工作'), seg('b', 10, 20)], 'session-1', 'ended');
    const second = liveOf(
      [seg('a', 0, 10, '工作'), seg('b', 10, 20), seg('c', 30, 40, '吃饭'), seg('d', 40, null)],
      'session-2'
    );
    let data = applyLiveState(defaultData(), first, T0 + 20 * 60_000);
    data = applyLiveState(data, second, T0 + 40 * 60_000);
    data = applyLiveState(data, second, T0 + 41 * 60_000);
    const segments = data.cycles[0].session!.segments;
    expect(segments.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(data.cycles[0].session!.id).toBe('session-2');
  });
});

describe('sanitizeSegments（旧脏数据自愈）', () => {
  it('去重同 id、按开始时间排序', () => {
    const cleaned = sanitizeSegments([
      seg('a', 0, 2, '第一条'),
      seg('a', 0, 2, '第一条'), // 重复
      seg('b', 5, 8),
      seg('a', 0, 2, '第一条'), // 又一份重复
    ]);
    expect(cleaned.map((s) => s.id)).toEqual(['a', 'b']);
    expect(cleaned[0].note).toBe('第一条');
  });

  it('丢掉 end < start 的负时长段（真机 bug 现场）', () => {
    const cleaned = sanitizeSegments([
      seg('a', 0, 2, '起床 搓app 运动 吃晚饭'),
      { ...seg('b', 2, 0), endAtMs: T0 + 1 * 60_000 }, // 2min -> 1min，负时长
      seg('b', 2, null), // 同一个 id 的合法开放段
    ]);
    expect(cleaned.map((s) => s.id)).toEqual(['a', 'b']);
    expect(cleaned[1].endAtMs).toBe(0);
  });

  it('sanitizeCycle 能把重复 20 段的脏周期收拾干净', () => {
    const dirty: TimerSegment[] = [];
    for (let i = 0; i < 5; i++) {
      dirty.push(seg('a', 0, 2, '起床'));
      dirty.push({ ...seg('b', 2, 1), id: 'a' }); // 负时长副本
    }
    dirty.push(seg('c', 30, null));
    const cleaned = sanitizeCycle(cycleFixture(dirty));
    expect(cleaned.session!.segments).toHaveLength(2);
    expect(cleaned.session!.segments.map((s) => s.id)).toEqual(['a', 'c']);
  });
});
