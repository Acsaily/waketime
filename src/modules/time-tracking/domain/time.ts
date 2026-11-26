// 纯时间计算：不依赖 DOM/原生，便于 Node 单测
export const DAY_MS = 86_400_000;

export interface CycleTimes {
  sleepAtMs: number;
  wakeAtMs: number;
}

export interface CycleDerived {
  sleepDurationMs: number;
  awakeBudgetMs: number;
  targetAtMs: number;
}

/** 参考截止 = 入睡 + 24h（等价于醒来 + (24h - 睡眠时长)） */
export function computeCycle({ sleepAtMs, wakeAtMs }: CycleTimes): CycleDerived {
  const sleepDurationMs = wakeAtMs - sleepAtMs;
  return {
    sleepDurationMs,
    awakeBudgetMs: DAY_MS - sleepDurationMs,
    targetAtMs: sleepAtMs + DAY_MS,
  };
}

/** 正数 = 还剩多久，负数 = 已超出多久 */
export function remainingMs(targetAtMs: number, nowMs: number): number {
  return targetAtMs - nowMs;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 把跨午夜的段裁到某一天；完全不在当天返回 null */
export function splitByDay(
  segment: { startAtMs: number; endAtMs: number },
  dayStartMs: number,
  nextDayStartMs: number,
): { startAtMs: number; endAtMs: number; durationMs: number } | null {
  const start = Math.max(segment.startAtMs, dayStartMs);
  const end = Math.min(segment.endAtMs, nextDayStartMs);
  if (end <= start) return null;
  return { startAtMs: start, endAtMs: end, durationMs: end - start };
}

export type SleepInputError = 'invalid' | 'order' | 'too-long' | 'too-short' | 'future';

/** 校验睡眠录入；返回 null 表示没问题 */
export function validateSleepInput(input: CycleTimes, nowMs: number): SleepInputError | null {
  if (!Number.isFinite(input.sleepAtMs) || !Number.isFinite(input.wakeAtMs)) return 'invalid';
  const duration = input.wakeAtMs - input.sleepAtMs;
  if (input.wakeAtMs > nowMs + 60_000) return 'future';
  if (duration <= 0) return 'order';
  if (duration >= DAY_MS) return 'too-long';
  if (duration < 60 * 60_000) return 'too-short';
  return null;
}

/** cycle id 用醒来日期命名 */
export function cycleIdFor(wakeAtMs: number): string {
  return formatDate(wakeAtMs);
}

/** 新版录入：只给"醒来时刻 + 睡了多久"，入睡时刻反推出来 */
export function deriveSleep(
  wakeAtMs: number,
  durationMs: number,
): { sleepAtMs: number; wakeAtMs: number } {
  return { sleepAtMs: wakeAtMs - durationMs, wakeAtMs };
}

/** 睡眠时长的合法性（1~24 小时、必须是有限正数） */
export function validateDuration(durationMs: number): SleepInputError | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 'invalid';
  if (durationMs >= DAY_MS) return 'too-long';
  if (durationMs < 60 * 60_000) return 'too-short';
  return null;
}
/** 倒计时/超时显示统一口径：到点前是"剩余"，到点后是"已超时（从 0 往上）" */
export interface TimerDisplay {
  phase: 'remaining' | 'overrun';
  /** 非负数，直接丢给 formatDuration */
  valueMs: number;
  /** 距本次起床多久（跨午夜、超时都继续累加） */
  sinceWakeMs: number;
  /** 0~1，超过预算后恒为 1 */
  progress: number;
}

export function deriveTimerDisplay(
  wakeAtMs: number,
  targetAtMs: number,
  nowMs: number,
): TimerDisplay {
  const budget = targetAtMs - wakeAtMs;
  const elapsed = Math.max(0, nowMs - wakeAtMs);
  const delta = targetAtMs - nowMs;
  return {
    phase: delta > 0 ? 'remaining' : 'overrun',
    valueMs: Math.abs(delta),
    sinceWakeMs: elapsed,
    progress: budget > 0 ? Math.max(0, Math.min(1, elapsed / budget)) : 1,
  };
}
