import type { Cycle, Segment } from './model';
import {
  categoryName,
  defaultCategories,
  isCategoryId,
  type CategoryDefinition,
  type CategoryId,
  type CategoryReference,
} from '../../classification/index';

export const CATEGORIES: CategoryId[] = defaultCategories().map((c) => c.id);
export function categoryOf(segment: CategoryReference): CategoryId {
  return isCategoryId(segment.category) ? segment.category : 'unclassified';
}
export function categoryLabel(category: CategoryId, catalog?: CategoryDefinition[]): string {
  return categoryName(category, catalog);
}

/** 修复旧版录入时间晚于起床时间造成的空档；不改变原段的备注和分类。 */
export function repairWakeGap(segments: Segment[], wakeAtMs: number, cycleId: string): Segment[] {
  const sorted = [...segments].sort((a, b) => a.startAtMs - b.startAtMs);
  if (
    sorted.length &&
    sorted[0].startAtMs > wakeAtMs &&
    !sorted.some((s) => s.id === `${cycleId}:wake-gap`)
  ) {
    sorted.unshift({
      id: `${cycleId}:wake-gap`,
      seq: 1,
      startAtMs: wakeAtMs,
      endAtMs: sorted[0].startAtMs,
      note: '起床后未记录（补齐）',
      source: 'app',
      category: 'unclassified',
    });
  }
  return sorted.map((s, i) => ({ ...s, seq: i + 1, category: categoryOf(s) }));
}

export interface SegmentPatch {
  note: string;
  category: CategoryId;
}
export function editSegment(segments: Segment[], id: string, patch: SegmentPatch): Segment[] {
  if (!isCategoryId(patch.category) || typeof patch.note !== 'string')
    throw new Error('分类或备注不合法');
  const target = segments.find((s) => s.id === id);
  if (!target) throw new Error('这段记录已发生变化，请重新打开');
  if (
    !target.endAtMs &&
    (categoryOf(target) === 'sleep' || patch.category === 'sleep') &&
    categoryOf(target) !== patch.category
  ) {
    throw new Error('进行中的补觉请使用开始／结束补觉按钮');
  }
  return segments.map((s) => (s.id === id ? { ...s, ...patch } : { ...s }));
}

/** 只去掉两段之间的分界，不填充暂停空档，也不删除任一段的不同备注。 */
export function mergeAdjacentSegments(
  segments: Segment[],
  firstId: string,
  secondId: string,
  category: CategoryId,
): Segment[] {
  if (!isCategoryId(category)) throw new Error('请选择合并后的分类');
  const sorted = [...segments].sort((a, b) => a.startAtMs - b.startAtMs);
  const index = sorted.findIndex((s) => s.id === firstId);
  const first = sorted[index];
  const second = sorted[index + 1];
  if (!first || !second || second.id !== secondId) throw new Error('只能合并相邻的两段');
  if (!first.endAtMs || first.endAtMs !== second.startAtMs)
    throw new Error('两段之间有暂停空档，不能合并');
  if (!second.endAtMs && (categoryOf(second) === 'sleep') !== (category === 'sleep')) {
    throw new Error('请先结束补觉，再合并包含补觉的进行中段');
  }
  const note = [first.note.trim(), second.note.trim()]
    .filter((n, i, a) => n && a.indexOf(n) === i)
    .join('\n');
  const merged: Segment = {
    ...first,
    endAtMs: second.endAtMs,
    note,
    category,
    source:
      first.source === 'notification' || second.source === 'notification' ? 'notification' : 'app',
  };
  sorted.splice(index, 2, merged);
  return sorted.map((s, i) => ({ ...s, seq: i + 1 }));
}

export interface CycleSummary {
  mainSleepMs: number;
  napMs: number;
  totalSleepMs: number;
  awakeMs: number;
  workMs: number;
  dailyMs: number;
  unclassifiedMs: number;
  /** 清醒分类的动态汇总；sleep 单列为 napMs，未分类包含暂停空档。 */
  categoryMs: Record<string, number>;
}
export function summarizeCycle(cycle: Cycle, nowMs: number): CycleSummary {
  const end = Math.max(cycle.wakeAtMs, Math.min(cycle.closedAtMs ?? nowMs, nowMs));
  const mainSleepMs = Math.max(0, cycle.wakeAtMs - cycle.sleepAtMs);
  let napMs = 0,
    classifiedMs = 0;
  const categoryMs: Record<string, number> = Object.create(null);
  // 正常记录不重叠。防御异常旧数据：按时间顺序裁掉已计算区间，保证分类不重复计时。
  let cursor = cycle.wakeAtMs;
  for (const s of [...(cycle.session?.segments ?? [])].sort((a, b) => a.startAtMs - b.startAtMs)) {
    const start = Math.max(cursor, cycle.wakeAtMs, s.startAtMs);
    const stop = Math.max(start, Math.min(end, s.endAtMs || end));
    const duration = Math.max(0, stop - start);
    const category = categoryOf(s);
    if (category === 'sleep') napMs += duration;
    else if (category !== 'unclassified') {
      categoryMs[category] = (categoryMs[category] ?? 0) + duration;
      classifiedMs += duration;
    }
    cursor = Math.max(cursor, stop);
  }
  const awakeMs = Math.max(0, end - cycle.wakeAtMs - napMs);
  categoryMs.unclassified = Math.max(0, awakeMs - classifiedMs);
  return {
    mainSleepMs,
    napMs,
    totalSleepMs: mainSleepMs + napMs,
    awakeMs,
    workMs: categoryMs.work ?? 0,
    dailyMs: categoryMs.daily ?? 0,
    unclassifiedMs: categoryMs.unclassified,
    categoryMs,
  };
}

/** 段清洗：同 id 去重（优先保留合法版本）、丢掉 end<=start 的负时长段、按开始时间排序 */
export function sanitizeSegments(segments: Segment[]): Segment[] {
  const byId = new Map<string, Segment>();
  for (const seg of segments) {
    if (!seg || typeof seg.id !== 'string' || !seg.id) continue;
    if (!Number.isFinite(seg.startAtMs)) continue;
    const valid = seg.endAtMs === 0 || seg.endAtMs > seg.startAtMs;
    const prev = byId.get(seg.id);
    const prevValid = prev ? prev.endAtMs === 0 || prev.endAtMs > prev.startAtMs : false;
    if (!prev || (valid && !prevValid))
      byId.set(seg.id, {
        ...seg,
        note: typeof seg.note === 'string' ? seg.note : '',
        category: categoryOf(seg),
      });
  }
  return [...byId.values()]
    .filter((s) => s.endAtMs === 0 || s.endAtMs > s.startAtMs)
    .sort((a, b) => a.startAtMs - b.startAtMs);
}
