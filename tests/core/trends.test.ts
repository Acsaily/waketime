import { describe, expect, it } from 'vitest';
import { deriveTimerDisplay, formatDuration } from '../../src/core/time';
import { buildTrend, summarizeTrend, trendWindow } from '../../src/core/trends';
import type { Cycle } from '../../src/data/store';

const base = new Date(2026, 9, 26, 0, 0, 0).getTime(); // 10-26 00:00

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
    session: { id: 's-' + id, status: 'ended', startedAtMs: wakeAtMs, segments: [] },
    closedAtMs: null,
    flags: [],
    createdAtMs: wakeAtMs,
    updatedAtMs: wakeAtMs,
  };
}

describe('deriveTimerDisplay（倒计时 → 超时正计时）', () => {
  const wake = base + 6 * 3600_000; // 06:00
  const target = wake + 18 * 3600_000; // 次日 00:00

  it('没到参考截止：显示剩余', () => {
    const t = deriveTimerDisplay(wake, target, target - 3600_000);
    expect(t.phase).toBe('remaining');
    expect(t.valueMs).toBe(3600_000);
    expect(t.sinceWakeMs).toBe(17 * 3600_000);
    expect(t.progress).toBeCloseTo(17 / 18, 5);
  });

  it('刚到点：超时 0', () => {
    const t = deriveTimerDisplay(wake, target, target);
    expect(t.phase).toBe('overrun');
    expect(t.valueMs).toBe(0);
    expect(formatDuration(t.valueMs)).toBe('00:00:00');
  });

  it('过点后从 0 往上，进度条保持满格，跨午夜也算对', () => {
    const t = deriveTimerDisplay(wake, target, target + 2 * 3600_000 + 30 * 60_000);
    expect(t.phase).toBe('overrun');
    expect(t.valueMs).toBe(2.5 * 3600_000);
    expect(t.progress).toBe(1);
    expect(t.sinceWakeMs).toBe(20.5 * 3600_000);
    expect(formatDuration(t.valueMs)).toBe('02:30:00');
  });

  it('超过 24 小时不倒扣、不取模', () => {
    const t = deriveTimerDisplay(wake, target, target + 25 * 3600_000);
    expect(formatDuration(t.valueMs)).toBe('25:00:00');
  });
});

describe('buildTrend / summarizeTrend（超时与缩减）', () => {
  // 第 1 天：00:00 睡 06:00 起 → 预算 18h，参考截止 = 次日 00:00
  // 第 2 天：01:00 睡 08:00 起 → 相对第 1 天截止 = 超时 1h；睡 7h → 预算 17h
  // 第 3 天：23:30 睡（提前 1.5h）07:00 起
  const d1Sleep = base;
  const d1Wake = base + 6 * 3600_000;
  const d2Sleep = base + 25 * 3600_000; // 次日 01:00
  const d2Wake = base + 32 * 3600_000; // 08:00
  const d3Sleep = base + 47.5 * 3600_000; // 第三天 23:30
  const d3Wake = base + 55 * 3600_000; // 第四天 07:00
  const cycles = [
    cycle('d1', d1Sleep, d1Wake),
    cycle('d2', d2Sleep, d2Wake),
    cycle('d3', d3Sleep, d3Wake),
  ];

  it('drift = 下一次入睡 − 本次参考截止（熬夜为正）', () => {
    const t = buildTrend(cycles);
    expect(t[0].driftMs).toBe(3600_000); // 01:00 - 00:00 = +1h
    expect(t[1].driftMs).toBe(-1.5 * 3600_000); // 23:30 - 次日 01:00 = -1.5h
    expect(t[2].driftMs).toBeNull();
  });

  it('睡眠时长变化方向正确', () => {
    const t = buildTrend(cycles);
    expect(t[0].durationDeltaMs).toBeNull();
    expect(t[1].durationDeltaMs).toBe(3600_000); // 7h - 6h
    expect(t[2].durationDeltaMs).toBe(0.5 * 3600_000); // 7.5h(23:30→07:00) - 7h
  });

  it('汇总：累计超时/缩减、连续方向', () => {
    const s = summarizeTrend(buildTrend(cycles));
    expect(s.totalOverrunMs).toBe(3600_000);
    expect(s.totalShrinkMs).toBe(-1.5 * 3600_000);
    // 最近一次是缩减，缩减连续 1 天，超时连续 0
    expect(s.shrinkStreak).toBe(1);
    expect(s.overrunStreak).toBe(0);
    expect(s.days).toBe(3);
  });

  it('缺失日留空，不补零', () => {
    const w = trendWindow([cycles[0], cycles[2]], 3, d3Wake + 3600_000);
    expect(w).toHaveLength(3);
    expect(w[0]?.id).toBe('d1');
    expect(w[1]).toBeNull();
    expect(w[2]?.id).toBe('d3');
  });
});
