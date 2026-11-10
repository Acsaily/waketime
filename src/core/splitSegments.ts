import type { Segment } from '../data/store';
import { categoryOf, type SegmentPatch } from './segments';
import { isCategoryId } from './categories';

export type SegmentSnapshot = Pick<Segment, 'id' | 'startAtMs' | 'endAtMs' | 'note'> & { category: string };
export interface SplitInput {
  expected: SegmentSnapshot;
  cuts: number[];
  parts: SegmentPatch[];
}

export function snapshotOf(segment: Segment): SegmentSnapshot {
  return { id: segment.id, startAtMs: segment.startAtMs, endAtMs: segment.endAtMs,
    note: segment.note, category: categoryOf(segment) };
}
export function matchesSnapshot(segment: Segment, expected: SegmentSnapshot): boolean {
  const current = snapshotOf(segment);
  return (Object.keys(current) as Array<keyof SegmentSnapshot>).every((key) => current[key] === expected[key]);
}

/** 只补段内部的边界，绝不扩大、缩短或填充原来的覆盖范围。 */
export function splitSegments(segments: Segment[], segmentId: string, input: SplitInput, nowMs: number,
  makeId: () => string = () => crypto.randomUUID()): Segment[] {
  const sorted = [...segments].sort((a, b) => a.startAtMs - b.startAtMs);
  const index = sorted.findIndex((s) => s.id === segmentId);
  const target = sorted[index];
  if (!target || !matchesSnapshot(target, input.expected)) throw new Error('这一段已发生变化，请关闭后重新打开，避免覆盖新记录');
  const end = target.endAtMs || nowMs;
  if (!Number.isSafeInteger(nowMs) || target.startAtMs >= end || end > nowMs) throw new Error('原段时间异常，暂时不能拆分');
  if (!target.endAtMs && categoryOf(target) === 'sleep') throw new Error('请先结束补觉，再拆分这一段');
  if (sorted.some((s, i) => i !== index && s.startAtMs < end && (s.endAtMs || nowMs) > target.startAtMs)) {
    throw new Error('原段与其他记录重叠，请先核对时间轴');
  }
  if (!input.cuts.length || input.parts.length !== input.cuts.length + 1) throw new Error('请添加至少一个分界点并填写每段分类');
  let previous = target.startAtMs;
  for (const cut of input.cuts) {
    if (!Number.isSafeInteger(cut) || cut <= previous || cut >= end) throw new Error('分界点必须在原段内部，按时间递增且不能重复');
    previous = cut;
  }
  for (const part of input.parts) {
    if (!isCategoryId(part.category) || typeof part.note !== 'string') throw new Error('子段分类或备注不合法');
  }
  if (!target.endAtMs && input.parts.at(-1)?.category === 'sleep') throw new Error('进行中的最后一段不能改为补觉，请使用开始补觉');
  const ids = new Set(segments.map((s) => s.id));
  const boundaries = [target.startAtMs, ...input.cuts];
  const replacements = boundaries.map((start, i): Segment => {
    const id = i === 0 ? target.id : makeId();
    if (i > 0 && (!id || ids.has(id))) throw new Error('生成段 ID 失败，请重试');
    ids.add(id);
    return { ...target, id, startAtMs: start, endAtMs: input.cuts[i] ?? target.endAtMs,
      ...input.parts[i], splitFromId: target.splitFromId || target.id };
  });
  sorted.splice(index, 1, ...replacements);
  return sorted.map((s, i) => ({ ...s, seq: i + 1 }));
}
