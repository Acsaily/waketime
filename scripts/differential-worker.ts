// Runs in a fresh process, with TZ set before startup. No device or storage APIs.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// Node 22 type stripping plus the repository's extensionless TS imports.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ERR_MODULE_NOT_FOUND' &&
        specifier.startsWith('.') &&
        !/\.[cm]?[jt]sx?$/.test(specifier)
      ) {
        return next(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const request = JSON.parse(readFileSync(0, 'utf8'));
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const hours: Record<string, number> = { 'Asia/Shanghai': 8, UTC: 0, 'America/New_York': 19 };
if (
  timezone !== request.timeZone ||
  new Date('2026-01-01T00:00:00Z').getHours() !== hours[timezone]
)
  throw new Error('TZ verification failed');
const RealDate = Date;
// Freeze Date before importing either implementation; timers remain real.
// Preserve multi-argument Date constructors used by history/statistics.
globalThis.Date = new Proxy(RealDate, {
  construct(target, args) {
    return Reflect.construct(target, args.length ? args : [request.nowMs]);
  },
  apply() {
    return new RealDate(request.nowMs).toString();
  },
  get(target, key, receiver) {
    return key === 'now' ? () => request.nowMs : Reflect.get(target, key, receiver);
  },
});

const a =
  process.argv[2] === 'baseline'
    ? await import('./differential-baseline.ts')
    : await import('./differential-candidate.ts');
const now: number = request.nowMs;
function outcome<T>(fn: () => T) {
  try {
    return { accepted: true, result: fn() };
  } catch (e) {
    return { accepted: false, error: e instanceof Error ? e.message : String(e) };
  }
}
function run() {
  const parsed = a.parseDataText(request.dataText);
  const raw = outcome(() => JSON.parse(request.dataText));
  const backupResult = outcome(() => a.readRestoreBackup(raw.accepted ? raw.result : undefined));
  if (!parsed) return { parsed, backupResult };
  const { cycles, settings } = parsed;
  const catalog = settings.categories;
  const days = a.buildDayMetrics(cycles, now);
  const dayTotals = a.buildCategoryDayTotals(days, now);
  const anchors = [...new Set([now, ...cycles.map((c) => c.wakeAtMs)])];
  // Build each distinct period at every recorded anchor, including prior-period comparison.
  const periods = new Map();
  for (const mode of ['week', 'month', 'year'] as const) {
    for (const anchor of anchors) {
      const period = a.buildCategoryPeriod(days, mode, anchor, now, dayTotals);
      const key = `${mode}:${period.startMs}`;
      if (periods.has(key)) continue;
      const parents = a.categoryEntries(period, catalog, 'parent');
      const children = a.categoryEntries(period, catalog, 'child');
      periods.set(key, {
        period,
        parents,
        children,
        drill: parents.map((p) => a.categoryEntries(period, catalog, 'child', p.id)),
        percent: a.percentMap(parents, period.totalMs),
        parentBuckets: period.buckets.map((b) =>
          parents.map((p) => a.entryBucketMs(b.categoryMs, p, 'parent', catalog)),
        ),
        childBuckets: period.buckets.map((b) =>
          children.map((p) => a.entryBucketMs(b.categoryMs, p, 'child', catalog)),
        ),
      });
    }
  }
  const months = new Map();
  for (const anchor of anchors) {
    const d = new Date(anchor);
    months.set(
      `${d.getFullYear()}-${d.getMonth()}`,
      a.buildMonthView(days, d.getFullYear(), d.getMonth(), now),
    );
  }
  const trend = a.buildTrend(cycles, now);
  const json = JSON.parse(a.buildBackupJson(cycles, settings));
  const restores = [];
  const restoreBackup = a.readRestoreBackup(json);
  // Separate synthetic current data is passed explicitly. Never persist it.
  const current = a.parseDataText(request.localText) ?? a.defaultData();
  const conflicts = a.categoryConflicts(current.settings.categories, restoreBackup.categories);
  const backupBefore = JSON.stringify(restoreBackup),
    localBefore = JSON.stringify(current);
  const decisions = Object.fromEntries(conflicts.map((c) => [c.id, 'backup' as const]));
  for (const mode of ['merge', 'overwrite'] as const) {
    for (const protectedId of [undefined, current.cycles[0]?.id]) {
      restores.push(
        outcome(() => a.buildRestoredData(current, restoreBackup, mode, decisions, protectedId)),
      );
    }
  }
  restores.push(outcome(() => a.buildRestoredData(current, restoreBackup, 'merge')));
  const summaries = cycles.map((c) => {
    const summary = a.summarizeCycle(c, now);
    return {
      summary,
      next: a.summarizeCycle(c, now + 3_600_000),
      rows: a.summaryRows(summary.categoryMs, catalog),
      drill: catalog.map((p) => a.summaryRows(summary.categoryMs, catalog, p.id)),
    };
  });
  const operations = [];
  // Controlled operations only on synthetic data (including private-backup runs).
  const synthetic = a.parseDataText(request.operationText);
  if (synthetic) {
    const operationNow = RealDate.parse('2026-11-12T12:00:00+08:00');
    const segs = synthetic.cycles[0].session!.segments;
    const target = segs[0];
    const patch = { note: '差分编辑', category: 'daily' };
    const expected = a.snapshotOf(target);
    const split = { expected, cuts: [target.startAtMs + 1], parts: [patch, patch] };
    operations.push(outcome(() => a.editSegment(segs, target.id, patch)));
    operations.push(
      outcome(() => a.splitSegments(segs, target.id, split, operationNow, () => 'diff-new')),
    );
    operations.push(
      outcome(() =>
        a.splitSegments(
          segs,
          target.id,
          { ...split, expected: { ...expected, note: 'stale' } },
          operationNow,
          () => 'diff-new',
        ),
      ),
    );
    operations.push(outcome(() => a.mergeAdjacentSegments(segs, segs[0].id, segs[1].id, 'work')));
    operations.push(
      outcome(() =>
        a.changeCategories(
          synthetic.settings.categories,
          { kind: 'delete', id: 'cat-study' },
          new Set(['cat-study']),
        ),
      ),
    );
    operations.push(
      outcome(() =>
        a.changeCategories(
          synthetic.settings.categories,
          { kind: 'setParent', id: 'work', parentId: 'cat-study' },
          new Set(),
        ),
      ),
    );
    const d = synthetic.cycles[3],
      wake = d.wakeAtMs;
    const old = {
      cycleId: d.id,
      sleepAtMs: d.sleepAtMs,
      wakeAtMs: wake,
      targetAtMs: d.targetAtMs,
      status: 'running' as const,
      sessionId: 's-D',
      sessionStartedAtMs: wake,
      notificationsEnabled: false,
      clockAnomaly: false,
      segments: d.session!.segments,
    };
    const latest = {
      ...old,
      segments: [
        ...old.segments.slice(0, -1),
        {
          ...old.segments.at(-1)!,
          endAtMs: operationNow,
          note: '通知栏最新',
          source: 'notification' as const,
        },
        {
          id: 'next',
          seq: 4,
          startAtMs: operationNow,
          endAtMs: 0,
          note: '',
          category: 'unclassified',
          source: 'app' as const,
        },
      ],
    };
    const mirrored = a.applyLiveState(synthetic, latest, operationNow);
    const nextWake = operationNow + 9 * 3_600_000;
    operations.push(
      mirrored,
      a.applyLiveState(mirrored, latest, operationNow),
      a.applyLiveState(mirrored, old, operationNow),
    );
    operations.push(
      a.applyLiveState(
        mirrored,
        {
          ...latest,
          cycleId: 'next-cycle',
          sleepAtMs: nextWake - 8 * 3_600_000,
          wakeAtMs: nextWake,
          targetAtMs: nextWake + 16 * 3_600_000,
          sessionId: 'new-session',
          sessionStartedAtMs: nextWake,
          segments: [
            {
              id: 'new',
              seq: 1,
              startAtMs: nextWake,
              endAtMs: 0,
              note: '',
              category: 'unclassified',
              source: 'app',
            },
          ],
        },
        nextWake,
      ),
    );
    operations.push(
      a.computeCycle({ sleepAtMs: d.sleepAtMs, wakeAtMs: wake }),
      a.deriveTimerDisplay(wake, d.targetAtMs, d.targetAtMs),
      a.validateSleepInput({ sleepAtMs: wake - 1, wakeAtMs: wake }, operationNow),
      a.uniqueCycleId(d.id, [{ id: d.id }, { id: `${d.id}-2` }]),
      a.splitByDay({ startAtMs: wake, endAtMs: operationNow }, wake, wake + 1),
    );
  }
  const timeChecks = {
    wakeDate: a.wakeDateOf(RealDate.parse('2026-11-08T23:30:00Z')),
    localDayBefore: a.addLocalDaysMs(RealDate.parse('2026-03-09T12:00:00-04:00'), -1),
    twoDayTrend: a.trendWindow(cycles, 2, now).map((d) => d?.wakeDate ?? null),
    // Preserve both local preferences and native-like ended snapshot semantics in restore tests.
    rawBackupUnchanged: JSON.stringify(restoreBackup) === backupBefore,
    localUnchanged: JSON.stringify(current) === localBefore,
  };
  // Baseline limitations are included without masking differences.
  return {
    parsed,
    backupResult,
    summaries,
    timeChecks,
    history: {
      days,
      dayTotals,
      weeks: a.buildWeeks(days).map(a.weekStats),
      months,
      recordMonths: a.monthsWithRecords(days),
    },
    periods,
    trend,
    trendSummary: a.summarizeTrend(trend),
    trendWindow: a.trendWindow(cycles, 14, now),
    exports: {
      json,
      txt: cycles.map((c) => a.buildDayTxt(c, cycles, catalog)),
      pdfBlocks: cycles.map((c) => a.buildPdfBlocks(c, cycles, catalog)),
    },
    conflicts,
    restores,
    operations,
  };
}
try {
  const result = run();
  process.stdout.write(
    JSON.stringify(result, (_key, value) =>
      value instanceof Map ? [...value.entries()] : value instanceof Set ? [...value] : value,
    ),
  );
} finally {
  globalThis.Date = RealDate;
}
