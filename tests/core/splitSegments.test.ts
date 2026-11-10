import { describe, expect, it } from 'vitest';
import { matchesSnapshot, snapshotOf, splitSegments, type SplitInput } from '../../src/core/splitSegments';
import { summarizeCycle } from '../../src/core/segments';
import { cycle, H, segment, T } from '../fixtures';

function input(s = segment()): SplitInput {
  return { expected: snapshotOf(s), cuts: [T + H, T + 2 * H], parts: [
    { category: 'work', note: '写方案' }, { category: 'daily', note: '吃饭' }, { category: 'cat-study', note: '学习' },
  ] };
}
function ids() { let n = 0; return () => `new-${++n}`; }

describe('手动补分段', () => {
  it('多分界点、跨午夜，精确覆盖原段且不改变源数组', () => {
    const s = segment(); const result = splitSegments([s], s.id, input(s), T + 3 * H, ids());
    expect(result.map((r) => [r.startAtMs, r.endAtMs])).toEqual([[T, T + H], [T + H, T + 2 * H], [T + 2 * H, T + 3 * H]]);
    expect(result.reduce((n, r) => n + r.endAtMs - r.startAtMs, 0)).toBe(3 * H);
    expect(result.map((r) => r.seq)).toEqual([1, 2, 3]); expect(s.endAtMs).toBe(T + 3 * H);
  });
  it('保留原始秒/毫秒、第一段 ID、来源及拆分追踪', () => {
    const s = segment('original', T + 12_345, T + 3 * H + 54_321);
    const result = splitSegments([s], s.id, input(s), T + 4 * H, ids());
    expect(result[0].id).toBe('original'); expect(result[0].startAtMs).toBe(s.startAtMs);
    expect(result.at(-1)?.endAtMs).toBe(s.endAtMs);
    expect(result.every((r) => r.source === 'notification' && r.splitFromId === s.id)).toBe(true);
  });
  it('进行中最后一段保持开放，之后发生的时间仍计入尾段', () => {
    const s = segment('a', T, 0); const result = splitSegments([s], s.id, input(s), T + 3 * H, ids());
    expect(result.filter((r) => r.endAtMs === 0)).toHaveLength(1);
    expect(result.at(-1)?.category).toBe('cat-study');
    const c = { ...cycle(result), closedAtMs: null };
    expect(summarizeCycle(c, T + 4 * H).categoryMs['cat-study']).toBe(2 * H);
  });
  it('纯拆分不改变总睡眠或实际清醒，重分类补觉仅改变应有汇总', () => {
    const s = segment(); const draft = input(s); draft.parts = draft.parts.map((p) => ({ ...p, category: 'work' }));
    const before = summarizeCycle(cycle([s]), T + 3 * H);
    const after = summarizeCycle(cycle(splitSegments([s], s.id, draft, T + 3 * H, ids())), T + 3 * H);
    expect(after).toEqual(before);
    draft.parts[1].category = 'sleep';
    expect(summarizeCycle(cycle(splitSegments([s], s.id, draft, T + 3 * H, ids())), T + 3 * H).awakeMs).toBe(2 * H);
  });
  it('拒绝重复、倒序、端点、未来、非整数与缺失分界点', () => {
    const s = segment();
    for (const cuts of [[], [T], [T + 3 * H], [T + 4 * H], [T + H, T + H], [T + 2 * H, T + H], [NaN], [T + 0.5]]) {
      const d = input(s); d.cuts = cuts; d.parts = Array.from({ length: cuts.length + 1 }, () => ({ category: 'work', note: '' }));
      expect(() => splitSegments([s], s.id, d, T + 3 * H, ids())).toThrow();
    }
  });
  it('备注、分类、结束边界或目标 ID 变化时拒绝陈旧草稿', () => {
    const s = segment(); const d = input(s);
    for (const changed of [{ ...s, note: '通知新备注' }, { ...s, category: 'daily' }, { ...s, endAtMs: T + 4 * H }, { ...s, id: 'new' }]) {
      expect(matchesSnapshot(changed, d.expected)).toBe(false);
      expect(() => splitSegments([changed], s.id, d, T + 5 * H, ids())).toThrow();
    }
  });
  it('不能借拆分切换开放补觉状态，已结束补觉可以拆', () => {
    const sleeping = segment('a', T, 0, 'sleep');
    expect(() => splitSegments([sleeping], 'a', input(sleeping), T + 3 * H, ids())).toThrow();
    const awake = segment('a', T, 0); const d = input(awake); d.parts[2].category = 'sleep';
    expect(() => splitSegments([awake], 'a', d, T + 3 * H, ids())).toThrow();
    const closed = segment('a', T, T + 3 * H, 'sleep');
    expect(splitSegments([closed], 'a', input(closed), T + 3 * H, ids())).toHaveLength(3);
  });
  it('拒绝不完整子段、非法类别和重叠旧数据', () => {
    const s = segment(); const d = input(s); d.parts.pop();
    expect(() => splitSegments([s], 'a', d, T + 3 * H, ids())).toThrow();
    d.parts.push({ category: 'bad id', note: '' });
    expect(() => splitSegments([s], 'a', d, T + 3 * H, ids())).toThrow();
    expect(() => splitSegments([s, segment('b', T + H, T + 4 * H)], 'a', input(s), T + 4 * H, ids())).toThrow();
  });
  it('保持其他段和暂停空档不变，所有 seq 重新编号', () => {
    const s = segment(); const later = segment('later', T + 4 * H, T + 5 * H);
    const result = splitSegments([later, s], 'a', input(s), T + 5 * H, ids());
    expect(result[3]).toEqual({ ...later, seq: 4 });
    expect(result[2].endAtMs).toBe(T + 3 * H); expect(result[3].startAtMs).toBe(T + 4 * H);
  });
  it('新 ID 不得与原段或其他段碰撞；失败不修改输入', () => {
    const s = segment(); expect(() => splitSegments([s], 'a', input(s), T + 3 * H, () => 'a')).toThrow();
    expect(s.splitFromId).toBeUndefined();
  });
});
