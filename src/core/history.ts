import type { Cycle } from '../data/store';
import { summarizeCycle, type CycleSummary } from './segments';
import { clockMinutesLateNight, wakeDateOf } from './trends';

const MINUTE_MS = 60_000;

/* ---------- 本地日期 ---------- */
export function startOfLocalDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addLocalDaysMs(ms: number, days: number): number {
  const d = new Date(startOfLocalDayMs(ms));
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** 周一为一周的第一天 */
export function startOfWeekMs(ms: number): number {
  const d = new Date(startOfLocalDayMs(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

export function dateKeyOfMs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function msOfDateKey(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function addDateKey(key: string, days: number): string {
  return dateKeyOfMs(addLocalDaysMs(msOfDateKey(key), days));
}

/* ---------- 按天聚合 ---------- */
export interface DayMetric {
  /** 起床日（App 的归档口径） */
  dateKey: string;
  dateMs: number;
  /** 同一天的所有周期，按起床时间升序 */
  cycles: Cycle[];
  /** 主睡眠：当天总睡眠最长的一条；多条时用于曲线与偏移 */
  primary: Cycle;
  /** 当天所有周期的总睡眠（含补觉） */
  totalSleepMs: number;
  /** 主睡眠入睡时刻，凌晨折算到 24h 之后（便于跨午夜比较） */
  bedMinutes: number;
  wakeMinutes: number;
  /** 与恰好下一天的第一次睡眠比较；没有下一天记录时为 null */
  driftMs: number | null;
}

/** 以“起床日”为键聚合；同一天多次睡眠时保留全部，主睡眠取总睡眠最长的一条。 */
export function buildDayMetrics(cycles: Cycle[], nowMs: number): Map<string, DayMetric> {
  const groups = new Map<string, Cycle[]>();
  for (const c of cycles) {
    const key = wakeDateOf(c.wakeAtMs);
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const out = new Map<string, DayMetric>();
  for (const [key, list] of groups) {
    const sorted = [...list].sort((a, b) => a.wakeAtMs - b.wakeAtMs);
    const summaries = new Map(sorted.map((c) => [c.id, summarizeCycle(c, nowMs)]));
    let primary = sorted[0];
    let primarySleep = summaries.get(primary.id)?.totalSleepMs ?? 0;
    for (const c of sorted.slice(1)) {
      const value = summaries.get(c.id)?.totalSleepMs ?? 0;
      if (value >= primarySleep) { primary = c; primarySleep = value; }
    }
    const totalSleepMs = sorted.reduce((sum, c) => sum + (summaries.get(c.id)?.totalSleepMs ?? 0), 0);
    const bedMinutes = clockMinutesLateNight(primary.sleepAtMs);
    out.set(key, {
      dateKey: key,
      dateMs: msOfDateKey(key),
      cycles: sorted,
      primary,
      totalSleepMs,
      bedMinutes,
      // 用“入睡 + 主睡眠时长”得到起床时刻，避免把午后的起床错误折回当天上午。
      wakeMinutes: bedMinutes + (primary.wakeAtMs - primary.sleepAtMs) / MINUTE_MS,
      driftMs: null,
    });
  }

  // drift = 下一天主睡眠的入睡时刻 − 本次参考截止；缺一天就不跨日硬算。
  for (const day of out.values()) {
    const next = out.get(addDateKey(day.dateKey, 1));
    day.driftMs = next ? next.primary.sleepAtMs - day.primary.targetAtMs : null;
  }
  return out;
}

/* ---------- 周聚合 ---------- */
export interface WeekMetric {
  /** 周一日期 YYYY-MM-DD */
  key: string;
  startMs: number;
  /** 周一至周日，共 7 格 */
  days: Array<DayMetric | null>;
}

export interface DriftPoint {
  dateKey: string;
  driftMs: number;
}

export interface WeekStats {
  week: WeekMetric;
  recordedDays: number;
  avgSleepMs: number;
  avgBedMinutes: number;
  avgWakeMinutes: number;
  minBedMinutes: number;
  maxBedMinutes: number;
  spreadMinutes: number;
  drifts: DriftPoint[];
  avgAbsDriftMs: number | null;
  maxDrift: DriftPoint | null;
  latest: DayMetric;
}

export function buildWeeks(days: Map<string, DayMetric>): WeekMetric[] {
  const weeks = new Map<string, WeekMetric>();
  for (const day of days.values()) {
    const startMs = startOfWeekMs(day.dateMs);
    const key = dateKeyOfMs(startMs);
    let week = weeks.get(key);
    if (!week) {
      week = { key, startMs, days: Array.from({ length: 7 }, () => null) };
      weeks.set(key, week);
    }
    week.days[(new Date(day.dateMs).getDay() + 6) % 7] = day;
  }
  return [...weeks.values()]
    .filter((week) => week.days.some(Boolean))
    .sort((a, b) => a.startMs - b.startMs);
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function weekStats(week: WeekMetric): WeekStats | null {
  const recorded = week.days.filter((d): d is DayMetric => d !== null);
  if (!recorded.length) return null;
  const beds = recorded.map((d) => d.bedMinutes);
  const minBed = Math.min(...beds);
  const maxBed = Math.max(...beds);
  const drifts = recorded
    .filter((d): d is DayMetric & { driftMs: number } => d.driftMs !== null)
    .map((d) => ({ dateKey: d.dateKey, driftMs: d.driftMs }));
  let maxDrift: DriftPoint | null = null;
  for (const point of drifts) {
    if (!maxDrift || Math.abs(point.driftMs) > Math.abs(maxDrift.driftMs)) maxDrift = point;
  }
  return {
    week,
    recordedDays: recorded.length,
    avgSleepMs: mean(recorded.map((d) => d.totalSleepMs)) ?? 0,
    avgBedMinutes: mean(beds) ?? minBed,
    avgWakeMinutes: mean(recorded.map((d) => d.wakeMinutes)) ?? 0,
    minBedMinutes: minBed,
    maxBedMinutes: maxBed,
    spreadMinutes: maxBed - minBed,
    drifts,
    avgAbsDriftMs: mean(drifts.map((d) => Math.abs(d.driftMs))),
    maxDrift,
    latest: recorded.reduce((best, d) => (d.bedMinutes > best.bedMinutes ? d : best)),
  };
}

/* ---------- 月聚合 ---------- */
export interface MonthCell {
  dateKey: string;
  dateMs: number;
  day: DayMetric | null;
  future: boolean;
}

export interface MonthView {
  year: number;
  /** 0-11 */
  month: number;
  cells: Array<MonthCell | null>;
  recorded: DayMetric[];
  recordedDays: number;
  avgSleepMs: number | null;
  avgBedMinutes: number | null;
}

export function buildMonthView(
  days: Map<string, DayMetric>,
  year: number,
  month: number,
  nowMs: number,
): MonthView {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = startOfLocalDayMs(nowMs);
  const cells: Array<MonthCell | null> = Array.from({ length: offset }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateMs = new Date(year, month, d).getTime();
    const key = dateKeyOfMs(dateMs);
    cells.push({ dateKey: key, dateMs, day: days.get(key) ?? null, future: dateMs > today });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const recorded = cells
    .filter((cell): cell is MonthCell => cell !== null && cell.day !== null)
    .map((cell) => cell.day as DayMetric)
    .sort((a, b) => a.dateMs - b.dateMs);
  return {
    year,
    month,
    cells,
    recorded,
    recordedDays: recorded.length,
    avgSleepMs: mean(recorded.map((d) => d.totalSleepMs)),
    avgBedMinutes: mean(recorded.map((d) => d.bedMinutes)),
  };
}

/** 月份选择器里打点的月份集合：`2026-9` / `2026-10`。 */
export function monthsWithRecords(days: Map<string, DayMetric>): Set<string> {
  const out = new Set<string>();
  for (const day of days.values()) {
    const d = new Date(day.dateMs);
    out.add(`${d.getFullYear()}-${d.getMonth()}`);
  }
  return out;
}

/* ---------- 单日分类汇总 ---------- */
export function summarizeDay(day: DayMetric, nowMs: number): CycleSummary {
  const categoryMs: Record<string, number> = Object.create(null);
  let mainSleepMs = 0, napMs = 0, totalSleepMs = 0, awakeMs = 0;
  let workMs = 0, dailyMs = 0, unclassifiedMs = 0;
  for (const cycle of day.cycles) {
    const totals = summarizeCycle(cycle, nowMs);
    mainSleepMs += totals.mainSleepMs;
    napMs += totals.napMs;
    totalSleepMs += totals.totalSleepMs;
    awakeMs += totals.awakeMs;
    workMs += totals.workMs;
    dailyMs += totals.dailyMs;
    unclassifiedMs += totals.unclassifiedMs;
    for (const [key, value] of Object.entries(totals.categoryMs)) {
      categoryMs[key] = (categoryMs[key] ?? 0) + value;
    }
  }
  return { mainSleepMs, napMs, totalSleepMs, awakeMs, workMs, dailyMs, unclassifiedMs, categoryMs };
}

/* ---------- 显示格式 ---------- */
export function formatSignedShort(ms: number): string {
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes === 0) return '0m';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${minutes > 0 ? '+' : '-'}${h ? `${h}h${m ? String(m).padStart(2, '0') : ''}` : `${m}m`}`;
}

/** 7h26（不带结尾 m，供窄图表标签用） */
export function formatSleepShort(ms: number): string {
  const total = Math.max(0, Math.round(ms / MINUTE_MS));
  const h = Math.floor(total / 60);
  return `${h}h${String(total % 60).padStart(2, '0')}`;
}

export function formatClockMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function formatDateShort(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
export function formatWeekday(ms: number): string {
  return WEEKDAY_LABELS[new Date(ms).getDay()];
}

export function formatDayTitle(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日 · ${formatWeekday(ms)}`;
}

export function formatWeekRange(week: WeekMetric): string {
  return `${formatDateShort(week.startMs)} – ${formatDateShort(addLocalDaysMs(week.startMs, 6))}`;
}

export function formatMonthTitle(year: number, month: number): string {
  return `${year}年${month + 1}月`;
}
