import type { CategoryDefinition } from './categories';
import { categoryName, childrenOf, isPreSleepCategory } from './categories';
import {
  addLocalDaysMs,
  dateKeyOfMs,
  formatDateShort,
  startOfLocalDayMs,
  startOfWeekMs,
  summarizeDay,
  type DayMetric,
} from './history';

export type StatsMode = 'week' | 'month' | 'year';
export type StatsView = 'total' | 'single';
/** 统计层级：大类汇总，或细分（全部/某个大类内部）。 */
export type StatsLevel = 'parent' | 'child';

export interface CategoryDayTotal {
  categoryMs: Record<string, number>;
  totalMs: number;
  /** 当天所有周期的总睡眠（含补觉）。 */
  sleepMs: number;
}

export interface CategoryBucket {
  key: string;
  label: string;
  startMs: number;
  endMs: number;
  categoryMs: Record<string, number>;
  totalMs: number;
}

export interface CategoryPeriod {
  mode: StatsMode;
  startMs: number;
  endMs: number;
  label: string;
  prevLabel: string;
  ongoing: boolean;
  buckets: CategoryBucket[];
  totals: Record<string, number>;
  totalMs: number;
  /** 本期的总睡眠（含补觉），用于和清醒时间对照。 */
  sleepMs: number;
  recordedDays: number;
  previousTotals: Record<string, number>;
  previousTotalMs: number;
}

export interface CategoryEntry {
  id: string;
  name: string;
  archived: boolean;
  ms: number;
  preSleep: boolean;
  /** 所属大类（细分层展示用）；大类层为 null。 */
  parentId?: string | null;
  parentName?: string | null;
  /** 大类层：名下有小标签的时间数量，用于「含 N 个小标签」提示。 */
  childCount?: number;
  /** 细分层：大类自身的时间桶（未细分）。 */
  parentBucket?: boolean;
}

/** 今日页汇总块的一行。 */
export interface SummaryRow {
  id: string;
  label: string;
  ms: number;
  archived: boolean;
  /** 大类名下有小标签，可下钻查看细分。 */
  drillable: boolean;
  /** 大类自身的时间桶（未细分）。 */
  parentBucket: boolean;
}

/**
 * 今日页汇总：默认只看大类（含下属小标签的时间），给 parentId 时只看该大类内部的细分。
 * 按分类目录顺序排列，时间变动时行序不跳动；未分类即使为 0 也保留，其余零时长项隐藏。
 */
export function summaryRows(
  categoryMs: Record<string, number>,
  categories: CategoryDefinition[],
  parentId: string | null = null,
): SummaryRow[] {
  const archivedSuffix = (archived: boolean) => (archived ? '（已停用）' : '');
  if (!parentId) {
    const rows: SummaryRow[] = [];
    for (const cat of categories.filter((c) => !c.parentId)) {
      if (cat.id === 'sleep') continue;
      const children = childrenOf(categories, cat.id);
      const ms = (categoryMs[cat.id] ?? 0) + children.reduce((sum, c) => sum + (categoryMs[c.id] ?? 0), 0);
      if (ms <= 0 && cat.id !== 'unclassified') continue;
      rows.push({
        id: cat.id,
        label: `${cat.name}${archivedSuffix(cat.archived)}`,
        ms,
        archived: cat.archived,
        drillable: children.length > 0,
        parentBucket: false,
      });
    }
    return rows;
  }
  const parent = categories.find((c) => c.id === parentId);
  const rows: SummaryRow[] = [];
  const own = categoryMs[parentId] ?? 0;
  if (own > 0) {
    rows.push({
      id: parentId,
      label: `${parent?.name ?? categoryName(parentId, categories)}（未细分）`,
      ms: own,
      archived: parent?.archived ?? false,
      drillable: false,
      parentBucket: true,
    });
  }
  for (const child of childrenOf(categories, parentId)) {
    const ms = categoryMs[child.id] ?? 0;
    if (ms <= 0) continue;
    rows.push({
      id: child.id,
      label: `${child.name}${archivedSuffix(child.archived)}`,
      ms,
      archived: child.archived,
      drillable: false,
      parentBucket: false,
    });
  }
  return rows;
}

const DAY = 86_400_000;

function dayIndex(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY;
}
function daysInclusive(a: number, b: number): number {
  return Math.max(0, dayIndex(b) - dayIndex(a) + 1);
}
function endOfDay(ms: number): number {
  return addLocalDaysMs(startOfLocalDayMs(ms), 1) - 1;
}
function sumCategoryMs(target: Record<string, number>, incoming: Record<string, number>): void {
  for (const [id, ms] of Object.entries(incoming)) target[id] = (target[id] ?? 0) + ms;
}
function totalOf(categoryMs: Record<string, number>): number {
  return Object.values(categoryMs).reduce((sum, ms) => sum + ms, 0);
}

/** 每天只算一次：同一天多条周期相加，补觉不进入 categoryMs。 */
export function buildCategoryDayTotals(days: Map<string, DayMetric>, nowMs: number): Map<string, CategoryDayTotal> {
  const out = new Map<string, CategoryDayTotal>();
  for (const [key, day] of days) {
    const summary = summarizeDay(day, nowMs);
    out.set(key, { categoryMs: summary.categoryMs, totalMs: totalOf(summary.categoryMs), sleepMs: summary.totalSleepMs });
  }
  return out;
}

function rangeTotals(dayTotals: Map<string, CategoryDayTotal>, startMs: number, endMs: number): Record<string, number> {
  const out: Record<string, number> = Object.create(null);
  for (let ms = startOfLocalDayMs(startMs); ms <= endMs; ms = addLocalDaysMs(ms, 1)) {
    const day = dayTotals.get(dateKeyOfMs(ms));
    if (day) sumCategoryMs(out, day.categoryMs);
  }
  return out;
}

function rangeSleepMs(dayTotals: Map<string, CategoryDayTotal>, startMs: number, endMs: number): number {
  let sum = 0;
  for (let ms = startOfLocalDayMs(startMs); ms <= endMs; ms = addLocalDaysMs(ms, 1)) {
    const day = dayTotals.get(dateKeyOfMs(ms));
    if (day) sum += day.sleepMs;
  }
  return sum;
}

function dayBucket(dayTotals: Map<string, CategoryDayTotal>, ms: number, label?: string): CategoryBucket {
  const key = dateKeyOfMs(ms);
  const day = dayTotals.get(key);
  return {
    key,
    label: label ?? formatDateShort(ms),
    startMs: ms,
    endMs: endOfDay(ms),
    categoryMs: day ? { ...day.categoryMs } : {},
    totalMs: day?.totalMs ?? 0,
  };
}

function monthBuckets(dayTotals: Map<string, CategoryDayTotal>, year: number): CategoryBucket[] {
  return Array.from({ length: 12 }, (_, month) => {
    const start = new Date(year, month, 1).getTime();
    const end = new Date(year, month + 1, 0).getTime();
    const categoryMs: Record<string, number> = Object.create(null);
    for (let ms = start; ms <= end; ms = addLocalDaysMs(ms, 1)) {
      const day = dayTotals.get(dateKeyOfMs(ms));
      if (day) sumCategoryMs(categoryMs, day.categoryMs);
    }
    return {
      key: `${year}-${month}`,
      label: `${month + 1}月`,
      startMs: start,
      endMs: endOfDay(end),
      categoryMs,
      totalMs: totalOf(categoryMs),
    };
  });
}

export function buildCategoryPeriod(
  days: Map<string, DayMetric>,
  mode: StatsMode,
  anchorMs: number,
  nowMs: number,
  dayTotals: Map<string, CategoryDayTotal> = buildCategoryDayTotals(days, nowMs),
): CategoryPeriod {
  let startMs: number;
  let endMs: number;
  let label: string;
  let buckets: CategoryBucket[];
  let prevStartMs: number;
  let prevEndMs: number;
  let prevLabel: string;
  let ongoing: boolean;

  if (mode === 'week') {
    startMs = startOfWeekMs(anchorMs);
    endMs = endOfDay(addLocalDaysMs(startMs, 6));
    const span = Math.min(7, daysInclusive(startMs, Math.min(nowMs, endMs)));
    ongoing = nowMs >= startMs && nowMs <= endMs;
    prevStartMs = addLocalDaysMs(startMs, -7);
    prevEndMs = addLocalDaysMs(prevStartMs, span - 1);
    prevLabel = ongoing ? '上周同期' : '上周';
    label = `${formatDateShort(startMs)} – ${formatDateShort(addLocalDaysMs(startMs, 6))}`;
    buckets = Array.from({ length: 7 }, (_, i) => dayBucket(dayTotals, addLocalDaysMs(startMs, i)));
  } else if (mode === 'month') {
    const d = new Date(anchorMs);
    startMs = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime();
    endMs = endOfDay(lastDay);
    ongoing = nowMs >= startMs && nowMs <= endMs;
    const span = ongoing
      ? Math.min(daysInclusive(startMs, nowMs), daysInclusive(startMs, lastDay))
      : daysInclusive(startMs, lastDay);
    const prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const prevLast = new Date(d.getFullYear(), d.getMonth(), 0);
    prevStartMs = prevStart.getTime();
    prevEndMs = endOfDay(new Date(prevStart.getFullYear(), prevStart.getMonth(), Math.min(span, prevLast.getDate())).getTime());
    prevLabel = ongoing ? '上月同期' : '上月';
    label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    buckets = Array.from({ length: daysInclusive(startMs, lastDay) }, (_, i) => dayBucket(dayTotals, addLocalDaysMs(startMs, i)));
  } else {
    const d = new Date(anchorMs);
    startMs = new Date(d.getFullYear(), 0, 1).getTime();
    endMs = endOfDay(new Date(d.getFullYear(), 11, 31).getTime());
    ongoing = nowMs >= startMs && nowMs <= endMs;
    const span = ongoing ? daysInclusive(startMs, Math.min(nowMs, endMs)) : daysInclusive(startMs, endMs);
    prevStartMs = new Date(d.getFullYear() - 1, 0, 1).getTime();
    prevEndMs = addLocalDaysMs(prevStartMs, span - 1);
    prevLabel = ongoing ? '上年同期' : '上年';
    label = `${d.getFullYear()}年`;
    buckets = monthBuckets(dayTotals, d.getFullYear());
  }

  const totals = rangeTotals(dayTotals, startMs, endMs);
  const previousTotals = rangeTotals(dayTotals, prevStartMs, prevEndMs);
  let recordedDays = 0;
  for (let ms = startMs; ms <= endMs; ms = addLocalDaysMs(ms, 1)) {
    const day = dayTotals.get(dateKeyOfMs(ms));
    if (day && day.totalMs > 0) recordedDays += 1;
  }
  return {
    mode, startMs, endMs, label, prevLabel, ongoing, buckets, totals,
    totalMs: totalOf(totals),
    sleepMs: rangeSleepMs(dayTotals, startMs, endMs),
    recordedDays,
    previousTotals,
    previousTotalMs: totalOf(previousTotals),
  };
}

/** 未知/已删除父级按大类处理，避免统计丢失。 */
function rootIdOf(id: string, catalog: CategoryDefinition[]): string {
  const cat = catalog.find((c) => c.id === id);
  if (!cat?.parentId) return id;
  const parent = catalog.find((c) => c.id === cat.parentId);
  return parent ? parent.id : id;
}

/**
 * 按层级生成占比条目。
 * - parent：所有时间汇总到顶级大类；大类自身未细分的时间并入大类。
 * - child + parentId：只看该大类内部的细分，另加大类自身时间桶。
 * - child 不指定 parentId：全部细分；有自身时间的大类显示为「（未细分）」桶。
 */
export function categoryEntries(
  period: CategoryPeriod,
  categories: CategoryDefinition[],
  level: StatsLevel = 'parent',
  parentId: string | null = null,
): CategoryEntry[] {
  const catalog = new Map(categories.map((c) => [c.id, c]));
  const order = new Map(categories.map((c, i) => [c.id, i]));
  const totals = period.totals;
  const byMsThenOrder = (a: CategoryEntry, b: CategoryEntry) =>
    b.ms - a.ms || (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999);

  if (level === 'parent') {
    const aggregated = new Map<string, number>();
    for (const [id, ms] of Object.entries(totals)) {
      if (ms <= 0) continue;
      const root = rootIdOf(id, categories);
      aggregated.set(root, (aggregated.get(root) ?? 0) + ms);
    }
    return [...aggregated.entries()].map(([id, ms]) => {
      const cat = catalog.get(id);
      return {
        id,
        name: cat?.name ?? categoryName(id, categories),
        archived: cat?.archived ?? false,
        ms,
        preSleep: isPreSleepCategory(id),
        parentId: null,
        parentName: null,
        childCount: childrenOf(categories, id).filter((c) => (totals[c.id] ?? 0) > 0).length,
      };
    }).sort(byMsThenOrder);
  }

  if (parentId) {
    const parent = catalog.get(parentId);
    const rows: CategoryEntry[] = [];
    const own = totals[parentId] ?? 0;
    if (own > 0) {
      rows.push({
        id: parentId,
        name: `${parent?.name ?? categoryName(parentId, categories)}（未细分）`,
        archived: parent?.archived ?? false,
        ms: own,
        preSleep: isPreSleepCategory(parentId),
        parentId: null,
        parentName: parent?.name ?? null,
        parentBucket: true,
      });
    }
    for (const child of childrenOf(categories, parentId)) {
      const ms = totals[child.id] ?? 0;
      if (ms <= 0) continue;
      rows.push({
        id: child.id,
        name: child.name,
        archived: child.archived,
        ms,
        preSleep: false,
        parentId,
        parentName: parent?.name ?? null,
      });
    }
    return rows.sort(byMsThenOrder);
  }

  const rows: CategoryEntry[] = [];
  for (const [id, ms] of Object.entries(totals)) {
    if (ms <= 0) continue;
    const cat = catalog.get(id);
    if (cat?.parentId) {
      const parent = catalog.get(cat.parentId);
      rows.push({
        id,
        name: parent ? `${parent.name} · ${cat.name}` : cat.name,
        archived: cat.archived,
        ms,
        preSleep: false,
        parentId: cat.parentId,
        parentName: parent?.name ?? null,
      });
      continue;
    }
    const children = childrenOf(categories, id);
    rows.push({
      id,
      name: children.length ? `${cat?.name ?? categoryName(id, categories)}（未细分）` : cat?.name ?? categoryName(id, categories),
      archived: cat?.archived ?? false,
      ms,
      preSleep: isPreSleepCategory(id),
      parentId: null,
      parentName: null,
      parentBucket: children.length > 0,
    });
  }
  return rows.sort(byMsThenOrder);
}

/** 某个桶里这个条目对应的时间；大类层要把下属小标签一起算上。 */
export function entryBucketMs(
  categoryMs: Record<string, number>,
  entry: Pick<CategoryEntry, 'id'>,
  level: StatsLevel,
  categories: CategoryDefinition[],
): number {
  if (level === 'parent') {
    let sum = categoryMs[entry.id] ?? 0;
    for (const child of childrenOf(categories, entry.id)) sum += categoryMs[child.id] ?? 0;
    return sum;
  }
  return categoryMs[entry.id] ?? 0;
}

/** 最大余数法：图例/总时间的百分比合计为 100%。 */
export function percentMap(entries: Array<{ id: string; ms: number }>, totalMs: number): Map<string, number> {
  if (totalMs <= 0) return new Map();
  const rows = entries.map((entry) => {
    const exact = entry.ms / totalMs * 100;
    const pct = Math.floor(exact);
    return { id: entry.id, pct, rem: exact - pct };
  });
  const remaining = 100 - rows.reduce((sum, row) => sum + row.pct, 0);
  [...rows].sort((a, b) => b.rem - a.rem).forEach((row, index) => {
    if (index < remaining) row.pct += 1;
  });
  return new Map(rows.map((row) => [row.id, row.pct]));
}

export function shiftPeriod(mode: StatsMode, anchorMs: number, direction: -1 | 1): number {
  if (mode === 'week') return addLocalDaysMs(startOfWeekMs(anchorMs), direction * 7);
  const d = new Date(anchorMs);
  if (mode === 'month') return new Date(d.getFullYear(), d.getMonth() + direction, 1).getTime();
  return new Date(d.getFullYear() + direction, 0, 1).getTime();
}

export function canNextPeriod(mode: StatsMode, anchorMs: number, nowMs: number): boolean {
  return shiftPeriod(mode, anchorMs, 1) <= nowMs;
}

export function canPrevPeriod(mode: StatsMode, anchorMs: number, earliestMs: number | null): boolean {
  if (earliestMs === null) return false;
  const previous = shiftPeriod(mode, anchorMs, -1);
  if (mode === 'week') return addLocalDaysMs(previous, 6) >= startOfLocalDayMs(earliestMs);
  if (mode === 'month') {
    const d = new Date(previous);
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime() >= startOfLocalDayMs(earliestMs);
  }
  return new Date(new Date(previous).getFullYear(), 11, 31).getTime() >= startOfLocalDayMs(earliestMs);
}
