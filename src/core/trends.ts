import type { Cycle } from '../data/store';
import { summarizeCycle } from './segments';

export interface TrendDay {
  /** 周期 id（旧数据是醒来日期，新数据是 id） */
  id: string;
  /** 醒来日期 YYYY-MM-DD */
  wakeDate: string;
  sleepAtMs: number;
  wakeAtMs: number;
  sleepDurationMs: number;
  /** 相对参考截止：正=超时（熬夜），负=缩减（提前睡）；没有下一周期时 null */
  driftMs: number | null;
  /** 与上一天的睡眠时长差：正=睡多了 */
  durationDeltaMs: number | null;
  targetAtMs: number;
}

export interface TrendSummary {
  days: number;
  /** 连续超时天数（最近往回数，drift>0） */
  overrunStreak: number;
  /** 连续缩减天数 */
  shrinkStreak: number;
  /** 累计超时（只把正的 drift 相加） */
  totalOverrunMs: number;
  /** 累计缩减（只把负的 drift 相加，返回负数） */
  totalShrinkMs: number;
  /** 平均睡眠时长 */
  avgSleepMs: number;
  /** 平均入睡时刻（分钟，0~1439，以入睡当天的 00:00 起算；可能 > 1440 表示凌晨） */
  avgSleepMinutes: number | null;
  /** 平均起床时刻（分钟，0~1439） */
  avgWakeMinutes: number | null;
}

const DAY = 86_400_000;

export function wakeDateOf(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 入睡/起床时刻折算成"距离当天 00:00 的分钟数"，凌晨（0~6 点）按 +24h 处理，
 * 这样 23:50 和 00:10 在趋势图上是相邻的（1430 与 1450），不会画成跳变。 */
export function clockMinutesLateNight(ms: number, lateNightCutoffHour = 12): number {
  const d = new Date(ms);
  const minutes = d.getHours() * 60 + d.getMinutes();
  return d.getHours() < lateNightCutoffHour ? minutes + 24 * 60 : minutes;
}

/**
 * 按醒来时间升序构造趋势（纯函数，方便单测）：
 * - drift = 下一次入睡时刻 − 本次参考截止（正=超时/熬夜，负=缩减/提前睡）
 * - durationDelta = 本次睡眠时长 − 上一次睡眠时长
 */
export function buildTrend(cycles: Cycle[], nowMs = Date.now()): TrendDay[] {
  const sorted = [...cycles].sort((a, b) => a.wakeAtMs - b.wakeAtMs);
  return sorted.map((c, i) => {
    const next = sorted[i + 1];
    const prev = sorted[i - 1];
    return {
      id: c.id,
      wakeDate: wakeDateOf(c.wakeAtMs),
      sleepAtMs: c.sleepAtMs,
      wakeAtMs: c.wakeAtMs,
      sleepDurationMs: summarizeCycle(c, nowMs).totalSleepMs,
      targetAtMs: c.targetAtMs,
      driftMs: next ? next.sleepAtMs - c.targetAtMs : null,
      durationDeltaMs: prev ? summarizeCycle(c, nowMs).totalSleepMs - summarizeCycle(prev, nowMs).totalSleepMs : null,
    };
  });
}

export function summarizeTrend(days: TrendDay[]): TrendSummary {
  const withDrift = days.filter((d) => d.driftMs !== null);
  let overrunStreak = 0;
  let shrinkStreak = 0;
  for (let i = withDrift.length - 1; i >= 0; i--) {
    const v = withDrift[i].driftMs as number;
    if (v > 0) {
      if (shrinkStreak > 0) break;
      overrunStreak++;
    } else if (v < 0) {
      if (overrunStreak > 0) break;
      shrinkStreak++;
    } else {
      break;
    }
  }
  const totalOverrunMs = withDrift.reduce((acc, d) => acc + Math.max(0, d.driftMs as number), 0);
  const totalShrinkMs = withDrift.reduce((acc, d) => acc + Math.min(0, d.driftMs as number), 0);
  const avgSleepMs = days.length ? days.reduce((a, d) => a + d.sleepDurationMs, 0) / days.length : 0;
  return {
    days: days.length,
    overrunStreak,
    shrinkStreak,
    totalOverrunMs,
    totalShrinkMs,
    avgSleepMs,
    avgSleepMinutes: days.length
      ? days.reduce((a, d) => a + clockMinutesLateNight(d.sleepAtMs), 0) / days.length
      : null,
    avgWakeMinutes: days.length
      ? days.reduce((a, d) => a + (new Date(d.wakeAtMs).getHours() * 60 + new Date(d.wakeAtMs).getMinutes()), 0) /
        days.length
      : null,
  };
}

/** 最近 N 天（按醒来日期对齐今天），缺失日 cycle 为空 —— 图表留空不补零 */
export function trendWindow(cycles: Cycle[], days: number, nowMs: number): Array<TrendDay | null> {
  const trend = buildTrend(cycles, nowMs);
  const byDate = new Map(trend.map((d) => [d.wakeDate, d]));
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const out: Array<TrendDay | null> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * DAY);
    out.push(byDate.get(wakeDateOf(d.getTime())) ?? null);
  }
  return out;
}

export function formatSigned(ms: number): string {
  const sign = ms > 0 ? '+' : ms < 0 ? '-' : '';
  const total = Math.round(Math.abs(ms) / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${sign}${m}m`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h${m}m`;
}
