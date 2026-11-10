import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  computeCycle,
  deriveSleep,
  validateDuration,
  formatDuration,
  formatHuman,
  remainingMs,
  splitByDay,
  validateSleepInput,
} from '../../src/core/time';

const base = new Date(2026, 9, 25, 23, 30, 0).getTime(); // 2026-10-25 23:30 本地
const wake = base + 7.5 * 3600_000; // 次日 07:00

describe('computeCycle', () => {
  it('23:30 → 07:00 得到 7.5h 睡眠、16.5h 预算、截止在入睡后 24h', () => {
    const r = computeCycle({ sleepAtMs: base, wakeAtMs: wake });
    expect(r.sleepDurationMs).toBe(27_000_000);
    expect(r.awakeBudgetMs).toBe(59_400_000);
    expect(r.targetAtMs).toBe(base + DAY_MS);
  });

  it('目标时刻也等于醒来 + 预算', () => {
    const r = computeCycle({ sleepAtMs: base, wakeAtMs: wake });
    expect(r.targetAtMs).toBe(wake + r.awakeBudgetMs);
  });
});

describe('remainingMs', () => {
  it('09:00 时还剩 14.5h', () => {
    const { targetAtMs } = computeCycle({ sleepAtMs: base, wakeAtMs: wake });
    const at9 = new Date(2026, 9, 26, 9, 0, 0).getTime();
    expect(remainingMs(targetAtMs, at9)).toBe(14.5 * 3600_000);
  });

  it('过点后为负数', () => {
    const { targetAtMs } = computeCycle({ sleepAtMs: base, wakeAtMs: wake });
    expect(remainingMs(targetAtMs, targetAtMs + 15 * 60_000)).toBe(-15 * 60_000);
  });
});

describe('format', () => {
  it('formatDuration 输出 HH:MM:SS 且带符号', () => {
    expect(formatDuration(16.5 * 3600_000)).toBe('16:30:00');
    expect(formatDuration(-(15 * 60_000 + 3_000))).toBe('-00:15:03');
  });

  it('formatHuman 输出 7h30m', () => {
    expect(formatHuman(7.5 * 3600_000)).toBe('7h30m');
    expect(formatHuman(45 * 60_000)).toBe('45m');
  });
});

describe('splitByDay', () => {
  it('跨午夜段被切成两天各 10 分钟', () => {
    const day1Start = new Date(2026, 9, 26, 0, 0, 0).getTime();
    const day2Start = day1Start + DAY_MS;
    const seg = { startAtMs: day1Start - 10 * 60_000, endAtMs: day1Start + 10 * 60_000 };
    const first = splitByDay(seg, day1Start - DAY_MS, day1Start);
    const second = splitByDay(seg, day1Start, day2Start);
    expect(first?.durationMs).toBe(10 * 60_000);
    expect(second?.durationMs).toBe(10 * 60_000);
    expect((first?.durationMs ?? 0) + (second?.durationMs ?? 0)).toBe(seg.endAtMs - seg.startAtMs);
  });

  it('完全不在当天返回 null', () => {
    const day1Start = new Date(2026, 9, 26, 0, 0, 0).getTime();
    const seg = { startAtMs: day1Start - 3 * 3600_000, endAtMs: day1Start - 2 * 3600_000 };
    expect(splitByDay(seg, day1Start, day1Start + DAY_MS)).toBeNull();
  });
});

describe('validateSleepInput', () => {
  const now = new Date(2026, 9, 26, 12, 0, 0).getTime();

  it('醒来早于入睡 → order', () => {
    expect(validateSleepInput({ sleepAtMs: wake, wakeAtMs: base }, now)).toBe('order');
  });

  it('跨度超过 24h → too-long', () => {
    expect(validateSleepInput({ sleepAtMs: base - DAY_MS, wakeAtMs: base + 3600_000 }, now)).toBe('too-long');
  });

  it('正常录入返回 null', () => {
    expect(validateSleepInput({ sleepAtMs: base, wakeAtMs: wake }, now)).toBeNull();
  });
});

describe('deriveSleep / validateDuration（新版简化录入）', () => {
  it('点"现在起床"再给 7h30m，反推出昨晚入睡时间', () => {
    const wake = new Date(2026, 9, 26, 7, 0, 0).getTime();
    const r = deriveSleep(wake, 7.5 * 3600_000);
    expect(r.wakeAtMs).toBe(wake);
    expect(new Date(r.sleepAtMs).getHours()).toBe(23);
    expect(new Date(r.sleepAtMs).getMinutes()).toBe(30);
    expect(r.wakeAtMs - r.sleepAtMs).toBe(7.5 * 3600_000);
  });

  it('时长校验：0 / 30 分钟 / 25 小时都不合法，7 小时合法', () => {
    expect(validateDuration(0)).toBe('invalid');
    expect(validateDuration(30 * 60_000)).toBe('too-short');
    expect(validateDuration(25 * 3600_000)).toBe('too-long');
    expect(validateDuration(7 * 3600_000)).toBeNull();
    expect(validateDuration(Number.NaN)).toBe('invalid');
  });
});