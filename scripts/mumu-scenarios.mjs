// Repeatable navigation and scenario definitions.
//
// A scenario is declarative: observe, tap fresh-tree bounds, snapshot, assert a
// predicate, compare snapshots, or hand off to the agent with a screenshot.
// Complex gesture sequences that cannot be made deterministic (merge slide,
// restore file picker, notification shade internals on some builds) are marked
// `agent` and stop with evidence instead of guessing. Nothing here claims a
// target flow passed until it actually ran against the candidate APK.

import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { MumuGuardError, sleepMs } from './mumu-guard.mjs';
import { narrowMatches } from './mumu-observe.mjs';
import {
  backupFilename,
  comparisonSummary,
  compareRefreshSnapshots,
  compareSnapshots,
  dayFilename,
  readSnapshot,
  validateBackupExport,
  validateJsonExport,
  validatePdfExport,
  validateTxtExport,
} from './mumu-data.mjs';

const scenario = (title, requires, steps) => ({
  title,
  requires,
  steps: steps.map((step, index) => ({ id: `s${index + 1}`, ...step })),
});

function selectorOf(step) {
  if (step.selector) return step.selector;
  const selector = {};
  if (step.text) selector.text = step.text;
  if (step.textContains) selector.textContains = step.textContains;
  if (step.contentDesc) selector.contentDesc = step.contentDesc;
  if (step.contentDescContains) selector.contentDescContains = step.contentDescContains;
  if (step.resourceId) selector.resourceId = step.resourceId;
  if (step.className) selector.className = step.className;
  if (Object.keys(selector).length === 0) {
    throw new MumuGuardError('SCENARIO_SELECTOR', `step ${step.id} has no selector`);
  }
  return selector;
}

function expectArrays(step) {
  return {
    expectText: Array.isArray(step.expectText)
      ? step.expectText
      : step.expectText
        ? [step.expectText]
        : [],
    expectContains: Array.isArray(step.expectContains)
      ? step.expectContains
      : step.expectContains
        ? [step.expectContains]
        : [],
  };
}

function nativeState(snapshot) {
  return snapshot?.native?.state ?? null;
}

function segmentsOf(snapshot) {
  const state = nativeState(snapshot);
  if (state && Array.isArray(state.segments)) return state.segments;
  const cycles = snapshot?.app?.data?.cycles;
  if (!Array.isArray(cycles)) return [];
  const active = cycles.find((cycle) => cycle?.closedAtMs === null && cycle?.session);
  return Array.isArray(active?.session?.segments) ? active.session.segments : [];
}

function closedDuration(segments) {
  return segments
    .filter((segment) => Number(segment?.endAtMs) > Number(segment?.startAtMs))
    .reduce((sum, segment) => sum + (Number(segment.endAtMs) - Number(segment.startAtMs)), 0);
}

function rangeOf(segments) {
  if (segments.length === 0) return null;
  return {
    firstStart: segments[0]?.startAtMs ?? null,
    lastEnd: segments[segments.length - 1]?.endAtMs ?? null,
  };
}

const PREDICATES = {
  'same-native-cycle': ({ snapshot, baseline }) => {
    const before = nativeState(baseline);
    const after = nativeState(snapshot);
    return Boolean(before?.cycleId && before.cycleId === after?.cycleId);
  },
  'native-status': ({ snapshot, value }) => nativeState(snapshot)?.status === value,
  'native-napping': ({ snapshot, value }) => {
    const state = nativeState(snapshot);
    const segments = state?.segments ?? [];
    const last = segments[segments.length - 1];
    const actual = state?.status === 'running' && last?.category === 'sleep' && last?.endAtMs === 0;
    return value === undefined ? actual : actual === value;
  },
  'segments-delta': ({ snapshot, baseline, value }) => {
    if (!baseline) return { ok: false, detail: 'segments-delta needs a baseline snapshot' };
    const delta = segmentsOf(snapshot).length - segmentsOf(baseline).length;
    return { ok: delta === Number(value), detail: `segment delta ${delta}, expected ${value}` };
  },
  'last-open': ({ snapshot }) => {
    const segments = segmentsOf(snapshot);
    const last = segments[segments.length - 1];
    return {
      ok: Boolean(last) && last.endAtMs === 0,
      detail: `last segment endAtMs=${last?.endAtMs}`,
    };
  },
  'split-preserves-range': ({ snapshot, baseline }) => {
    if (!baseline) return { ok: false, detail: 'split check needs a baseline snapshot' };
    const before = rangeOf(segmentsOf(baseline));
    const after = rangeOf(segmentsOf(snapshot));
    const ok =
      before !== null &&
      after !== null &&
      before.firstStart === after.firstStart &&
      before.lastEnd === after.lastEnd;
    return { ok, detail: JSON.stringify({ before, after }) };
  },
  'closed-duration-equal': ({ snapshot, baseline }) => {
    if (!baseline) return { ok: false, detail: 'duration check needs a baseline snapshot' };
    const before = closedDuration(segmentsOf(baseline));
    const after = closedDuration(segmentsOf(snapshot));
    return { ok: before === after, detail: `closed ms ${before} -> ${after}` };
  },
  'notification-pending': ({ snapshot }) => {
    const segments = segmentsOf(snapshot);
    const lastClosed = [...segments].reverse().find((segment) => Number(segment.endAtMs) > 0);
    const ok = lastClosed?.source === 'notification' && !String(lastClosed?.note ?? '').trim();
    return {
      ok,
      detail: `last closed source=${lastClosed?.source}, note=${JSON.stringify(lastClosed?.note)}`,
    };
  },
  'has-cycles': ({ snapshot }) => {
    const count = Array.isArray(snapshot?.app?.data?.cycles) ? snapshot.app.data.cycles.length : 0;
    return { ok: count > 0, detail: `cycles=${count}` };
  },
};

export const SCENARIOS = {
  'start-cycle': scenario(
    'Record main sleep and start the first native cycle',
    'idle, synthetic test data only',
    [
      { action: 'snapshot', label: 'start-before' },
      {
        action: 'agent',
        reason:
          'From the idle Today screen open 录入昨晚的睡眠, choose explicit synthetic wake time/duration, and 保存并开始计时. Read back a new unique cycle ID, sleep/wake/target boundaries, running native session and first open segment; verify app/native mirror.',
      },
    ],
  ),
  'new-cycle': scenario(
    'Start the next cycle and preserve previous history',
    'existing running synthetic cycle',
    [
      { action: 'snapshot', label: 'new-cycle-before' },
      {
        action: 'agent',
        reason:
          'Use 开启第二天 with valid synthetic times. Verify a unique new cycle ID even on the same date, unchanged closed history, previous open tail closed at the new sleep boundary and marked pre-sleep, new running native session, then allocate pre-sleep to a chosen category and verify totals.',
      },
    ],
  ),
  classification: scenario(
    'Category create/rename/color/hierarchy/archive and historic references',
    'synthetic history and category catalog',
    [
      { action: 'snapshot', label: 'classification-before' },
      {
        action: 'agent',
        reason:
          'In 统计 classification management create a distinctive synthetic parent and child, assign to a synthetic segment, rename and change color, collapse/expand children, then archive/delete the used child. Verify stable IDs, retained historical reference/note/time, current catalog and ancestor display after readback.',
      },
    ],
  ),
  statistics: scenario(
    'History and statistics detail with known synthetic totals',
    'known synthetic cycles with classified and sleep segments',
    [
      { action: 'snapshot', label: 'statistics-before' },
      {
        action: 'agent',
        reason:
          'Inspect history week/month and day details, statistics week/month/year, major/fine category drill-down, totals and awake/sleep ratio expansion. Compare displayed values to independent expected totals from the synthetic fixture (same as-of time for open segments); check that UI navigation does not alter records.',
      },
    ],
  ),
  navigation: scenario('App tab navigation with fresh-tree expectations', 'app running', [
    { action: 'observe', name: 'nav-today', requirePackage: true, expectText: ['清醒时光'] },
    { action: 'tap', name: 'nav-history', text: '历史', expectText: ['周趋势'] },
    { action: 'tap', name: 'nav-stats', text: '统计', expectText: ['分类统计'] },
    { action: 'tap', name: 'nav-settings', text: '设置', expectText: ['通知栏计时'] },
    { action: 'tap', name: 'nav-home', text: '今日', expectText: ['清醒时光'] },
    { action: 'snapshot', label: 'navigation-final' },
  ]),

  'lap-note': scenario(
    'Lap: end current segment, open a new one, save category and note',
    'running, not napping',
    [
      { action: 'snapshot', label: 'lap-before' },
      { action: 'assert', predicate: 'native-status', value: 'running', label: 'lap-precondition' },
      { action: 'assert', predicate: 'native-napping', value: false },
      { action: 'tap', name: 'lap-tap', text: '计次', expectText: ['刚结束的这一段'] },
      { action: 'snapshot', label: 'lap-after' },
      { action: 'assert', predicate: 'segments-delta', value: 1, baseline: 'lap-before' },
      { action: 'assert', predicate: 'last-open' },
      {
        action: 'agent',
        reason:
          'Select a synthetic category and enter a distinctive synthetic note; use 保存分类与备注, not 取消. Read back the just-closed segment by ID in both native and app snapshots: exact note/category, unchanged boundaries, one new open segment, and consistent mirror.',
      },
    ],
  ),

  nap: scenario(
    'Nap: start and end a nap, verify native state and open awake segment',
    'running, not napping',
    [
      { action: 'snapshot', label: 'nap-before' },
      { action: 'assert', predicate: 'native-status', value: 'running' },
      { action: 'assert', predicate: 'native-napping', value: false, label: 'nap-precondition' },
      {
        action: 'tap',
        name: 'nap-start',
        text: '开始补觉',
        expectText: ['补觉中 · 秒表暂停', '结束补觉'],
      },
      { action: 'snapshot', label: 'nap-start-snapshot' },
      { action: 'assert', predicate: 'native-napping' },
      { action: 'wait', ms: 1200 },
      { action: 'tap', name: 'nap-end', text: '结束补觉', expectText: ['计次'] },
      { action: 'snapshot', label: 'nap-after' },
      { action: 'assert', predicate: 'native-napping', value: false },
      { action: 'assert', predicate: 'last-open' },
    ],
  ),

  'stop-resume': scenario('End the timer and resume it, preserving the cycle', 'running', [
    { action: 'snapshot', label: 'stop-before' },
    { action: 'assert', predicate: 'native-status', value: 'running' },
    { action: 'assert', predicate: 'native-napping', value: false },
    { action: 'tap', name: 'stop-timer', text: '结束计时', expectText: ['继续计时'] },
    { action: 'snapshot', label: 'stop-after' },
    { action: 'assert', predicate: 'native-status', value: 'ended' },
    { action: 'tap', name: 'resume-timer', text: '继续计时', expectText: ['计次'] },
    { action: 'snapshot', label: 'resume-after' },
    { action: 'assert', predicate: 'native-status', value: 'running' },
    { action: 'assert', predicate: 'same-native-cycle', baseline: 'stop-before' },
    { action: 'assert', predicate: 'last-open' },
  ]),

  restart: scenario(
    'Cold app restart: strict continuity except bounded current-cycle refresh timestamp',
    'running',
    [
      { action: 'snapshot', label: 'restart-before' },
      {
        action: 'assert',
        predicate: 'native-status',
        value: 'running',
        label: 'restart-precondition',
      },
      { action: 'restart' },
      { action: 'wait', ms: 2500 },
      {
        action: 'observe',
        name: 'restart-home',
        requirePackage: true,
        expectContains: ['当前周期进行中'],
      },
      { action: 'snapshot', label: 'restart-after' },
      {
        action: 'compare',
        before: 'restart-before',
        after: 'restart-after',
        requireEqual: true,
        refresh: true,
      },
    ],
  ),

  'background-foreground': scenario(
    'Background and foreground recovery keeps the live timer and persisted state',
    'running',
    [
      { action: 'snapshot', label: 'background-before' },
      {
        action: 'assert',
        predicate: 'native-status',
        value: 'running',
        label: 'background-precondition',
      },
      { action: 'keyevent', key: 'HOME' },
      { action: 'wait', ms: 1200 },
      { action: 'launch' },
      { action: 'wait', ms: 1800 },
      {
        action: 'observe',
        name: 'background-home',
        requirePackage: true,
        expectContains: ['当前周期进行中'],
      },
      { action: 'snapshot', label: 'background-after' },
      {
        action: 'compare',
        before: 'background-before',
        after: 'background-after',
        requireEqual: true,
        refresh: true,
      },
    ],
  ),

  split: scenario('Split a segment with the native splitter controls', 'at least one segment', [
    { action: 'snapshot', label: 'split-before' },
    {
      action: 'reveal',
      name: 'split-open-editor',
      contentDescContains: '编辑第 1 段',
      maxSwipes: 4,
    },
    {
      action: 'tap',
      name: 'split-open-editor-tap',
      contentDescContains: '编辑第 1 段',
      expectText: ['拆分这一段'],
    },
    { action: 'tap', name: 'split-enter', text: '拆分这一段', expectText: ['补分段编辑器'] },
    {
      action: 'tap',
      name: 'split-add-cut',
      textContains: '添加分界点',
      expectText: ['预览拆分结果'],
    },
    { action: 'tap', name: 'split-preview', text: '预览拆分结果', expectText: ['确认拆分并保存'] },
    { action: 'tap', name: 'split-confirm', text: '确认拆分并保存' },
    { action: 'snapshot', label: 'split-after' },
    { action: 'assert', predicate: 'segments-delta', value: 1, baseline: 'split-before' },
    { action: 'assert', predicate: 'split-preserves-range', baseline: 'split-before' },
    {
      action: 'agent',
      reason:
        'Inspect the split readback: original first ID retained, new unique second ID, contiguous internal boundary, exact original outer boundaries and copied note/category/source, unchanged other segments and matching app/native mirror. Verify the actual per-part edit and saved classification/note on a synthetic segment. The scripted count/range check alone is a smoke test, not full split acceptance.',
    },
  ]),

  merge: scenario(
    'Merge adjacent continuous segments (agent-assisted category + slide)',
    'at least two continuous segments',
    [
      { action: 'snapshot', label: 'merge-before' },
      {
        action: 'reveal',
        name: 'merge-open-editor',
        contentDescContains: '编辑第 2 段',
        maxSwipes: 4,
      },
      { action: 'tap', name: 'merge-open-editor-tap', contentDescContains: '编辑第 2 段' },
      { action: 'tap', name: 'merge-choose', text: '合并前一段', expectText: ['直接确认合并'] },
      {
        action: 'agent',
        reason:
          'Choose the required synthetic merge category and use the visible right-slide control (the 直接确认合并 button is a separate accessible path, not evidence of a slide). Record which path was exercised. Read back the retained first ID, removed second ID, exact outer boundaries, merged notes/category, untouched other segments and native mirror; strict equality is not expected after this merge.',
      },
    ],
  ),

  notifications: scenario(
    'Notification lap action, then classify the pending segment in the app',
    'running, not napping, notifications enabled',
    [
      { action: 'snapshot', label: 'notifications-before' },
      { action: 'assert', predicate: 'native-status', value: 'running' },
      { action: 'assert', predicate: 'native-napping', value: false },
      { action: 'expand-notifications' },
      { action: 'wait', ms: 900 },
      {
        action: 'observe',
        name: 'notifications-shade',
        requirePackage: false,
        expectContains: ['计次'],
      },
      {
        action: 'agent',
        reason:
          'Identify the Waketime notification card and its 计次 control in the owned shade; never select an unrelated notification. Return only through the observed owned surface, snapshot and verify +1 segment with notification source and an empty note. Open the pending-note banner and save a synthetic classification/note, then verify the exact persisted segment. Current TimerNotifications exposes 计次 followed by in-app note completion, not direct reply; report that gap rather than claim direct reply passed.',
      },
    ],
  ),

  'backup-export': scenario(
    'Full backup and TXT/PDF/JSON exports produce readable cache files',
    'settings reachable, cycles present',
    [
      { action: 'tap', name: 'export-open-settings', text: '设置', expectText: ['通知栏计时'] },
      { action: 'snapshot', label: 'export-before' },
      { action: 'assert', predicate: 'has-cycles' },
      { action: 'reveal', name: 'export-reveal-backup', text: '全量备份 JSON', maxSwipes: 6 },
      {
        action: 'agent',
        reason:
          'Use 全量备份 JSON and verify its newly generated cache file against the synthetic baseline (cycles and category catalog), then verify the actual backup share chooser and return only from its observed, explicitly authorized system surface. For a known synthetic selected cycle, export TXT, JSON and PDF, verify newly generated readable cache files and actual share UI, and return to Waketime after each. Do not send to another app/account. Record each result separately; backup cache validation alone is not full export/share acceptance.',
      },
    ],
  ),

  restore: scenario(
    'Restore from a synthetic backup fixture (agent-assisted file picker)',
    'synthetic backup file ready outside the repo',
    [
      { action: 'tap', name: 'restore-open-settings', text: '设置', expectText: ['通知栏计时'] },
      { action: 'snapshot', label: 'restore-before' },
      { action: 'reveal', name: 'restore-reveal', text: '从备份恢复', maxSwipes: 6 },
      {
        action: 'agent',
        reason:
          'Save a separate synthetic pre-restore backup before writing. Open 从备份恢复 and identify the authorized file picker. Choose only a validated synthetic fixture, never a real backup. Resolve each category conflict explicitly, exercise 合并恢复 and 覆盖恢复 on separately prepared synthetic baselines, then read back expected cycles/settings: merge adds intended records; overwrite replaces only eligible records; current native cycle and local notification/quick-note settings remain protected. Check cancellation and empty overwrite refusal separately.',
      },
    ],
  ),
};

export function scenarioNames() {
  return Object.keys(SCENARIOS);
}

function describeStep(step) {
  switch (step.action) {
    case 'observe':
      return `observe ${step.name ?? ''}`.trim();
    case 'tap': {
      const target =
        step.text ?? step.contentDesc ?? step.textContains ?? step.contentDescContains ?? '';
      const foreground = Array.isArray(step.allowForeground)
        ? ` (foreground: ${step.allowForeground.join(', ')})`
        : '';
      return `tap ${target}${foreground}`.trim();
    }
    case 'reveal':
      return `scroll until ${step.text ?? step.contentDescContains ?? ''} is visible (max ${step.maxSwipes ?? 4})`;
    case 'snapshot':
      return `snapshot ${step.label}`;
    case 'assert':
      return `assert ${step.predicate}${step.value !== undefined ? ` = ${step.value}` : ''}`;
    case 'compare':
      return `compare ${step.before} vs ${step.after}${step.refresh ? ' (strict evidence + bounded current-cycle refresh timestamp allowance)' : ' (strict)'}`;
    case 'restart':
      return 'force-stop + launch the test app';
    case 'launch':
      return 'launch the test app';
    case 'keyevent':
      return `keyevent ${step.key}`;
    case 'expand-notifications':
      return 'expand the notification shade';
    case 'collapse-notifications':
      return 'collapse the notification shade';
    case 'wait':
      return `wait ${step.ms}ms`;
    case 'check-export':
      return `validate ${step.kind} cache export`;
    case 'agent':
      return `agent hand-off: ${step.reason}`;
    default:
      return step.action;
  }
}

export function planScenario(name) {
  const definition = SCENARIOS[name];
  if (!definition) {
    throw new MumuGuardError(
      'SCENARIO_UNKNOWN',
      `unknown scenario ${name}; choose ${scenarioNames().join(', ')}`,
    );
  }
  return {
    name,
    title: definition.title,
    requires: definition.requires,
    completion: definition.steps.some((step) => step.action === 'agent')
      ? 'agent-required'
      : 'scripted',
    steps: definition.steps.map((step) => ({
      id: step.id,
      action: step.action,
      description: describeStep(step),
      ...(step.action === 'agent' ? { reason: step.reason } : {}),
    })),
  };
}

function requireValue(options, key) {
  const value = options[key];
  if (value === undefined || value === null || value === '') {
    throw new MumuGuardError('SCENARIO_ARG', `scenario run needs --${key} for this step`);
  }
  return value;
}

function assertPredicate(step, state) {
  const snapshot = (step.from ? state.snapshots[step.from] : null) ?? state.lastSnapshot ?? null;
  const baseline = step.baseline ? state.snapshots[step.baseline] : null;
  if (!snapshot) {
    return { ok: false, detail: 'no snapshot available for assertion' };
  }
  if (step.baseline && !baseline) {
    return { ok: false, detail: `baseline snapshot ${step.baseline} is missing` };
  }
  const predicate = PREDICATES[step.predicate];
  if (!predicate) {
    return { ok: false, detail: `unknown predicate ${step.predicate}` };
  }
  const result = predicate({ snapshot, baseline, value: step.value, state });
  if (typeof result === 'boolean')
    return { ok: result, detail: `${step.predicate} returned ${result}` };
  return result;
}

function checkExport(step, state, device, clock) {
  const baseline = step.baseline ? state.snapshots[step.baseline] : state.lastSnapshot;
  const cycles = baseline?.app?.data?.cycles ?? [];
  const cycleId = cycles[0]?.id;
  if (step.kind === 'backup') {
    return validateBackupExport(device, backupFilename(clock()), cycles);
  }
  if (!cycleId) return { ok: false, kind: step.kind, error: 'no cycle id for export filename' };
  if (step.kind === 'txt') return validateTxtExport(device, dayFilename(cycleId, 'txt'), cycleId);
  if (step.kind === 'json')
    return validateJsonExport(device, dayFilename(cycleId, 'json'), cycleId);
  if (step.kind === 'pdf') return validatePdfExport(device, dayFilename(cycleId, 'pdf'));
  return { ok: false, kind: step.kind, error: `unknown export kind ${step.kind}` };
}

/**
 * Execute a scenario. Without `execute: true` this only returns the plan and
 * neither creates a device nor touches the emulator.
 */
export function runScenario(name, context) {
  const definition = SCENARIOS[name];
  if (!definition) {
    throw new MumuGuardError('SCENARIO_UNKNOWN', `unknown scenario ${name}`);
  }
  const plan = planScenario(name);
  if (!context.execute) {
    return { scenario: name, status: 'planned', plan, steps: [] };
  }
  const {
    device,
    observer,
    evidenceDir,
    allowRawData,
    clock = Date.now,
    sleep = sleepMs,
  } = context;
  if (!device || !observer) {
    throw new MumuGuardError('SCENARIO_CONTEXT', 'execute requires device and observer');
  }
  const state = { snapshots: {}, lastSnapshot: null };
  const results = [];
  const startedAtMs = clock();
  let status = 'passed';
  let stopReason = null;

  const record = (step, stepStatus, detail, evidence = null) => {
    results.push({ id: step.id, action: step.action, status: stepStatus, detail, evidence });
  };

  for (const step of definition.steps) {
    if (status !== 'passed') break;
    try {
      // All scripted steps and hand-offs start in the app or a known owned
      // surface. Never recover from another foreground app with global Back.
      if (step.action !== 'wait') device.assertOwnedForeground();
      switch (step.action) {
        case 'observe': {
          const observation = observer.observe({
            name: step.name,
            requirePackage: step.requirePackage,
            ...expectArrays(step),
          });
          if (step.requirePackage !== false && !observation.packagePresent) {
            status = 'blocked';
            stopReason = `${step.id}: package not present in fresh tree`;
            record(step, 'blocked', stopReason, observation.pngPath);
          } else if (
            observation.expectations.missingText.length ||
            observation.expectations.missingContains.length
          ) {
            status = 'blocked';
            stopReason = `${step.id}: missing expected text ${JSON.stringify(observation.expectations)}`;
            record(step, 'blocked', stopReason, observation.pngPath);
          } else {
            record(step, 'ok', `${observation.nodeCount} nodes`, observation.pngPath);
          }
          break;
        }
        case 'tap': {
          const result = observer.tap({
            name: step.name,
            selector: selectorOf(step),
            requirePackage: step.requirePackage,
            allowedForeground: step.allowForeground,
            ...expectArrays(step),
          });
          if (result.status !== 'ok') {
            status = 'blocked';
            stopReason = `${step.id}: ${result.status} — ${result.reason ?? 'see evidence'}`;
            record(step, 'blocked', stopReason, result.screenshot ?? result.after?.pngPath ?? null);
          } else {
            record(
              step,
              'ok',
              `tap ${result.tapped?.x},${result.tapped?.y}`,
              result.after?.pngPath ?? null,
            );
          }
          break;
        }
        case 'reveal': {
          const selector = selectorOf(step);
          const maxSwipes = Math.max(0, Math.min(Number(step.maxSwipes) || 4, 10));
          let observation = observer.observe({
            name: `${step.name}-0`,
            requirePackage: step.requirePackage,
          });
          let matches = observation.treeAvailable ? narrowMatches(observation.nodes, selector) : [];
          let swipes = 0;
          while (matches.length === 0 && swipes < maxSwipes) {
            const scrolled = observer.scroll({
              name: `${step.name}-scroll-${swipes + 1}`,
              direction: step.direction ?? 'up',
              requirePackage: false,
              allowedForeground: step.allowForeground,
            });
            if (scrolled.status !== 'ok') {
              observation = scrolled.before ?? observation;
              break;
            }
            observation = scrolled.after;
            matches = observation.treeAvailable ? narrowMatches(observation.nodes, selector) : [];
            swipes += 1;
          }
          if (matches.length === 1) {
            record(step, 'ok', `visible after ${swipes} swipe(s)`, observation.pngPath);
          } else {
            status = 'blocked';
            stopReason =
              matches.length > 1
                ? `${step.id}: selector matched ${matches.length} elements`
                : `${step.id}: selector not visible after ${maxSwipes} swipes`;
            record(step, 'blocked', stopReason, observation.pngPath);
          }
          break;
        }
        case 'snapshot': {
          const result = readSnapshot(device, {
            evidenceDir,
            label: step.label,
            clock,
            allowRawData,
          });
          state.snapshots[step.label] = result.snapshot;
          state.lastSnapshot = result.snapshot;
          record(step, 'ok', JSON.stringify(result.summary), result.files.primary);
          break;
        }
        case 'assert': {
          const result = assertPredicate(step, state);
          if (!result.ok) {
            status = 'failed';
            stopReason = `${step.id}: ${step.predicate} failed — ${result.detail}`;
            record(step, 'failed', result.detail);
          } else {
            record(step, 'ok', result.detail);
          }
          break;
        }
        case 'compare': {
          const before = state.snapshots[requireValue(step, 'before')];
          const after = state.snapshots[requireValue(step, 'after')];
          if (!before || !after) {
            status = 'failed';
            stopReason = `${step.id}: missing snapshot for compare`;
            record(step, 'failed', stopReason);
            break;
          }
          const comparison = (step.refresh ? compareRefreshSnapshots : compareSnapshots)(
            before,
            after,
            { clock },
          );
          const reportPath = path.join(evidenceDir, `compare-${step.before}-${step.after}.json`);
          const persisted =
            allowRawData === 'synthetic' ? comparison : comparisonSummary(comparison);
          writeFileSync(reportPath, `${JSON.stringify(persisted, null, 2)}\n`);
          if (step.requireEqual !== false && !comparison.equal) {
            status = 'failed';
            stopReason = `${step.id}: snapshots differ (${comparison.diffCount} diffs)`;
            record(step, 'failed', stopReason, reportPath);
          } else {
            record(
              step,
              'ok',
              `equal=${comparison.equal}${comparison.allowance ? `; explicit allowance: ${comparison.allowance.path}` : ''}`,
              reportPath,
            );
          }
          break;
        }
        case 'restart': {
          device.verifyIdentity();
          device.forceStopApp();
          sleep(600);
          device.verifyIdentity();
          device.launchApp();
          record(step, 'ok', 'force-stop + launch');
          break;
        }
        case 'launch': {
          device.verifyIdentity();
          device.launchApp();
          record(step, 'ok', 'launch');
          break;
        }
        case 'keyevent': {
          device.verifyIdentity();
          device.keyevent(String(step.key));
          sleep(400);
          record(step, 'ok', String(step.key));
          break;
        }
        case 'expand-notifications':
        case 'collapse-notifications': {
          device.verifyIdentity();
          device.setNotificationShade(step.action === 'expand-notifications');
          record(step, 'ok', step.action);
          break;
        }
        case 'wait': {
          sleep(Math.min(Number(step.ms) || 0, 10_000));
          record(step, 'ok', `${step.ms}ms`);
          break;
        }
        case 'check-export': {
          const result = checkExport(step, state, device, clock);
          const reportPath = path.join(evidenceDir, `export-${step.kind}-check.json`);
          writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
          if (!result.ok) {
            status = 'failed';
            stopReason = `${step.id}: ${result.error}`;
            record(step, 'failed', result.error, reportPath);
          } else {
            record(
              step,
              'ok',
              JSON.stringify({ file: result.file, bytes: result.bytes }),
              reportPath,
            );
          }
          break;
        }
        case 'agent': {
          const observation = observer.observe({ name: `${step.id}-agent`, requirePackage: false });
          status = 'needs-agent';
          stopReason = step.reason;
          record(step, 'needs-agent', step.reason, observation.pngPath);
          break;
        }
        default:
          throw new MumuGuardError('SCENARIO_ACTION', `unknown scenario action ${step.action}`);
      }
    } catch (error) {
      status = 'failed';
      stopReason = `${step.id}: ${error instanceof Error ? error.message : String(error)}`;
      record(step, 'failed', stopReason);
    }
  }

  const report = {
    schema: 'mumu-e2e-scenario/v1',
    scenario: name,
    title: definition.title,
    status,
    stopReason,
    startedAtMs,
    endedAtMs: clock(),
    identity: typeof device.identity === 'function' ? device.identity() : null,
    steps: results,
    evidenceDir,
    snapshots: Object.fromEntries(
      Object.entries(state.snapshots).map(([label, snapshot]) => [
        label,
        {
          capturedAtMs: snapshot.capturedAtMs,
          cycles: snapshot?.app?.data?.cycles?.length ?? 0,
          nativeStatus: snapshot?.native?.state?.status ?? null,
        },
      ]),
    ),
  };
  const reportPath = path.join(evidenceDir, `scenario-${name}-report.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { scenario: name, status, stopReason, steps: results, report, reportPath };
}
