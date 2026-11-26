import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const worker = fileURLToPath(new URL('./differential-worker.ts', import.meta.url));
const readFixture = (n) =>
  readFileSync(new URL(`../tests/fixtures/schema-${n}.json`, import.meta.url), 'utf8');
const privateMode = process.argv.includes('--backup');
// Root-local synthetic data are the only fixtures read implicitly.
const V3 = readFixture(3);
const N = Date.parse('2026-11-12T12:00:00+08:00');
const zones = ['Asia/Shanghai', 'UTC', 'America/New_York'];

// Never emit child stderr, input filenames, values, dynamic keys, or private IDs.
function execute(side, dataText, timeZone, nowMs) {
  const local = JSON.parse(V3);
  local.cycles = [local.cycles[3], local.cycles[1]]; // protected open cycle and unmatched cycle
  local.cycles[0].session.segments[0].note = '本机保护记录';
  local.settings.categories.find((c) => c.id === 'cat-study').name = '本机学习';
  const child = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', worker, side],
    {
      cwd: root,
      env: { ...process.env, TZ: timeZone },
      input: JSON.stringify({
        dataText,
        timeZone,
        nowMs,
        localText: JSON.stringify(local),
        operationText: V3,
      }),
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 120_000,
    },
  );
  if (child.status !== 0)
    throw new Error(`${side} worker failed (${child.status ?? 'no exit status'})`);
  try {
    return JSON.parse(child.stdout);
  } catch {
    throw new Error(`${side} worker produced invalid result`);
  }
}

const fields = new Set(
  'parsed backupResult summaries summary history days dayTotals weeks months recordMonths periods period parents children drill percent parentBuckets childBuckets trend trendSummary trendWindow exports json txt pdfBlocks conflicts restores operations accepted result error cycles settings categories session segments id seq startAtMs endAtMs note category source splitFromId name archived color parentId timeZone sleepAtMs wakeAtMs sleepDurationMs awakeBudgetMs targetAtMs sleepMetrics screenshotPath closedAtMs flags createdAtMs updatedAtMs score reportedTotalMs status startedAtMs notificationsEnabled quickNotes hapticsEnabled soundEnabled schemaVersion appVersion exportedAtMs cycleSummaries categorySummaries durationMs parentName categoryMs napMs totalSleepMs awakeMs mainSleepMs workMs dailyMs unclassifiedMs driftMs durationDeltaMs totals totalMs previousTotals previousTotalMs kind text right'.split(
    ' ',
  ),
);
// Field paths use only a controlled vocabulary; arrays and dynamic map keys are
// anonymized. Array order is significant; plain object property order is not.
function compare(a, b) {
  const counts = {};
  function add(path, type) {
    const key = `${path || 'root'}:${type}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  function visit(x, y, path) {
    if (isDeepStrictEqual(x, y)) return;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length) add(path, 'length');
      for (let i = 0; i < Math.min(x.length, y.length); i++) visit(x[i], y[i], `${path}[]`);
    } else if (
      x &&
      y &&
      typeof x === 'object' &&
      typeof y === 'object' &&
      !Array.isArray(x) &&
      !Array.isArray(y)
    ) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        const next = `${path}.${fields.has(k) ? k : '<field>'}`;
        if (!Object.hasOwn(x, k) || !Object.hasOwn(y, k)) add(next, 'presence');
        else visit(x[k], y[k], next);
      }
    } else add(path, `${x === null ? 'null' : typeof x}/${y === null ? 'null' : typeof y}`);
  }
  visit(a, b, '');
  return counts;
}

function total(counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}
function preservation(text, result) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { accepted: false };
  }
  if (!result.parsed) return { accepted: false };
  const after = result.parsed;
  const count = {
    accepted: true,
    cycles: raw.cycles.length,
    segments: 0,
    removedInvalidOrDuplicate: 0,
    addedWakeGaps: 0,
    unexpectedAdded: 0,
    fieldChanges: {},
    catalogChanges: {},
  };
  const change = (target, key) => {
    target[key] = (target[key] ?? 0) + 1;
  };
  for (const c of raw.cycles) {
    const next = after.cycles.find((n) => n.id === c.id);
    if (!next) {
      change(count.fieldChanges, 'cycleMissing');
      continue;
    }
    if (c.session && !next.session) change(count.fieldChanges, 'sessionMissing');
    for (const key of ['id', 'status', 'startedAtMs'])
      if (
        Object.hasOwn(c.session ?? {}, key) &&
        !isDeepStrictEqual(c.session[key], next.session?.[key])
      )
        change(count.fieldChanges, `session.${key}`);
    for (const key of [
      'sleepAtMs',
      'wakeAtMs',
      'timeZone',
      'sleepDurationMs',
      'awakeBudgetMs',
      'targetAtMs',
      'sleepMetrics',
      'screenshotPath',
      'source',
      'closedAtMs',
      'flags',
      'createdAtMs',
      'updatedAtMs',
    ]) {
      if (Object.hasOwn(c, key) && !isDeepStrictEqual(c[key], next[key]))
        change(count.fieldChanges, key);
    }
    const valid = new Map();
    for (const s of c.session?.segments ?? []) {
      count.segments++;
      if (
        !s.id ||
        !Number.isFinite(s.startAtMs) ||
        !(s.endAtMs === 0 || s.endAtMs > s.startAtMs) ||
        valid.has(s.id)
      )
        count.removedInvalidOrDuplicate++;
      else valid.set(s.id, s);
    }
    for (const s of valid.values()) {
      const n = next.session?.segments.find((v) => v.id === s.id);
      if (!n) {
        change(count.fieldChanges, 'segmentMissing');
        continue;
      }
      for (const key of ['startAtMs', 'endAtMs', 'note', 'source', 'category', 'splitFromId']) {
        const expected =
          key === 'category'
            ? (s[key] ?? 'unclassified')
            : key === 'note' && typeof s[key] !== 'string'
              ? ''
              : s[key];
        if (!isDeepStrictEqual(expected, n[key])) change(count.fieldChanges, key);
      }
    }
    for (const n of next.session?.segments ?? [])
      if (!valid.has(n.id)) {
        if (n.id === `${c.id}:wake-gap`) count.addedWakeGaps++;
        else count.unexpectedAdded++;
      }
  }
  for (const c of raw.settings?.categories ?? []) {
    const n = after.settings.categories.find((v) => v.id === c.id);
    if (!n) {
      change(count.catalogChanges, 'missing');
      continue;
    }
    for (const key of ['name', 'archived', 'color', 'parentId'])
      if (!isDeepStrictEqual(c[key], n[key])) change(count.catalogChanges, key);
  }
  if (after.cycles.length !== raw.cycles.length) change(count.fieldChanges, 'cycleCount');
  return count;
}

// Shifting the as-of must be detected through the open segment's dynamic summary,
// not merely the export timestamp. On the real old-worker output a one-hour shift
// grows both awake time and the open segment's category time by exactly one hour,
// and `compare` must record those summary fields as differences.
function openSegmentShift(before, after, diff) {
  const cycles = before.parsed?.cycles ?? [];
  const index = cycles.findIndex((c) => (c.session?.segments ?? []).some((s) => !s.endAtMs));
  if (index < 0) return { found: false, detected: false };
  const cycle = cycles[index];
  const open = cycle.session.segments.find((s) => !s.endAtMs);
  const category = open.category ?? 'unclassified';
  const from = before.summaries[index]?.summary;
  const to = after.summaries[index]?.summary;
  if (!from || !to) return { found: true, detected: false };
  const keys = Object.keys(diff);
  const detected =
    keys.some(
      (k) => k.startsWith('.summaries[].summary.') && k.endsWith('.awakeMs:number/number'),
    ) && keys.some((k) => k.startsWith('.summaries[].summary.categoryMs.'));
  return {
    found: true,
    cycleId: cycle.id,
    category,
    awakeDelta: to.awakeMs - from.awakeMs,
    categoryDelta: (to.categoryMs[category] ?? 0) - (from.categoryMs[category] ?? 0),
    detected,
  };
}

function selfTest() {
  const before = execute('baseline', V3, zones[0], N);
  const same = compare(before, execute('baseline', V3, zones[0], N));
  const results = { oldVsOld: total(same), perturbations: {} };
  const mutations = {
    note: (d) => {
      d.cycles[0].session.segments[0].note += '改变';
    },
    source: (d) => {
      d.cycles[0].session.segments[0].source = 'app';
    },
    endAtMs: (d) => {
      d.cycles[0].session.segments[3].endAtMs += 1;
    },
    category: (d) => {
      d.cycles[0].session.segments[0].category = 'daily';
    },
    parentId: (d) => {
      d.settings.categories.find((c) => c.id === 'cat-study').parentId = 'daily';
    },
    now: () => {},
  };
  let shifted;
  for (const [name, mutate] of Object.entries(mutations)) {
    const d = JSON.parse(V3);
    mutate(d);
    const after = execute(
      'baseline',
      JSON.stringify(d),
      zones[0],
      name === 'now' ? N + 3_600_000 : N,
    );
    const diff = compare(before, after);
    results.perturbations[name] = total(diff);
    if (name === 'now') shifted = { after, diff };
  }
  const open = openSegmentShift(before, shifted.after, shifted.diff);
  results.openSegment = open;
  const passed =
    results.oldVsOld === 0 &&
    Object.values(results.perturbations).every((v) => v > 0) &&
    open.found === true &&
    open.awakeDelta === 3_600_000 &&
    open.categoryDelta === 3_600_000 &&
    open.detected === true;
  console.log(JSON.stringify({ passed, ...results }, null, 2));
  return passed;
}

function syntheticCases() {
  const cases = [1, 2, 3].map((n) => ({ name: `schema-${n}`, text: readFixture(n), now: N }));
  const add = (name, mutate, now = N, onlyZone) => {
    const d = JSON.parse(V3);
    mutate(d);
    cases.push({ name, text: JSON.stringify(d), now, onlyZone });
  };
  add('reverse', (d) => d.cycles.reverse());
  add('empty', (d) => {
    d.cycles = [];
  });
  add('open-nap', (d) => {
    d.cycles[3].session.segments[2].category = 'sleep';
  });
  add('damaged-segments', (d) => {
    const s = d.cycles[0].session.segments;
    s[0].startAtMs += 60_000;
    s.push({ ...s[0], note: '第二份' });
    s.push({ ...s[1], id: 'zero', endAtMs: s[1].startAtMs });
    s.reverse();
  });
  add('overlap', (d) => {
    d.cycles[0].session.segments[2].startAtMs -= 3_600_000;
  });
  add('future-schema', (d) => {
    d.schemaVersion = 99;
  });
  add('duplicate-cycle', (d) => {
    d.cycles.push(d.cycles[0]);
  });
  add('wide-parser', (d) => {
    d.cycles[0].sleepDurationMs = 1;
    d.cycles[0].sleepAtMs = d.cycles[0].wakeAtMs - 1;
  });
  cases.push({ name: 'bad-json', text: '{', now: N });
  // Non-ongoing leap-year comparison and DST trend-window baseline limitations.
  function at(d, date) {
    const c = d.cycles[0],
      wake = Date.parse(date),
      delta = wake - c.wakeAtMs;
    for (const k of [
      'sleepAtMs',
      'wakeAtMs',
      'closedAtMs',
      'targetAtMs',
      'createdAtMs',
      'updatedAtMs',
    ])
      c[k] += delta;
    c.session.startedAtMs += delta;
    for (const s of c.session.segments) {
      s.startAtMs += delta;
      s.endAtMs += delta;
    }
    d.cycles = [c];
  }
  add('leap-year', (d) => at(d, '2024-01-01T07:00:00+08:00'), N, 'Asia/Shanghai');
  add(
    'spring-dst',
    (d) => at(d, '2026-03-08T07:00:00-04:00'),
    Date.parse('2026-03-09T12:00:00-04:00'),
    'America/New_York',
  );
  return cases;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--self-test') return selfTest();
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (
      !['--backup', '--now', '--tz'].includes(argv[i]) ||
      !argv[i + 1] ||
      Object.hasOwn(options, argv[i])
    )
      throw new Error(
        'Invalid option; use --self-test or --backup <absolute path> --now <epochMs> --tz <zone>',
      );
    options[argv[i]] = argv[i + 1];
  }
  const backup = options['--backup'];
  if (!backup && argv.length) throw new Error('Options require explicit --backup');
  let work;
  if (backup) {
    const now = Number(options['--now']),
      zone = options['--tz'];
    if (!isAbsolute(backup) || !Number.isSafeInteger(now) || now <= 0 || !zones.includes(zone))
      throw new Error('Private input requires absolute path, explicit epoch and supported TZ');
    let text;
    try {
      text = readFileSync(backup, 'utf8');
    } catch {
      throw new Error('Private backup unavailable');
    }
    // Require the explicit as-of to be at least as recent as all input time boundaries.
    const raw = JSON.parse(text);
    if (!Array.isArray(raw?.cycles)) throw new Error('Private backup missing cycles');
    for (const c of raw.cycles) {
      const times = [
        c.sleepAtMs,
        c.wakeAtMs,
        c.closedAtMs,
        c.createdAtMs,
        c.updatedAtMs,
        ...(c.session?.segments ?? []).flatMap((s) => [s.startAtMs, s.endAtMs]),
      ];
      if (times.some((t) => typeof t === 'number' && t > now))
        throw new Error('As-of predates record boundaries');
    }
    work = [{ name: 'private', text, now, onlyZone: zone }];
  } else work = syntheticCases();
  let passed = true;
  const results = [];
  for (const item of work)
    for (const zone of item.onlyZone ? [item.onlyZone] : zones.slice(0, 2)) {
      const old = execute('baseline', item.text, zone, item.now),
        candidate = execute('candidate', item.text, zone, item.now);
      const diff = compare(old, candidate);
      const oldPreservation = preservation(item.text, old);
      const preserved = preservation(item.text, candidate);
      const equal = total(diff) === 0;
      const boundaryChecks = candidate.timeChecks;
      const wakeDateOk =
        !boundaryChecks ||
        boundaryChecks.wakeDate === (zone === 'Asia/Shanghai' ? '2026-11-09' : '2026-11-08');
      const restoreInputsUnchanged =
        !boundaryChecks || (boundaryChecks.rawBackupUnchanged && boundaryChecks.localUnchanged);
      const dstObserved =
        item.name !== 'spring-dst' ||
        (boundaryChecks.localDayBefore === Date.parse('2026-03-08T00:00:00-05:00') &&
          boundaryChecks.twoDayTrend.every((v) => v === null));
      // Report only aggregate data. A changed DST behavior is a baseline difference,
      // not an approved correction. Private actual positive records must be retained.
      const preservationOk =
        !backup ||
        (preserved.accepted &&
          preserved.unexpectedAdded === 0 &&
          Object.values(preserved.fieldChanges).every((n) => n === 0) &&
          !preserved.catalogChanges.missing &&
          isDeepStrictEqual(oldPreservation.catalogChanges, preserved.catalogChanges));
      if (!equal || !wakeDateOk || !restoreInputsUnchanged || !dstObserved || !preservationOk)
        passed = false;
      results.push({
        case: item.name,
        timezone: zone,
        nowMs: item.now,
        equal,
        differences: diff,
        oldPreservation,
        preservation: preserved,
        wakeDateOk,
        restoreInputsUnchanged,
        dstObserved,
        preservationOk,
      });
    }
  if (backup) {
    const unchanged = readFileSync(backup, 'utf8') === work[0].text;
    if (!unchanged) passed = false;
    results.push({ privateOriginalUnchanged: unchanged });
  }
  console.log(JSON.stringify({ passed, results }, null, 2));
  return passed;
}
try {
  process.exitCode = main() ? 0 : 1;
} catch (e) {
  // A second read can fail with a private pathname in the native error.
  console.error(
    privateMode
      ? 'Private differential check failed (no input details emitted)'
      : e instanceof Error
        ? e.message
        : 'Differential check failed',
  );
  process.exitCode = 1;
}
