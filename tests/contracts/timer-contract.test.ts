import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  categoryOf,
  editSegment,
  mergeAdjacentSegments,
  summarizeCycle,
  type SegmentPatch,
} from '../../src/modules/time-tracking/index';
import { splitSegments, type SegmentSnapshot } from '../../src/modules/time-tracking/index';
import { computeCycle } from '../../src/modules/time-tracking/index';
import type { Cycle, Segment } from '../../src/modules/time-tracking/index';

/**
 * One synthetic fixture, two real implementations. This runner executes the
 * shell's pure TS functions; the Java runner executes TimerRepository. Neither
 * side re-implements the other language, and the fixture is never copied.
 */
interface Meta {
  t: number;
  minuteMs: number;
  hourMs: number;
  bootId: string;
  mono0: number;
  timeZone: string;
}

interface SeedSegment {
  id: string;
  seq: number;
  startAtMs: number;
  endAtMs: number;
  note: string;
  category: string;
  source: string;
  splitFromId?: string;
  startMonoMs?: number;
  endMonoMs?: number;
}

interface Seed {
  cycleId: string;
  sleepAtMs: number;
  wakeAtMs: number;
  targetAtMs: number;
  status: 'idle' | 'running' | 'ended';
  sessionId: string;
  closedAtMs?: number | null;
  segments: SeedSegment[];
}

interface BridgeSegment {
  id: string;
  seq: number;
  startAtMs: number;
  endAtMs: number;
  note: string;
  category: string;
  source: string;
  splitFromId?: string;
}

interface StepArgs {
  id?: string;
  note?: string | null;
  category?: string | null;
  segmentId?: string;
  expected?: SegmentSnapshot;
  cuts?: number[];
  parts?: SegmentPatch[];
  firstId?: string;
  secondId?: string;
}

interface StepExpect {
  reject?: boolean;
  status?: 'idle' | 'running' | 'ended';
  segments?: BridgeSegment[];
  totals?: Record<string, number>;
  categories?: Record<string, number>;
  awakeBudgetMs?: number;
  persisted?: boolean;
  ts?: Partial<StepExpect>;
  java?: Partial<StepExpect>;
}

interface Step {
  op: string;
  atMs: number;
  monoMs?: number;
  bootId?: string;
  args?: StepArgs;
  expect: StepExpect;
}

interface ContractCase {
  id: string;
  scope: 'common' | 'java-only' | 'ts-only' | 'divergence';
  label: string;
  seed: Seed | null;
  makeIds?: string[];
  steps: Step[];
}

interface ContractFile {
  schema: string;
  meta: Meta;
  cases: ContractCase[];
}

const contract = JSON.parse(
  readFileSync(new URL('../../contracts/timer-cases.json', import.meta.url), 'utf8'),
) as ContractFile;

const toSegment = (s: SeedSegment): Segment => ({
  id: s.id,
  seq: s.seq,
  startAtMs: s.startAtMs,
  endAtMs: s.endAtMs,
  note: s.note,
  category: s.category,
  source: s.source as Segment['source'],
  ...(s.splitFromId ? { splitFromId: s.splitFromId } : {}),
});

const toBridge = (s: Segment): BridgeSegment => {
  const bridge: BridgeSegment = {
    id: s.id,
    seq: s.seq,
    startAtMs: s.startAtMs,
    endAtMs: s.endAtMs,
    note: s.note,
    category: categoryOf(s),
    source: s.source,
  };
  if (s.splitFromId) bridge.splitFromId = s.splitFromId;
  return bridge;
};

const mergeExpect = (expectation: StepExpect): StepExpect => {
  const base = { ...expectation };
  delete base.ts;
  delete base.java;
  return { ...base, ...(expectation.ts ?? {}) };
};

function collectLiterals(c: ContractCase): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | undefined) => {
    if (id && !id.startsWith('@')) ids.add(id);
  };
  for (const s of c.seed?.segments ?? []) {
    add(s.id);
    add(s.splitFromId);
  }
  for (const step of c.steps) {
    for (const variant of [step.expect, step.expect.ts, step.expect.java]) {
      for (const s of variant?.segments ?? []) {
        add(s.id);
        add(s.splitFromId);
      }
    }
  }
  return ids;
}

function assertSegments(
  actual: Segment[],
  expected: BridgeSegment[],
  symbols: Map<string, string>,
  literals: Set<string>,
  label: string,
): void {
  const bridge = actual.map(toBridge);
  expect(bridge, `${label}: segment count`).toHaveLength(expected.length);
  const ids = bridge.map((s) => s.id);
  expect(new Set(ids).size, `${label}: unique ids`).toBe(ids.length);
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i];
    const got = bridge[i];
    expect(got.id, `${label}: segment ${i} id non-empty`).not.toBe('');
    if (want.id.startsWith('@')) {
      const bound = symbols.get(want.id);
      if (bound === undefined) {
        expect(
          literals.has(got.id),
          `${label}: generated id ${got.id} must not reuse a literal id`,
        ).toBe(false);
        expect(
          [...symbols.values()],
          `${label}: generated id ${got.id} must be unique`,
        ).not.toContain(got.id);
        symbols.set(want.id, got.id);
      } else {
        expect(got.id, `${label}: symbol ${want.id}`).toBe(bound);
      }
    } else {
      expect(got.id, `${label}: segment ${i} id`).toBe(want.id);
    }
    expect(Object.keys(got).sort(), `${label}: segment ${i} fields`).toEqual(
      Object.keys(want).sort(),
    );
    for (const key of Object.keys(want) as (keyof BridgeSegment)[]) {
      if (key === 'id') continue;
      if (key === 'splitFromId' && want.splitFromId?.startsWith('@')) {
        const bound = symbols.get(want.splitFromId);
        expect(bound, `${label}: splitFromId symbol ${want.splitFromId} bound`).toBeDefined();
        expect(got.splitFromId, `${label}: segment ${i} splitFromId`).toBe(bound);
      } else {
        expect(got[key], `${label}: segment ${i}.${key}`).toEqual(want[key]);
      }
    }
  }
}

function runCase(c: ContractCase): void {
  const seed = c.seed;
  const state: { segments: Segment[]; status: 'idle' | 'running' | 'ended' } = {
    segments: seed ? seed.segments.map(toSegment) : [],
    status: seed?.status ?? 'idle',
  };
  const symbols = new Map<string, string>();
  const literals = collectLiterals(c);
  const idQueue = [...(c.makeIds ?? [])];

  for (const [index, step] of c.steps.entries()) {
    const label = `${c.id}/${index}:${step.op}`;
    const want = mergeExpect(step.expect);
    const before = state.segments.map(toBridge);
    let summary: ReturnType<typeof summarizeCycle> | null = null;
    let thrown: unknown = null;
    try {
      switch (step.op) {
        case 'edit':
          state.segments = editSegment(state.segments, String(step.args?.id), {
            note: step.args?.note as string,
            category: String(step.args?.category),
          });
          break;
        case 'split': {
          const used: string[] = [];
          const makeId = () => {
            const next = idQueue.shift();
            if (!next) throw new Error(`${label}: makeIds exhausted`);
            used.push(next);
            return next;
          };
          const beforeIds = new Set(state.segments.map((s) => s.id));
          const result = splitSegments(
            state.segments,
            String(step.args?.segmentId),
            {
              expected: step.args?.expected as SegmentSnapshot,
              cuts: step.args?.cuts as number[],
              parts: step.args?.parts as SegmentPatch[],
            },
            step.atMs,
            makeId,
          );
          const created = result.map((s) => s.id).filter((id) => !beforeIds.has(id));
          expect(created, `${label}: created ids follow makeIds order`).toEqual(used);
          state.segments = result;
          break;
        }
        case 'merge':
          state.segments = mergeAdjacentSegments(
            state.segments,
            String(step.args?.firstId),
            String(step.args?.secondId),
            String(step.args?.category),
          );
          break;
        case 'summarize': {
          if (!seed) throw new Error(`${label}: summarize needs a seed`);
          const cycle = {
            wakeAtMs: seed.wakeAtMs,
            sleepAtMs: seed.sleepAtMs,
            closedAtMs: seed.closedAtMs ?? null,
            session: { segments: state.segments },
          } as unknown as Cycle;
          summary = summarizeCycle(cycle, step.atMs);
          break;
        }
        default:
          throw new Error(`${label}: TS runner does not implement op ${step.op}`);
      }
    } catch (error) {
      thrown = error;
    }

    if (want.reject) {
      expect(thrown, `${label}: expected rejection`).not.toBeNull();
      expect(state.segments.map(toBridge), `${label}: rejected call must not mutate input`).toEqual(
        before,
      );
      expect(state.status, `${label}: status after rejection`).toBe(want.status ?? state.status);
      if (want.segments)
        assertSegments(state.segments, want.segments, symbols, literals, `${label} after reject`);
      continue;
    }

    expect(
      thrown,
      `${label}: unexpected rejection: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
    ).toBeNull();
    if (want.status) expect(state.status, `${label}: status`).toBe(want.status);
    if (want.segments) assertSegments(state.segments, want.segments, symbols, literals, label);

    if (want.totals) {
      if (!seed) throw new Error(`${label}: totals need a seed`);
      const derived = computeCycle({ sleepAtMs: seed.sleepAtMs, wakeAtMs: seed.wakeAtMs });
      if (!summary && step.op === 'summarize') throw new Error(`${label}: missing summary`);
      for (const [key, value] of Object.entries(want.totals)) {
        const actual =
          key === 'targetAtMs'
            ? derived.targetAtMs
            : key === 'awakeBudgetMs'
              ? derived.awakeBudgetMs
              : (summary as unknown as Record<string, number> | null)?.[key];
        expect(actual, `${label}: totals.${key}`).toBe(value);
      }
    }
    if (want.categories) {
      expect({ ...(summary?.categoryMs ?? {}) }, `${label}: categoryMs`).toEqual(want.categories);
    }
    if (want.awakeBudgetMs !== undefined) {
      if (!seed) throw new Error(`${label}: awakeBudgetMs needs a seed`);
      expect(
        computeCycle({ sleepAtMs: seed.sleepAtMs, wakeAtMs: seed.wakeAtMs }).awakeBudgetMs,
      ).toBe(want.awakeBudgetMs);
    }
  }

  expect(idQueue, `${c.id}: every declared makeId must be consumed`).toEqual([]);
}

describe('TS side of contracts/timer-cases.json', () => {
  it('loads the one shared fixture and covers all four scopes', () => {
    expect(contract.schema).toBe('waketime-timer-contract@1');
    expect(contract.meta.t).toBe(1794178800000);
    const scopes = new Set(contract.cases.map((c) => c.scope));
    expect(scopes).toEqual(new Set(['common', 'java-only', 'ts-only', 'divergence']));
    expect(contract.cases.filter((c) => c.scope !== 'java-only').length).toBeGreaterThan(0);
  });

  for (const c of contract.cases.filter((item) => item.scope !== 'java-only')) {
    it(`${c.id} [${c.scope}] ${c.label}`, () => {
      runCase(c);
    });
  }
});
