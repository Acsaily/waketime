import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Cycle, Segment } from '../../src/modules/time-tracking/index';
import { parseDataText } from '../../src/application/index';
import { buildRestoredData, readRestoreBackup } from '../../src/application/index';
import { buildBackupJson } from '../../src/application/index';
import { summarizeCycle, mergeAdjacentSegments } from '../../src/modules/time-tracking/index';
import { splitSegments, type SplitInput } from '../../src/modules/time-tracking/index';
import {
  changeCategories,
  requireSelectableCategory,
  type CategoryAction,
} from '../../src/modules/classification/index';
import { uniqueCycleId } from '../../src/modules/time-tracking/index';
import { buildDayMetrics } from '../../src/modules/analytics/index';
import {
  buildCategoryPeriod,
  categoryEntries,
  percentMap,
} from '../../src/modules/analytics/index';
import { golden, makeCycle, makeSegment, H, T, N } from '../fixtures/synthetic';

const config = (index: number) => ({
  numRuns: 200,
  seed: Number(process.env.FC_SEED ?? 26092601 + index),
  ...(process.env.FC_PATH !== undefined ? { path: process.env.FC_PATH } : {}),
});
const notes = fc.oneof(
  fc.constantFrom('', ' ', '  多行\n多行  ', '🧪合成'),
  fc.string({ unit: 'grapheme', maxLength: 32 }),
);
const category = fc.constantFrom(
  'work',
  'daily',
  'unclassified',
  'sleep',
  'cat-study',
  'cat-old',
  'pre-sleep',
);
const item = fc.record({
  duration: fc.integer({ min: 1, max: H }),
  gap: fc.integer({ min: 0, max: H }),
  category,
  note: notes,
  source: fc.constantFrom('app' as const, 'notification' as const),
});
const valid = fc
  .record({
    sleep: fc.integer({ min: H, max: 24 * H - 1 }),
    offset: fc.integer({ min: 0, max: 5 * H }),
    items: fc.array(item, { maxLength: 9 }),
    open: fc.boolean(),
    session: fc.boolean(),
    tail: fc.integer({ min: 1, max: H }),
  })
  .map((x) => {
    const wake = T + x.offset;
    let end = wake;
    const segments = x.items.map((s, i): Segment => {
      // The first recorded segment begins at wake. Gaps between records are allowed.
      const start = end + (i === 0 ? 0 : s.gap);
      end = start + s.duration;
      return {
        ...makeSegment(`seg-${i}`, i + 1, start, end, s.category, s.note),
        source: s.source,
        ...(i % 2 ? { splitFromId: `origin-${i}` } : {}),
      };
    });
    if (x.open && segments.length) segments.at(-1)!.endAtMs = 0;
    const now = end + x.tail;
    const cycle = makeCycle(
      'synthetic',
      wake,
      x.sleep,
      x.open ? null : end,
      x.session ? segments : null,
    );
    return { cycle, now };
  });

function oracle(cycle: Cycle, now: number) {
  const end = Math.max(cycle.wakeAtMs, Math.min(cycle.closedAtMs ?? now, now));
  const main = cycle.wakeAtMs - cycle.sleepAtMs;
  let nap = 0,
    classified = 0;
  const buckets: Record<string, number> = {};
  for (const s of cycle.session?.segments ?? []) {
    const duration = Math.max(
      0,
      Math.min(s.endAtMs || end, end) - Math.max(cycle.wakeAtMs, s.startAtMs),
    );
    const cat = s.category ?? 'unclassified';
    if (cat === 'sleep') nap += duration;
    else if (cat !== 'unclassified') {
      buckets[cat] = (buckets[cat] ?? 0) + duration;
      classified += duration;
    }
  }
  const awake = end - cycle.wakeAtMs - nap;
  buckets.unclassified = awake - classified;
  return {
    mainSleepMs: main,
    napMs: nap,
    totalSleepMs: main + nap,
    awakeMs: awake,
    workMs: buckets.work ?? 0,
    dailyMs: buckets.daily ?? 0,
    unclassifiedMs: buckets.unclassified,
    categoryMs: buckets,
  };
}

afterEach(() => vi.useRealTimers());
describe('独立 oracle 属性（每项 200 次，可用 FC_SEED / FC_PATH 重放）', () => {
  it('seed/path: 故意破坏独立属性后可重放最小反例（验证测试工具本身）', () => {
    const broken = fc.property(fc.integer({ min: 0, max: 100 }), (n) => n < 3);
    const failure = fc.check(broken, { seed: 26092609, numRuns: 200 });
    expect(failure.failed).toBe(true);
    expect(failure.counterexample).toEqual([3]);
    const replay = fc.check(broken, {
      seed: failure.seed,
      path: failure.counterexamplePath!,
      endOnFailure: true,
    });
    expect(replay.failed).toBe(true);
    expect(replay.counterexample).toEqual(failure.counterexample);
  });
  it('summary: 各分类毫秒守恒，补觉不计入清醒', () => {
    fc.assert(
      fc.property(valid, ({ cycle, now }) => {
        const before = structuredClone(cycle);
        const result = summarizeCycle(cycle, now);
        expect(result).toEqual(oracle(cycle, now));
        expect(Object.values(result.categoryMs).reduce((a, b) => a + b, 0)).toBe(result.awakeMs);
        expect(Object.values(result.categoryMs).every((v) => v >= 0)).toBe(true);
        expect(cycle).toEqual(before);
      }),
      config(0),
    );
  });
  it('split: 独立分界、稳定首 ID、开放尾部、来源和谱系', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: H }),
        fc.boolean(),
        notes,
        notes,
        fc.constantFrom('work', 'daily', 'cat-study'),
        fc.boolean(),
        (duration, open, note, note2, cat, lineage) => {
          const target = {
            ...makeSegment('target', 2, T + 1, T + 1 + duration, cat, note),
            source: 'notification' as const,
            ...(lineage ? { splitFromId: 'origin' } : {}),
          };
          const end = target.endAtMs;
          if (open) target.endAtMs = 0;
          const outside = makeSegment('before', 1, T, T + 1, 'daily', '前');
          const following = makeSegment('after', 3, end + 1, end + 2, 'daily', '后');
          const segments = open ? [outside, target] : [outside, target, following];
          const input: SplitInput = {
            expected: {
              id: target.id,
              startAtMs: target.startAtMs,
              endAtMs: target.endAtMs,
              note: target.note,
              category: target.category!,
            },
            cuts: [target.startAtMs + 1, end - 1],
            parts: [
              { category: cat, note: note2 },
              { category: cat, note: '' },
              { category: cat, note: note },
            ],
          };
          const before = structuredClone(segments),
            beforeInput = structuredClone(input);
          let i = 0;
          const now = open ? end : end + 2;
          const parts = splitSegments(segments, target.id, input, now, () => `new-${++i}`);
          const expected = [
            outside,
            ...[target.startAtMs, ...input.cuts].map((start, j) => ({
              ...target,
              id: j === 0 ? 'target' : `new-${j}`,
              seq: j + 2,
              startAtMs: start,
              endAtMs: input.cuts[j] ?? target.endAtMs,
              note: input.parts[j].note,
              splitFromId: lineage ? 'origin' : 'target',
            })),
            ...(open ? [] : [{ ...following, seq: 5 }]),
          ];
          expect(parts).toEqual(expected);
          expect(new Set(parts.map((s) => s.id)).size).toBe(parts.length);
          const c = makeCycle('split', T, 8 * H, open ? null : now, segments);
          const after = makeCycle('split', T, 8 * H, open ? null : now, parts);
          expect(summarizeCycle(after, now)).toEqual(oracle(c, now));
          const merged = mergeAdjacentSegments(
            mergeAdjacentSegments(parts, 'target', 'new-1', cat),
            'target',
            'new-2',
            cat,
          );
          expect(merged.find((s) => s.id === 'target')).toMatchObject({
            id: 'target',
            startAtMs: target.startAtMs,
            endAtMs: target.endAtMs,
            source: 'notification',
            splitFromId: lineage ? 'origin' : 'target',
          });
          expect(segments).toEqual(before);
          expect(input).toEqual(beforeInput);
        },
      ),
      config(1),
    );
  });
  it('split: 各陈旧字段、非法内部边界、重叠、ID 分配失败均原子拒绝', () => {
    fc.assert(
      fc.property(fc.integer({ min: 4, max: H }), notes, (duration, note) => {
        const a = makeSegment('a', 1, T, T + duration, 'work', note),
          b = makeSegment('b', 2, T + duration, T + duration + 1, 'daily');
        const now = b.endAtMs;
        const input: SplitInput = {
          expected: {
            id: a.id,
            startAtMs: a.startAtMs,
            endAtMs: a.endAtMs,
            note: a.note,
            category: a.category!,
          },
          cuts: [T + 1],
          parts: [
            { category: 'work', note },
            { category: 'daily', note },
          ],
        };
        const badInputs: SplitInput[] = [
          ...[
            { id: 'stale' },
            { startAtMs: T + 1 },
            { endAtMs: a.endAtMs - 1 },
            { note: note + 'x' },
            { category: 'sleep' },
          ].map((p) => ({ ...input, expected: { ...input.expected, ...p } })),
          ...[[], [T], [a.endAtMs], [now + 1], [T + 0.5], [T + 1, T + 1], [T + 2, T + 1]].map(
            (cuts) => ({
              ...input,
              cuts,
              parts: Array.from({ length: cuts.length + 1 }, () => input.parts[0]),
            }),
          ),
          { ...input, parts: [] },
          { ...input, parts: [{ category: ' ', note }, input.parts[1]] },
          {
            ...input,
            parts: [{ category: 'daily', note: null as unknown as string }, input.parts[1]],
          },
        ];
        const reject = (
          segments: Segment[],
          arg: SplitInput,
          id = 'a',
          generator = () => 'new',
        ) => {
          const before = structuredClone(segments),
            original = structuredClone(arg);
          expect(() => splitSegments(segments, id, arg, now, generator)).toThrow();
          expect(segments).toEqual(before);
          expect(arg).toEqual(original);
        };
        for (const bad of badInputs) reject([a, b], bad);
        reject([b], input);
        reject([a, b], input, 'a', () => 'b');
        reject([a, b], input, 'a', () => '');
        reject([a, { ...b, startAtMs: T + 2 }], input);
        const open = { ...a, endAtMs: 0, category: 'sleep' };
        reject([open], { ...input, expected: open });
        const openWork = { ...a, endAtMs: 0, category: 'work' };
        reject([openWork], {
          ...input,
          expected: openWork,
          parts: [input.parts[0], { category: 'sleep', note }],
        });
        // Source, seq and lineage are deliberately not snapshot matching fields.
        expect(
          splitSegments(
            [{ ...a, seq: 9, source: 'notification', splitFromId: 'origin' }, b],
            'a',
            input,
            now,
            () => 'new',
          )[0],
        ).toMatchObject({ source: 'notification', seq: 1, splitFromId: 'origin' });
      }),
      config(2),
    );
  });
  it('merge: 不填暂停空档，整条备注去重，notification 优先', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: H }),
        fc.integer({ min: 1, max: H }),
        notes,
        notes,
        fc.boolean(),
        fc.boolean(),
        (d1, d2, n1, n2, open, notify) => {
          const a = makeSegment('a', 1, T, T + d1, 'work', n1),
            b = {
              ...makeSegment('b', 2, T + d1, open ? 0 : T + d1 + d2, 'daily', n2),
              source: notify ? ('notification' as const) : ('app' as const),
            };
          const before = structuredClone([a, b]);
          const result = mergeAdjacentSegments([a, b], 'a', 'b', 'work');
          const note = [...new Set([n1.trim(), n2.trim()].filter(Boolean))].join('\n');
          expect(result).toEqual([
            { ...a, endAtMs: b.endAtMs, note, source: notify ? 'notification' : 'app' },
          ]);
          expect([a, b]).toEqual(before);
          for (const [segments, first, second, cat] of [
            [[a, b], 'b', 'a', 'work'],
            [[a, { ...b, startAtMs: b.startAtMs + 1 }], 'a', 'b', 'work'],
            [
              [
                a,
                { ...b, id: 'mid', endAtMs: b.startAtMs + 1 },
                { ...b, startAtMs: b.startAtMs + 1 },
              ],
              'a',
              'b',
              'work',
            ],
            ...(open ? [[[a, b], 'a', 'b', 'sleep']] : []),
          ] as [Segment[], string, string, string][]) {
            const original = structuredClone(segments);
            expect(() => mergeAdjacentSegments(segments, first, second, cat)).toThrow();
            expect(segments).toEqual(original);
          }
        },
      ),
      config(3),
    );
  });
  it('catalog: 随机 action 序列保留引用和合法的两层树', () => {
    const action = fc.record({
      kind: fc.constantFrom(
        'add',
        'rename',
        'delete',
        'restore',
        'setColor',
        'setParent',
        'up',
        'down',
      ),
      id: fc.integer({ min: 0, max: 7 }),
      parent: fc.integer({ min: 0, max: 7 }),
    });
    fc.assert(
      fc.property(fc.array(action, { minLength: 1, maxLength: 40 }), (actions) => {
        const base = golden().settings.categories;
        let catalog = structuredClone(base);
        const ids = [
          'work',
          'daily',
          'unclassified',
          'sleep',
          'pre-sleep',
          'cat-study',
          'cat-old',
          'new',
        ];
        const referenced = new Set(['cat-study', 'cat-old', 'work']);
        for (const x of actions) {
          const id = ids[x.id],
            parentId = ids[x.parent];
          const a = {
            kind: x.kind,
            id,
            name: `合成${x.parent}`,
            parentId,
            color: '#aabbcc',
          } as CategoryAction;
          const before = structuredClone(catalog);
          const current = before.find((c) => c.id === id);
          const parent = before.find((c) => c.id === parentId);
          const fixed = ['sleep', 'unclassified'].includes(id);
          const systemParent = ['sleep', 'unclassified', 'pre-sleep'].includes(parentId);
          const validParent = Boolean(
            parent && !parent.parentId && !parent.archived && !systemParent,
          );
          const kids = before.filter((c) => c.parentId === id);
          const nameTaken = before.some((c) => c.id !== id && c.name === `合成${x.parent}`);
          const shouldAccept =
            x.kind === 'add'
              ? !current && validParent && !nameTaken
              : !!current &&
                !fixed &&
                (id !== 'pre-sleep' || x.kind === 'rename') &&
                (x.kind === 'rename'
                  ? !nameTaken
                  : x.kind === 'setParent'
                    ? validParent && parentId !== id && kids.length === 0
                    : x.kind === 'delete'
                      ? !kids.some((c) => !c.archived)
                      : true);
          if (!shouldAccept) {
            expect(() => changeCategories(catalog, a, referenced)).toThrow();
            expect(catalog).toEqual(before);
            continue;
          }
          const next = changeCategories(catalog, a, referenced);
          expect(catalog).toEqual(before);
          if (x.kind === 'delete') {
            if (referenced.has(id)) expect(next.find((c) => c.id === id)?.archived).toBe(true);
            else expect(next.some((c) => c.id === id)).toBe(false);
          }
          catalog = next;
          expect(new Set(catalog.map((c) => c.id)).size).toBe(catalog.length);
          expect(new Set(catalog.map((c) => c.name)).size).toBe(catalog.length);
          for (const c of catalog)
            if (c.parentId) {
              const p = catalog.find((p) => p.id === c.parentId);
              expect(p).toBeDefined();
              expect(p?.id).not.toBe(c.id);
              expect(p?.parentId).toBeNull();
              expect(p?.archived).toBe(false);
              expect(['sleep', 'unclassified', 'pre-sleep']).not.toContain(p?.id);
            }
          for (const id of referenced) expect(catalog.some((c) => c.id === id)).toBe(true);
          for (const id of ['sleep', 'unclassified'])
            expect(catalog.find((c) => c.id === id)).toEqual(base.find((c) => c.id === id));
          expect(catalog.find((c) => c.id === 'pre-sleep')).toMatchObject({
            archived: false,
            parentId: null,
          });
          for (const c of catalog.filter((c) => c.archived || c.id === 'pre-sleep')) {
            expect(() => requireSelectableCategory(c.id, undefined, catalog)).toThrow();
            expect(() => requireSelectableCategory(c.id, c.id, catalog)).not.toThrow();
          }
        }
      }),
      config(4),
    );
  });
  it('migration: 规范字段完整往返、固定时间派生查询、本机偏好保留', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    fc.assert(
      fc.property(valid, ({ cycle, now }) => {
        vi.setSystemTime(now);
        const data = golden();
        data.cycles = [cycle];
        const parsed = parseDataText(JSON.stringify(data));
        expect(parsed).toEqual(data);
        const exported = JSON.parse(buildBackupJson(parsed!.cycles, parsed!.settings));
        expect(exported.cycles).toEqual(data.cycles);
        expect(exported.exportedAtMs).toBe(now);
        expect(exported.cycleSummaries[0]).toMatchObject({
          cycleId: cycle.id,
          ...oracle(cycle, now),
        });
        const local = golden();
        local.cycles = [];
        local.settings.quickNotes = ['本机'];
        local.settings.soundEnabled = false;
        const restored = buildRestoredData(local, readRestoreBackup(exported), 'overwrite');
        expect(restored.cycles).toEqual(data.cycles);
        expect(restored.settings).toEqual(local.settings);
        const again = JSON.parse(buildBackupJson(restored.cycles, restored.settings));
        expect(again.cycleSummaries).toEqual(exported.cycleSummaries);
        expect(again.trend).toEqual(exported.trend);
        const protectedLocal = { ...data, cycles: [{ ...cycle, flags: ['protected'] }] };
        for (const mode of ['merge', 'overwrite'] as const)
          expect(
            buildRestoredData(protectedLocal, readRestoreBackup(exported), mode, {}, cycle.id)
              .cycles,
          ).toEqual(protectedLocal.cycles);
      }),
      config(5),
    );
  });
  it('ID: 任意日期后缀集合返回最小未占用项', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 200 }), { maxLength: 50 }), (ns) => {
        const base = '2026-11-09';
        const ids = ns.map((n) => (n === 1 ? base : `${base}-${n}`));
        let n = 1;
        while (ns.includes(n)) n++;
        expect(
          uniqueCycleId(
            base,
            ids.map((id) => ({ id })),
          ),
        ).toBe(n === 1 ? base : `${base}-${n}`);
      }),
      config(6),
    );
  });
  it('aggregate: 同一醒日完全保留，父/细分/下钻时间相等，整数比例合计100', () => {
    fc.assert(
      fc.property(
        fc.array(valid, { maxLength: 6 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        (samples, weights) => {
          const cycles = samples.map((s, i) => ({ ...s.cycle, id: `cycle-${i}` }));
          const now = N;
          const days = buildDayMetrics(cycles, now);
          expect([...days.values()].flatMap((d) => d.cycles.map((c) => c.id)).sort()).toEqual(
            cycles.map((c) => c.id).sort(),
          );
          const categories = golden().settings.categories;
          for (const day of days.values()) {
            const period = buildCategoryPeriod(days, 'week', day.dateMs, now);
            for (const level of ['parent', 'child'] as const)
              expect(categoryEntries(period, categories, level).reduce((n, e) => n + e.ms, 0)).toBe(
                period.totalMs,
              );
            for (const parent of categoryEntries(period, categories, 'parent'))
              expect(
                categoryEntries(period, categories, 'child', parent.id).reduce(
                  (n, e) => n + e.ms,
                  0,
                ),
              ).toBe(parent.ms);
          }
          const sum = weights.reduce((a, b) => a + b, 0),
            entries = weights.map((ms, i) => ({ id: `w-${i}`, ms }));
          const percents = percentMap(entries, sum);
          expect([...percents.values()].reduce((a, b) => a + b, 0)).toBe(sum ? 100 : 0);
          for (const e of entries)
            if (sum)
              expect(Math.abs(percents.get(e.id)! - (e.ms / sum) * 100)).toBeLessThanOrEqual(1);
        },
      ),
      config(7),
    );
  });
});
