// Self-test for the MuMu E2E harness.
//
// Everything here runs against an in-process fake adb + MuMuManager runner. It
// never spawns adb, never restarts an adb server, and never touches a real
// emulator. The checks cover identity, explicit -s targeting, command
// allowlisting, fresh-tree taps, visual fallback freshness, persisted-state
// comparison, upgrade ordering, evidence-path policy and scenario planning.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_PACKAGE,
  MumuGuardError,
  createMumuDevice,
  parseMuMuInfo,
  repoRoot,
  resolveEvidenceDir,
  verifyInstanceRecord,
} from './mumu-guard.mjs';
import { createObserver, parseUiTree, pngSize } from './mumu-observe.mjs';
import {
  backupFilename,
  assertRawDataAuthorized,
  compareSnapshots,
  dayFilename,
  loadSnapshotFile,
  parseAaptBadging,
  parseApksignerCerts,
  preflightCandidateApk,
  readSnapshot,
  upgradeAndCompare,
  validateBackupExport,
  validateJsonExport,
  validatePdfExport,
  validateTestDataFile,
  validateTxtExport,
} from './mumu-data.mjs';
import { planScenario, runScenario, scenarioNames } from './mumu-scenarios.mjs';
import { parseArgv } from './mumu-args.mjs';

const APP_PACKAGE = DEFAULT_PACKAGE;

function pngBuffer(width = 1080, height = 1920) {
  const buffer = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function nodeXml(node) {
  const attrs = {
    class: node.className ?? 'android.widget.Button',
    text: node.text ?? '',
    'content-desc': node.contentDesc ?? '',
    clickable: node.clickable === false ? 'false' : 'true',
    enabled: 'true',
    bounds: node.bounds ?? '[0,0][100,100]',
    package: node.package ?? APP_PACKAGE,
  };
  return `<node ${Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ')} />`;
}

function treeXml(nodes) {
  return `<hierarchy rotation="0">${nodes.map(nodeXml).join('')}</hierarchy>`;
}

function ok(text) {
  return { status: 0, stdout: Buffer.from(text), stderr: '' };
}

function fail(text) {
  return { status: 1, stdout: Buffer.alloc(0), stderr: text };
}

const sleep = () => {};

function baseFixture() {
  const startAtMs = 1_795_647_600_000;
  const cycle = {
    id: '2026-11-26',
    timeZone: 'Asia/Shanghai',
    sleepAtMs: 1_795_624_200_000,
    wakeAtMs: startAtMs,
    sleepDurationMs: 23_400_000,
    awakeBudgetMs: 63_000_000,
    targetAtMs: 1_795_710_600_000,
    sleepMetrics: { score: null, reportedTotalMs: null, note: null },
    screenshotPath: null,
    source: 'manual',
    session: {
      id: 'session-1',
      status: 'running',
      startedAtMs: startAtMs,
      segments: [
        {
          id: 'segment-1',
          seq: 1,
          startAtMs,
          endAtMs: 0,
          note: '',
          category: 'unclassified',
          source: 'app',
        },
      ],
    },
    closedAtMs: null,
    flags: [],
    createdAtMs: startAtMs,
    updatedAtMs: startAtMs,
  };
  const appData = {
    schemaVersion: 3,
    appVersion: '0.9.0',
    settings: {
      notificationsEnabled: true,
      quickNotes: ['工作'],
      categories: [
        { id: 'unclassified', name: '未分类', archived: false, color: '#8b94a5', parentId: null },
      ],
    },
    cycles: [cycle],
  };
  const nativeState = {
    cycleId: cycle.id,
    sleepAtMs: cycle.sleepAtMs,
    wakeAtMs: cycle.wakeAtMs,
    targetAtMs: cycle.targetAtMs,
    status: 'running',
    sessionId: cycle.session.id,
    sessionStartedAtMs: cycle.session.startedAtMs,
    sessionStartedMonoMs: 1000,
    bootId: '1',
    notificationsEnabled: true,
    clockAnomaly: false,
    lastWallMs: startAtMs,
    lastMonoMs: 1000,
    segments: [
      {
        id: 'segment-1',
        seq: 1,
        startAtMs,
        startMonoMs: 1000,
        endAtMs: 0,
        endMonoMs: 0,
        note: '',
        category: 'unclassified',
        source: 'app',
      },
    ],
  };
  const nativeXml = `<map><string name="timer_state_v1">${escapeXml(
    JSON.stringify(nativeState),
  )}</string></map>`;
  return {
    cycle,
    appData,
    nativeState,
    files: {
      'files/waketime/data.json': JSON.stringify(appData),
      'shared_prefs/waketime_timer.xml': nativeXml,
    },
  };
}

function createFakeEnvironment() {
  const fixture = baseFixture();
  return {
    managerInstances: {
      1: {
        name: 'Android Device-1',
        adb_host_ip: '127.0.0.1',
        adb_port: 16416,
        player_state: 'start_finished',
      },
      2: {
        name: 'Android Device-2',
        adb_host_ip: '127.0.0.1',
        adb_port: 16417,
        player_state: 'start_finished',
      },
    },
    serial: '127.0.0.1:16416',
    tree: treeXml([
      { text: '清醒时光', bounds: '[0,0][1080,120]', clickable: false },
      { text: '历史', bounds: '[0,1000][1080,1080]' },
      { text: '周趋势', bounds: '[0,200][300,300]' },
      { text: '统计', bounds: '[0,1000][1080,1080]' },
      { text: '分类统计', bounds: '[0,200][300,300]' },
      { text: '设置', bounds: '[0,1000][1080,1080]' },
      { text: '通知栏计时', bounds: '[0,200][300,300]' },
      { text: '今日', bounds: '[0,1000][1080,1080]' },
      { text: '计次', bounds: '[100,200][300,400]' },
      { text: '刚结束的这一段', bounds: '[0,0][500,100]', clickable: false },
      { text: '重复', bounds: '[0,500][100,600]' },
      { text: '重复', bounds: '[0,700][100,800]' },
      { text: '目标', bounds: '[0,0][50,50]', clickable: false },
      { text: '目标', bounds: '[300,300][500,500]' },
    ]),
    dumpExit: 0,
    treeWrites: true,
    foreground: APP_PACKAGE,
    png: pngBuffer(),
    files: { ...fixture.files },
    rawFiles: {},
    remoteTrees: {},
    calls: [],
    inputs: [],
    installs: [],
    am: [],
    cmds: [],
    rms: [],
    fixture,
  };
}

function fakeRunner(state) {
  return (program, args) => {
    const base = path.basename(program).toLowerCase();
    state.calls.push({ base, args: [...args] });
    // The fake uses the same executable path for adb and MuMuManager; the
    // harness invokes the manager as `info -v all`, which adb never receives.
    if (args[0] === 'info' && args[1] === '-v') {
      return ok(JSON.stringify(state.managerInstances));
    }
    if (base.includes('mumumanager')) {
      return fail(`unhandled manager command ${args.join(' ')}`);
    }
    if (args[0] !== '-s' || args[1] !== state.serial) {
      return fail(`expected explicit -s ${state.serial}`);
    }
    const command = args.slice(2);
    if (command[0] === 'get-state') return ok('device\n');
    if (command[0] === 'shell') {
      const sh = command.slice(1);
      if (sh[0] === 'getprop') return ok('35\n');
      if (sh[0] === 'dumpsys' && sh[1] === 'window') {
        if (state.foreground === null)
          return ok(
            `mCurrentFocus=null\nmFocusedApp=ActivityRecord{abc u0 ${APP_PACKAGE}/.MainActivity}`,
          );
        const focused = state.foreground ?? APP_PACKAGE;
        return ok(`mCurrentFocus=Window{abc u0 ${focused}/${focused}.MainActivity}`);
      }
      if (sh[0] === 'dumpsys' && sh[1] === 'package') {
        return ok(`Package [${APP_PACKAGE}] (hash)\n  versionCode=12 versionName=0.9.0`);
      }
      if (sh[0] === 'uiautomator') {
        const remote = sh[3];
        if (state.treeWrites && state.tree !== null) state.remoteTrees[remote] = state.tree;
        return { status: state.dumpExit, stdout: Buffer.from('UI hierarchy dumped'), stderr: '' };
      }
      if (sh[0] === 'run-as') {
        const relative = sh[3];
        if (sh[2] === 'ls') {
          return ok(
            `${Object.keys(state.files)
              .filter((name) => name.startsWith('cache/exports/'))
              .map((name) => path.posix.basename(name))
              .join('\n')}\n`,
          );
        }
        if (sh[2] === 'cat') {
          if (Object.prototype.hasOwnProperty.call(state.files, relative)) {
            return ok(state.files[relative]);
          }
          return fail(`cat: ${relative}: No such file`);
        }
      }
      if (sh[0] === 'input') {
        state.inputs.push(sh.slice(1));
        if (sh[1] === 'keyevent' && sh[2] === 'HOME') {
          state.foreground = state.transitionTarget ?? 'com.android.launcher3';
        }
        return ok('');
      }
      if (sh[0] === 'am') {
        state.am.push(sh.slice(1));
        if (sh[1] === 'force-stop')
          state.foreground = state.transitionTarget ?? 'com.android.launcher3';
        if (sh[1] === 'start') {
          state.foreground = APP_PACKAGE;
          state.onLaunch?.();
        }
        return ok('');
      }
      if (sh[0] === 'cmd') {
        state.cmds.push(sh.slice(1));
        state.foreground = sh[2] === 'expand-notifications' ? 'com.android.systemui' : APP_PACKAGE;
        return ok('');
      }
      if (sh[0] === 'rm') {
        state.rms.push(sh.slice(1));
        return ok('');
      }
      return fail(`unhandled shell ${sh.join(' ')}`);
    }
    if (command[0] === 'exec-out') {
      const out = command.slice(1);
      if (out[0] === 'screencap') return { status: 0, stdout: state.png, stderr: '' };
      if (out[0] === 'cat') {
        const remote = out[1];
        return state.remoteTrees[remote] ? ok(state.remoteTrees[remote]) : fail('no fresh tree');
      }
      if (out[0] === 'run-as') {
        const relative = out[3];
        if (Object.prototype.hasOwnProperty.call(state.rawFiles, relative)) {
          return { status: 0, stdout: state.rawFiles[relative], stderr: '' };
        }
        return fail('missing raw file');
      }
    }
    if (command[0] === 'install') {
      state.installs.push([...command]);
      state.foreground = 'com.android.launcher3';
      state.onInstall?.();
      return ok('Success\n');
    }
    if (command[0] === 'logcat') return ok('logcat line\n');
    return fail(`unhandled adb ${command.join(' ')}`);
  };
}

function fakeDevice(state, evidenceDir) {
  return createMumuDevice({
    adbPath: process.execPath,
    managerPath: process.execPath,
    instance: 1,
    serial: state.serial,
    evidenceDir,
    runner: fakeRunner(state),
    sleep,
  });
}

function check(condition, message) {
  assert.ok(condition, message);
}

export async function runSelfTest(options = {}) {
  const checks = [];
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'waketime-mumu-selftest-'));
  const evidenceDir = resolveEvidenceDir({
    dir: path.join(repoRoot, 'test-results', 'mumu-e2e', `selftest-${process.pid}-${Date.now()}`),
  });
  const record = (name) => {
    checks.push(name);
    if (options.verbose) process.stdout.write(`  ok ${name}\n`);
  };

  try {
    // 1. Identity parsing and exact serial mapping.
    const state = createFakeEnvironment();
    const instances = parseMuMuInfo(JSON.stringify(state.managerInstances));
    const record1 = verifyInstanceRecord(instances, { instance: 1, serial: state.serial });
    assert.equal(record1.instance, 1);
    assert.throws(
      () => verifyInstanceRecord(instances, { instance: 1, serial: '127.0.0.1:16417' }),
      (error) => error instanceof MumuGuardError && error.code === 'INSTANCE_SERIAL',
    );
    const paused = structuredClone(state.managerInstances);
    paused[1].player_state = 'starting';
    assert.throws(
      () => verifyInstanceRecord(paused, { instance: 1, serial: state.serial }),
      (error) => error.code === 'INSTANCE_NOT_READY',
    );
    assert.throws(
      () =>
        verifyInstanceRecord(instances, {
          instance: 1,
          serial: state.serial,
          instanceName: 'Other',
        }),
      (error) => error.code === 'INSTANCE_NAME',
    );
    record('identity mapping rejects wrong serial/state/name');

    // 2. Every adb call carries exactly the verified serial, and dangerous
    //    commands are rejected before the runner sees them.
    const device = fakeDevice(state, evidenceDir);
    const identity = device.verifyIdentity();
    assert.equal(identity.serial, state.serial);
    const adbCalls = state.calls.filter((call) => call.args[0] === '-s');
    check(adbCalls.length >= 2, 'identity made adb calls');
    for (const call of adbCalls) {
      assert.equal(call.args[0], '-s');
      assert.equal(call.args[1], state.serial);
    }
    for (const unsafe of [
      ['kill-server'],
      ['start-server'],
      ['pm', 'clear', APP_PACKAGE],
      ['rm', '-rf', '/data'],
      ['uiautomator', 'dump', '--compressed', '/sdcard/other.xml'],
      ['am', 'force-stop', 'other.package'],
    ]) {
      assert.throws(
        () => device.shell(unsafe),
        (error) => error instanceof MumuGuardError && error.code === 'UNSAFE_SHELL',
      );
    }
    assert.throws(
      () => device.shell(['input', 'tap', '1', '2', '3']),
      (error) => error.code === 'UNSAFE_SHELL',
    );
    assert.throws(
      () => device.shell(['run-as', APP_PACKAGE, 'cat', '../shared_prefs/x.xml']),
      (error) => error.code === 'UNSAFE_SHELL',
    );
    assert.throws(
      () => device.execOut(['run-as', APP_PACKAGE, 'cat', 'cache/exports/../../x']),
      (error) => error.code === 'UNSAFE_ADB',
    );
    record('explicit -s and shell allowlist');

    // Fixture staging must be confined to a fresh synthetic downloads filename,
    // with explicit synthetic opt-in and app foreground. No arbitrary push path.
    const fixtureEnv = createFakeEnvironment();
    const fixtureDevice = createMumuDevice({
      adbPath: process.execPath,
      managerPath: process.execPath,
      instance: 1,
      serial: fixtureEnv.serial,
      evidenceDir,
      runner: (program, args, options) => {
        if (args[2] === 'push') {
          fixtureEnv.calls.push({ args });
          return ok('1 file pushed');
        }
        return fakeRunner(fixtureEnv)(program, args, options);
      },
      sleep,
    });
    const stageFile = path.join(evidenceDir, 'e2e-restore-test.json');
    writeFileSync(
      stageFile,
      JSON.stringify({ schemaVersion: 3, cycles: [], settings: { categories: [] } }),
    );
    assert.throws(
      () => fixtureDevice.stageSyntheticFixture(stageFile),
      (e) => e.code === 'FIXTURE_OPT_IN',
    );
    const staged = fixtureDevice.stageSyntheticFixture(stageFile, 'synthetic');
    assert.match(staged, /^\/sdcard\/Download\/waketime-e2e-[a-f0-9-]+\.json$/);
    assert.deepEqual(fixtureEnv.calls.find((x) => x.args[2] === 'push').args, [
      '-s',
      fixtureEnv.serial,
      'push',
      stageFile,
      staged,
    ]);
    assert.throws(
      () => fixtureDevice.stageSyntheticFixture(path.join(tempRoot, 'other.json'), 'synthetic'),
      (e) => e.code === 'FIXTURE_PATH',
    );
    fixtureEnv.foreground = null;
    assert.throws(
      () => fixtureDevice.stageSyntheticFixture(stageFile, 'synthetic'),
      (e) => e.code === 'APP_NOT_FOREGROUND',
    );
    assert.equal(fixtureEnv.calls.filter((x) => x.args[2] === 'push').length, 1);
    record('synthetic fixture staging confined to evidence and guarded Downloads');

    // Typed synthetic names and durations must reach only the foreground test app.
    const typed = createFakeEnvironment();
    const typingDevice = fakeDevice(typed, evidenceDir);
    typingDevice.shell(['input', 'text', '15']);
    typingDevice.shell(['input', 'text', 'E2EChild']);
    typingDevice.keyevent('KEYCODE_MOVE_END');
    typingDevice.keyevent('KEYCODE_DEL');
    assert.deepEqual(typed.inputs, [
      ['text', '15'],
      ['text', 'E2EChild'],
      ['keyevent', 'KEYCODE_MOVE_END'],
      ['keyevent', 'KEYCODE_DEL'],
    ]);
    assert.throws(
      () => typingDevice.shell(['input', 'text', 'x;rm']),
      (e) => e.code === 'UNSAFE_ARG',
    );
    typed.foreground = 'com.other.app';
    assert.throws(
      () => typingDevice.shell(['input', 'text', '15']),
      (e) => e.code === 'APP_NOT_FOREGROUND',
    );
    assert.equal(typed.inputs.length, 4);
    record('narrow synthetic text and editing keys require foreground ownership');

    // 3. Fresh tree + screenshot observation, including exit-139 with a valid tree.
    const observer = createObserver(device, { evidenceDir, sleep });
    const home = observer.observe({ name: 'selftest-home' });
    assert.equal(home.treeAvailable, true);
    assert.equal(home.packagePresent, true);
    assert.equal(home.width, 1080);
    assert.equal(home.height, 1920);
    assert.ok(existsSync(home.pngPath));
    assert.ok(existsSync(home.xmlPath));
    assert.equal(pngSize(readFileSync(home.pngPath)).height, 1920);
    assert.ok(state.rms.length >= 2, 'harness dump removed before and after');
    state.dumpExit = 139;
    const exit139 = observer.observe({ name: 'selftest-exit139' });
    assert.equal(exit139.treeAvailable, true);
    assert.match(exit139.warnings.join(' '), /exit/);
    state.dumpExit = 0;
    record('fresh tree/screenshot and exit-139 tolerance');

    // 4. Tap uses fresh bounds, refuses ambiguity, never retries an unverified tap.
    state.inputs.length = 0;
    const tapped = observer.tap({
      name: 'selftest-tap',
      selector: { text: '计次' },
      expectText: ['今日'],
    });
    assert.equal(tapped.status, 'ok');
    assert.deepEqual(state.inputs.at(-1), ['tap', '200', '300']);
    const ambiguous = observer.tap({ name: 'selftest-ambiguous', selector: { text: '重复' } });
    assert.equal(ambiguous.status, 'needs-agent-visual');
    assert.equal(state.inputs.length, 1, 'ambiguous tap must not input');
    const narrowed = observer.tap({
      name: 'selftest-narrow',
      selector: { text: '目标' },
      expectText: ['今日'],
    });
    assert.equal(narrowed.status, 'ok');
    assert.deepEqual(state.inputs.at(-1), ['tap', '400', '400']);
    const unverified = observer.tap({
      name: 'selftest-unverified',
      selector: { text: '计次' },
      expectText: ['不存在的文本'],
    });
    assert.equal(unverified.status, 'unverified');
    assert.equal(state.inputs.length, 3, 'unverified tap was issued exactly once more');
    state.tree = 'not xml';
    state.treeWrites = true;
    const noTree = observer.tap({ name: 'selftest-no-tree', selector: { text: '计次' } });
    assert.equal(noTree.status, 'needs-agent-visual');
    assert.equal(state.inputs.length, 3, 'no tap without a fresh tree');
    state.tree = treeXml([{ text: '计次', bounds: '[100,200][300,400]' }]);
    record('fresh-bounds tap, ambiguity and no-blind-retry');

    // 4b. Input is gated on the intended foreground package. A system surface
    //     must be named explicitly; an unknown foreground refuses input.
    state.foreground = 'com.android.systemui';
    const foregroundCount = state.inputs.length;
    const blockedForeground = observer.tap({
      name: 'selftest-foreground-block',
      selector: { text: '计次' },
    });
    assert.equal(blockedForeground.status, 'needs-agent-visual');
    assert.match(blockedForeground.reason, /com\.android\.systemui/);
    assert.equal(state.inputs.length, foregroundCount, 'foreground mismatch must not issue input');
    const allowedForegroundTap = observer.tap({
      name: 'selftest-foreground-allow',
      selector: { text: '计次' },
      allowedForeground: ['com.android.systemui'],
    });
    assert.equal(allowedForegroundTap.status, 'ok');
    assert.equal(allowedForegroundTap.foreground, 'com.android.systemui');
    state.foreground = null;
    const unknownForeground = observer.tap({
      name: 'selftest-foreground-unknown',
      selector: { text: '计次' },
    });
    assert.equal(unknownForeground.status, 'needs-agent-visual');
    assert.match(unknownForeground.reason, /unknown/);
    state.foreground = APP_PACKAGE;
    record('foreground gate: default app, explicit system package, unknown blocked');

    // Lifecycle commands must fail closed before sending any mutation.
    for (const action of [
      (d) => d.keyevent('BACK'),
      (d) => d.keyevent('HOME'),
      (d) => d.launchApp(),
      (d) => d.forceStopApp(),
      (d) => d.setNotificationShade(true),
      (d) => d.setNotificationShade(false),
    ]) {
      for (const foreground of [
        'com.other.app',
        null,
        'com.android.launcher3',
        'app.lawnchair',
        'com.android.systemui',
      ]) {
        const env = createFakeEnvironment();
        env.foreground = foreground;
        const guarded = fakeDevice(env, evidenceDir);
        assert.throws(
          () => action(guarded),
          (error) => error.code === 'APP_NOT_FOREGROUND',
        );
        assert.deepEqual([env.inputs.length, env.am.length, env.cmds.length], [0, 0, 0]);
      }
    }
    const transition = createFakeEnvironment();
    transition.transitionTarget = 'app.lawnchair';
    const owned = fakeDevice(transition, evidenceDir);
    owned.keyevent('HOME');
    owned.launchApp();
    owned.forceStopApp();
    owned.launchApp();
    owned.setNotificationShade(true);
    owned.setNotificationShade(false);
    assert.equal(transition.foreground, APP_PACKAGE);
    assert.equal(transition.inputs.length, 1);
    assert.equal(transition.am.length, 3);
    assert.equal(transition.cmds.length, 2);
    owned.setNotificationShade(true);
    transition.foreground = 'com.other.app';
    assert.throws(
      () => owned.setNotificationShade(false),
      (error) => error.code === 'APP_NOT_FOREGROUND',
    );
    assert.equal(transition.cmds.length, 3);
    transition.foreground = APP_PACKAGE;
    assert.throws(
      () => owned.launchApp(),
      (error) => error.code === 'APP_NOT_FOREGROUND',
    );
    assert.equal(transition.am.length, 3);
    for (const action of [(d) => d.keyevent('HOME'), (d) => d.forceStopApp()]) {
      const env = createFakeEnvironment();
      env.transitionTarget = 'com.other.app';
      const guarded = fakeDevice(env, evidenceDir);
      assert.throws(
        () => action(guarded),
        (error) => error.code === 'APP_NOT_FOREGROUND',
      );
      const count = env.am.length;
      assert.throws(
        () => guarded.launchApp(),
        (error) => error.code === 'APP_NOT_FOREGROUND',
      );
      assert.equal(env.am.length, count, 'unexpected successor must not be replaced by launch');
    }
    for (const argv of [
      ['input', 'keyevent', 'BACK'],
      ['am', 'start', '-n', `${APP_PACKAGE}/.MainActivity`],
      ['am', 'force-stop', APP_PACKAGE],
      ['cmd', 'statusbar', 'expand-notifications'],
    ]) {
      assert.throws(
        () => device.shell(argv),
        (error) => error.code === 'GUARDED_ACTION',
      );
    }
    record(
      'lifecycle actions reject unrelated, unknown and unowned surfaces; owned transitions only',
    );

    // 5. Visual fallback only from the latest screenshot, within age and bounds.
    const visualSource = observer.observe({ name: 'selftest-visual-source' });
    const visual = observer.tapVisual({
      name: 'selftest-visual',
      x: 10,
      y: 10,
      fromShot: visualSource.pngPath,
      maxShotAgeMs: 15_000,
    });
    assert.equal(visual.status, 'applied');
    assert.deepEqual(state.inputs.at(-1), ['tap', '10', '10']);
    assert.throws(
      () => observer.tapVisual({ x: 99_999, y: 10, fromShot: visual.after.pngPath }),
      (error) => error.code === 'VISUAL_COORDS',
    );
    const visualUnverified = observer.tapVisual({
      x: 10,
      y: 10,
      fromShot: visual.after.pngPath,
      expectText: ['不存在的文本'],
    });
    assert.equal(visualUnverified.status, 'unverified');
    assert.throws(
      () => observer.tapVisual({ x: 10, y: 10, fromShot: home.pngPath }),
      (error) => error.code === 'VISUAL_STALE',
    );
    const aged = observer.observe({ name: 'selftest-visual-aged' });
    const old = new Date(Date.now() - 120_000);
    utimesSync(aged.pngPath, old, old);
    assert.throws(
      () => observer.tapVisual({ x: 10, y: 10, fromShot: aged.pngPath }),
      (error) => error.code === 'VISUAL_STALE',
    );
    const visualAppSource = observer.observe({ name: 'selftest-visual-app' });
    state.foreground = 'com.android.documentsui';
    const visualForegroundCount = state.inputs.length;
    const visualBlocked = observer.tapVisual({
      name: 'selftest-visual-foreground-block',
      x: 10,
      y: 10,
      fromShot: visualAppSource.pngPath,
    });
    assert.equal(visualBlocked.status, 'needs-agent-visual');
    assert.match(visualBlocked.reason, /com\.android\.documentsui/);
    assert.equal(
      state.inputs.length,
      visualForegroundCount,
      'visual foreground mismatch must not issue input',
    );
    const visualSystemSource = observer.observe({ name: 'selftest-visual-system' });
    const visualAllowed = observer.tapVisual({
      name: 'selftest-visual-foreground-allow',
      x: 10,
      y: 10,
      fromShot: visualSystemSource.pngPath,
      allowedForeground: ['com.android.documentsui'],
    });
    assert.equal(visualAllowed.status, 'applied');
    assert.equal(visualAllowed.foreground, 'com.android.documentsui');
    state.foreground = APP_PACKAGE;
    record('visual fallback provenance/age/bounds/foreground');

    // 6. Full persisted snapshot + strict comparison and mirror check.
    state.treeWrites = true;
    state.tree = treeXml([{ text: '计次', bounds: '[100,200][300,400]' }]);
    const before = readSnapshot(device, { evidenceDir, label: 'selftest-before' });
    assert.equal(before.summary.cycles, 1);
    assert.equal(before.summary.nativeStatus, 'running');
    const equal = compareSnapshots(before.snapshot, before.snapshot);
    assert.equal(equal.equal, true);
    assert.equal(equal.mirrorConsistent, true);
    const mutatedApp = structuredClone(state.fixture.appData);
    mutatedApp.cycles[0].session.segments[0].note = 'changed';
    state.files['files/waketime/data.json'] = JSON.stringify(mutatedApp);
    const mutatedNative = structuredClone(state.fixture.nativeState);
    mutatedNative.segments[0].endAtMs = 123;
    state.files['shared_prefs/waketime_timer.xml'] =
      `<map><string name="timer_state_v1">${escapeXml(
        JSON.stringify(mutatedNative),
      )}</string></map>`;
    const after = readSnapshot(device, { evidenceDir, label: 'selftest-after' });
    const different = compareSnapshots(before.snapshot, after.snapshot);
    assert.equal(different.equal, false);
    assert.equal(different.appDataEqual, false);
    assert.equal(different.nativeSessionEqual, false);
    assert.ok(
      different.diffs.some((diff) => diff.path.includes('note')),
      'note diff is reported',
    );
    assert.ok(
      different.diffs.some((diff) => diff.path.includes('endAtMs')),
      'native endAtMs diff is reported',
    );
    assert.ok(
      different.diffs.some((diff) => diff.kind === 'mirror'),
      'native/app mirror mismatch is reported',
    );
    record('strict snapshot compare covers app data, native session and mirror');

    // 6b. Default snapshots keep raw data in memory and write summaries only;
    //     raw files require the explicit "synthetic" authorization token.
    const summarySnapshot = readSnapshot(device, { evidenceDir, label: 'selftest-summary' });
    assert.equal(summarySnapshot.rawAllowed, false);
    assert.ok(existsSync(summarySnapshot.files.summary));
    assert.equal(summarySnapshot.files.snapshot, undefined);
    assert.ok(!existsSync(path.join(evidenceDir, 'selftest-summary-data.json')));
    assert.ok(!existsSync(path.join(evidenceDir, 'selftest-summary-native.xml')));
    const summaryJson = JSON.parse(readFileSync(summarySnapshot.files.summary, 'utf8'));
    assert.equal(summaryJson.schema, 'mumu-e2e-snapshot-summary/v1');
    assert.equal(summaryJson.summary.cycles, 1);
    assert.equal(summaryJson.app, undefined);
    assert.equal(summaryJson.native, undefined);
    assert.throws(
      () => loadSnapshotFile(summarySnapshot.files.summary),
      (error) => error.code === 'SNAPSHOT_SUMMARY',
    );
    assert.throws(
      () => assertRawDataAuthorized(true),
      (error) => error.code === 'RAW_DATA_UNAUTHORIZED',
    );
    assert.throws(
      () =>
        readSnapshot(device, {
          evidenceDir,
          label: 'selftest-raw-bad',
          allowRawData: 'yes',
        }),
      (error) => error.code === 'RAW_DATA_UNAUTHORIZED',
    );
    const rawSnapshot = readSnapshot(device, {
      evidenceDir,
      label: 'selftest-raw',
      allowRawData: 'synthetic',
    });
    assert.equal(rawSnapshot.rawAllowed, true);
    assert.ok(existsSync(rawSnapshot.files.snapshot));
    assert.ok(existsSync(rawSnapshot.files.appData));
    assert.ok(existsSync(rawSnapshot.files.nativeXml));
    assert.equal(loadSnapshotFile(rawSnapshot.files.snapshot).app.data.cycles.length, 1);
    record('summary-only default snapshot; raw requires synthetic token');

    // 7. Upgrade order: snapshot -> install -r -> snapshot -> compare; no uninstall.
    state.files['files/waketime/data.json'] = JSON.stringify(state.fixture.appData);
    state.files['shared_prefs/waketime_timer.xml'] =
      `<map><string name="timer_state_v1">${escapeXml(
        JSON.stringify(state.fixture.nativeState),
      )}</string></map>`;
    const apkPath = path.join(tempRoot, 'candidate.apk');
    writeFileSync(apkPath, 'synthetic apk placeholder');
    const upgrade = upgradeAndCompare(device, { apkPath, evidenceDir, launch: false });
    assert.equal(upgrade.report.equal, true);
    assert.equal(upgrade.report.comparison.appDataEqual, true);
    assert.equal(upgrade.report.comparison.nativeSessionEqual, true);
    assert.equal(state.installs.length, 1);
    assert.deepEqual(state.installs[0], ['install', '-r', apkPath]);
    assert.ok(!state.calls.some((call) => call.args.includes('uninstall')), 'no uninstall');
    assert.ok(existsSync(upgrade.reportPath));
    assert.equal(upgrade.report.rawData, false);
    assert.equal('diffs' in upgrade.report.comparison, false, 'default report omits diff values');
    assert.equal(upgrade.report.comparison.diffsOmitted, true);
    assert.throws(
      () => upgradeAndCompare(device, { apkPath: path.join(tempRoot, 'missing.apk'), evidenceDir }),
      (error) => error.code === 'PATH_MISSING',
    );
    state.foreground = APP_PACKAGE;
    const upgradeRaw = upgradeAndCompare(device, {
      apkPath,
      evidenceDir,
      launch: false,
      allowRawData: 'synthetic',
      preflight: { packageName: APP_PACKAGE },
    });
    assert.equal(upgradeRaw.report.rawData, true);
    assert.ok(Array.isArray(upgradeRaw.report.comparison.diffs));
    assert.equal(upgradeRaw.report.preflight.packageName, APP_PACKAGE);
    record('upgrade install -r ordering, report redaction and no uninstall');

    // Launch/refresh must allow only a timestamp on the exact current cycle.
    // Use real readSnapshot/upgradeAndCompare/runScenario with an injectable runner.
    const refreshTime = state.fixture.cycle.updatedAtMs + 10_000;
    const cases = [
      [
        'timestamp',
        (app) => {
          app.cycles[0].updatedAtMs = refreshTime + 100;
        },
        true,
      ],
      [
        'note',
        (app) => {
          app.cycles[0].session.segments[0].note = 'changed';
        },
        false,
      ],
      [
        'settings',
        (app) => {
          app.settings.quickNotes.push('changed');
        },
        false,
      ],
      [
        'past-cycle',
        (app) => {
          app.cycles[1].updatedAtMs = refreshTime + 100;
        },
        false,
      ],
      [
        'timestamp-plus-note',
        (app) => {
          app.cycles[0].updatedAtMs = refreshTime + 100;
          app.cycles[0].session.segments[0].note = 'changed';
        },
        false,
      ],
      [
        'timestamp-plus-old-cycle',
        (app) => {
          app.cycles[0].updatedAtMs = refreshTime + 100;
          app.cycles[1].updatedAtMs = refreshTime + 100;
        },
        false,
      ],
      [
        'timestamp-plus-native',
        (app, native) => {
          app.cycles[0].updatedAtMs = refreshTime + 100;
          native.lastMonoMs += 1;
        },
        false,
      ],
      [
        'native',
        (_app, native) => {
          native.lastMonoMs += 1;
        },
        false,
      ],
      [
        'future-timestamp',
        (app) => {
          app.cycles[0].updatedAtMs = refreshTime + 10_000;
        },
        false,
      ],
      [
        'backdated-timestamp',
        (app) => {
          app.cycles[0].updatedAtMs -= 1;
        },
        false,
      ],
    ];
    function refreshEnvironment(mutate) {
      const env = createFakeEnvironment();
      const app = structuredClone(env.fixture.appData);
      app.cycles.push({
        ...structuredClone(app.cycles[0]),
        id: 'old-cycle',
        closedAtMs: refreshTime - 1,
      });
      const native = structuredClone(env.fixture.nativeState);
      env.files['files/waketime/data.json'] = JSON.stringify(app);
      let time = refreshTime;
      const clock = () => time;
      env.onLaunch = () => {
        mutate(app, native);
        time += 200;
        env.files['files/waketime/data.json'] = JSON.stringify(app);
        env.files['shared_prefs/waketime_timer.xml'] =
          `<map><string name="timer_state_v1">${escapeXml(JSON.stringify(native))}</string></map>`;
      };
      env.tree = treeXml([{ text: '当前周期进行中' }]);
      return { env, clock };
    }
    for (const [label, mutate, expected] of cases) {
      const { env, clock } = refreshEnvironment(mutate);
      const handle = fakeDevice(env, evidenceDir);
      const run = upgradeAndCompare(handle, {
        apkPath,
        evidenceDir,
        clock,
        sleep,
        launch: true,
        allowRawData: 'synthetic',
      });
      assert.equal(run.comparison.equal, true, `${label}: install strict`);
      assert.equal(run.report.equal, expected, label);
      assert.equal(run.launchedComparison.strictEqual, false, label);
      assert.equal(Boolean(run.launchedComparison.allowance), expected, label);
      assert.ok(run.report.launchedComparison.strictComparison.diffs.length, label);
      if (expected) {
        assert.equal(run.launchedComparison.allowance.path, '$.appData.cycles[0].updatedAtMs');
        assert.deepEqual(run.launchedComparison.allowance.captureWindowMs, [
          refreshTime,
          refreshTime + 200,
        ]);
      }
    }
    const installMutation = refreshEnvironment(cases[0][1]);
    installMutation.env.onInstall = installMutation.env.onLaunch;
    const strictInstall = upgradeAndCompare(fakeDevice(installMutation.env, evidenceDir), {
      apkPath,
      evidenceDir,
      clock: installMutation.clock,
      sleep,
      launch: true,
    });
    assert.equal(strictInstall.report.equal, false);
    assert.equal(strictInstall.launchedComparison, null, 'do not launch after install mismatch');
    assert.equal(installMutation.env.am.length, 0);
    for (const name of ['restart', 'background-foreground']) {
      for (const [label, mutate, expected] of cases) {
        const { env, clock } = refreshEnvironment(mutate);
        const handle = fakeDevice(env, evidenceDir);
        const run = runScenario(name, {
          device: handle,
          observer: createObserver(handle, { evidenceDir, sleep }),
          evidenceDir,
          clock,
          sleep,
          execute: true,
        });
        assert.equal(
          run.status,
          expected ? 'passed' : 'failed',
          `${name}/${label}: ${run.stopReason}`,
        );
        const report = JSON.parse(readFileSync(run.steps.at(-1).evidence, 'utf8'));
        assert.equal(report.strictEqual, false);
        assert.equal(Boolean(report.allowance), expected);
        assert.equal(
          'diffs' in report.strictComparison,
          false,
          'default refresh report remains redacted',
        );
      }
    }
    record('strict install and bounded refresh comparison through fake launch/restart/foreground');

    // 7a. Upgrade preflight: explicit aapt/apksigner paths, package match and
    //     signing-cert identity against a baseline APK or expected digest.
    const badgingText = `package: name='${APP_PACKAGE}' versionCode='13' versionName='0.9.1'`;
    const candidateCert = '11'.repeat(32);
    const otherCert = '22'.repeat(32);
    const preflightApk = path.join(tempRoot, 'candidate-preflight.apk');
    const baselineApk = path.join(tempRoot, 'baseline-preflight.apk');
    writeFileSync(preflightApk, 'candidate');
    writeFileSync(baselineApk, 'baseline');
    const toolRunner = (options = {}) => {
      const {
        badging = badgingText,
        candidate = candidateCert,
        baseline = candidateCert,
      } = options;
      return (program, args) => {
        if (args[0] === 'dump' && args[1] === 'badging') return ok(badging);
        if (args[0] === 'verify' && args[1] === '--print-certs') {
          const apk = args[2];
          const digest = apk === baselineApk ? baseline : candidate;
          return ok(
            `Signer #1 certificate DN: CN=synthetic\n` +
              `Signer #1 certificate SHA-256 digest: ${digest}\n`,
          );
        }
        return fail(`unexpected tool ${program} ${args.join(' ')}`);
      };
    };
    const preflightBase = {
      apkPath: preflightApk,
      packageName: APP_PACKAGE,
      aaptPath: process.execPath,
      apksignerPath: process.execPath,
    };
    const preflightOk = preflightCandidateApk({
      ...preflightBase,
      baselineApkPath: baselineApk,
      runner: toolRunner(),
    });
    assert.equal(preflightOk.packageName, APP_PACKAGE);
    assert.equal(preflightOk.versionCode, 13);
    assert.equal(preflightOk.certIdentityVerified, true);
    assert.equal(preflightOk.reference.kind, 'baseline-apk');
    const preflightExpected = preflightCandidateApk({
      ...preflightBase,
      expectedCertSha256: candidateCert.toUpperCase(),
      runner: toolRunner(),
    });
    assert.equal(preflightExpected.reference.kind, 'expected-cert-sha256');
    assert.throws(
      () =>
        preflightCandidateApk({
          ...preflightBase,
          baselineApkPath: baselineApk,
          runner: toolRunner({
            badging: "package: name='other.pkg' versionCode='1' versionName='x'",
          }),
        }),
      (error) => error.code === 'APK_PACKAGE_MISMATCH',
    );
    assert.throws(
      () =>
        preflightCandidateApk({
          ...preflightBase,
          baselineApkPath: baselineApk,
          runner: toolRunner({ baseline: otherCert }),
        }),
      (error) => error.code === 'APK_CERT_MISMATCH',
    );
    assert.throws(
      () => preflightCandidateApk({ ...preflightBase, runner: toolRunner() }),
      (error) => error.code === 'APK_CERT_REFERENCE',
    );
    assert.throws(
      () =>
        preflightCandidateApk({
          ...preflightBase,
          aaptPath: undefined,
          baselineApkPath: baselineApk,
          runner: toolRunner(),
        }),
      (error) => error.code === 'APK_PREFLIGHT_TOOL',
    );
    assert.deepEqual(parseAaptBadging(badgingText), {
      packageName: APP_PACKAGE,
      versionCode: 13,
      versionName: '0.9.1',
    });
    assert.deepEqual(
      parseApksignerCerts(`Signer #1 certificate SHA-256 digest: ${candidateCert}\n`),
      [candidateCert],
    );
    record('upgrade preflight package/cert contract with explicit tools');

    // 7b. Cache export files are validated by content, not by share-sheet appearance.
    const cycleId = state.fixture.cycle.id;
    const backupName = backupFilename(Date.now());
    state.rawFiles[`cache/exports/${backupName}`] = Buffer.from(
      JSON.stringify({
        schemaVersion: 3,
        settings: { categories: state.fixture.appData.settings.categories },
        cycles: state.fixture.appData.cycles,
      }),
    );
    state.rawFiles[`cache/exports/${dayFilename(cycleId, 'txt')}`] = Buffer.from(
      `清醒时光 · 单日记录\n日期：${cycleId}\n`,
    );
    state.rawFiles[`cache/exports/${dayFilename(cycleId, 'json')}`] = Buffer.from(
      JSON.stringify({ cycles: [state.fixture.cycle] }),
    );
    state.rawFiles[`cache/exports/${dayFilename(cycleId, 'pdf')}`] = Buffer.concat([
      Buffer.from('%PDF-1.7\n'),
      Buffer.alloc(2000, 0x20),
    ]);
    assert.equal(validateBackupExport(device, backupName, state.fixture.appData.cycles).ok, true);
    assert.equal(validateTxtExport(device, dayFilename(cycleId, 'txt'), cycleId).ok, true);
    assert.equal(validateJsonExport(device, dayFilename(cycleId, 'json'), cycleId).ok, true);
    assert.equal(validatePdfExport(device, dayFilename(cycleId, 'pdf')).ok, true);
    const badCycles = structuredClone(state.fixture.appData.cycles);
    badCycles[0].session.segments[0].note = 'mismatch';
    assert.equal(validateBackupExport(device, backupName, badCycles).ok, false);
    record('backup/TXT/JSON/PDF cache export validation');

    // 8. Evidence paths: ignored inside repo, outside repo allowed, production denied.
    assert.throws(
      () => resolveEvidenceDir({ dir: path.join(repoRoot, 'src', 'mumu-evidence-nope') }),
      (error) => error.code === 'EVIDENCE_NOT_IGNORED',
    );
    assert.throws(
      () => resolveEvidenceDir({ dir: path.join(repoRoot, 'docs', 'backup-from-phone', 'x') }),
      (error) => error.code === 'PRODUCTION_PATH_DENIED',
    );
    assert.throws(
      () => resolveEvidenceDir({ dir: path.join(repoRoot, 'out', 'mumu-evidence') }),
      (error) => error.code === 'EVIDENCE_DIR',
    );
    const outside = resolveEvidenceDir({ dir: path.join(tempRoot, 'evidence') });
    assert.ok(existsSync(outside));
    record('evidence path policy');

    // 9. Synthetic restore fixture validation refuses production paths before reading.
    const fixturePath = path.join(tempRoot, 'synthetic-backup.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({
        schemaVersion: 3,
        settings: { categories: state.fixture.appData.settings.categories },
        cycles: state.fixture.appData.cycles,
      }),
    );
    const testData = validateTestDataFile(fixturePath);
    assert.equal(testData.ok, true);
    assert.equal(testData.cycles, 1);
    assert.throws(
      () => validateTestDataFile(path.join(repoRoot, 'docs', 'backup-from-phone', 'fake.json')),
      (error) => error.code === 'PRODUCTION_PATH_DENIED',
    );
    record('synthetic test-data validation');

    // 10. Scenario plans exist for every named flow and dry-run makes no calls.
    const beforeCalls = state.calls.length;
    for (const name of scenarioNames()) {
      const plan = planScenario(name);
      assert.ok(plan.steps.length > 0, `${name} has steps`);
    }
    const dry = runScenario('lap-note', { execute: false });
    assert.equal(dry.status, 'planned');
    assert.equal(state.calls.length, beforeCalls, 'dry-run must not touch the device');
    assert.deepEqual(
      parseArgv(['tap', '--text', '计次', '--expect-text', 'a', '--expect-text', 'b']).options,
      {
        _: [],
        text: '计次',
        'expect-text': ['a', 'b'],
      },
    );
    record('scenario plans + dry-run + CLI parsing');

    for (const name of ['start-cycle', 'new-cycle', 'classification', 'statistics']) {
      const env = createFakeEnvironment();
      const handle = fakeDevice(env, evidenceDir);
      const pending = runScenario(name, {
        device: handle,
        observer: createObserver(handle, { evidenceDir, sleep }),
        evidenceDir,
        sleep,
        execute: true,
      });
      assert.equal(pending.status, 'needs-agent');
      assert.equal(pending.steps.at(-1).action, 'agent');
      assert.equal(env.inputs.length, 0);
    }
    for (const name of ['lap-note', 'merge', 'restore', 'notifications', 'backup-export']) {
      assert.equal(planScenario(name).steps.at(-1).action, 'agent');
    }
    for (const name of ['restart', 'background-foreground']) {
      const env = createFakeEnvironment();
      const handle = fakeDevice(env, evidenceDir);
      env.transitionTarget = 'com.other.app';
      const stopped = runScenario(name, {
        device: handle,
        observer: createObserver(handle, { evidenceDir, sleep }),
        evidenceDir,
        sleep,
        execute: true,
      });
      assert.equal(stopped.status, 'failed');
      assert.equal(
        env.am.some((args) => args[0] === 'start'),
        false,
      );
    }
    record('handoff scenarios stay pending; interrupted lifecycle scenarios stop before launch');

    // 10b. CLI help and dry-run expose the safety contract without a device.
    const { runCli } = await import('./mumu-cli.mjs');
    const captureCli = async (argv) => {
      const out = [];
      const err = [];
      const writeOut = process.stdout.write;
      const writeErr = process.stderr.write;
      process.stdout.write = (chunk) => {
        out.push(String(chunk));
        return true;
      };
      process.stderr.write = (chunk) => {
        err.push(String(chunk));
        return true;
      };
      try {
        const code = await runCli(argv);
        return { code, out: out.join(''), err: err.join('') };
      } finally {
        process.stdout.write = writeOut;
        process.stderr.write = writeErr;
      }
    };
    const help = await captureCli(['--help']);
    assert.equal(help.code, 0);
    for (const token of [
      '--allow-foreground',
      '--allow-raw-data',
      '--aapt',
      '--apksigner',
      '--baseline-apk',
    ]) {
      assert.ok(help.out.includes(token), `help mentions ${token}`);
    }
    const tapPlan = await captureCli([
      'tap',
      '--coords',
      '10,10',
      '--from-shot',
      path.join(tempRoot, 'shot.png'),
      '--allow-foreground',
      'com.android.systemui',
      '--json',
    ]);
    assert.equal(tapPlan.code, 0);
    assert.deepEqual(JSON.parse(tapPlan.out).allowedForeground, ['com.android.systemui']);
    const badRaw = await captureCli(['snapshot', '--allow-raw-data', 'yes']);
    assert.equal(badRaw.code, 2);
    assert.match(badRaw.err, /allow-raw-data/);
    record('CLI help/dry-run and raw-data token');

    // 11. Run a complete navigation scenario against the fake tree.
    state.tree = createFakeEnvironment().tree;
    state.dumpExit = 0;
    state.treeWrites = true;
    state.foreground = APP_PACKAGE;
    const navDevice = fakeDevice(state, evidenceDir);
    const navObserver = createObserver(navDevice, { evidenceDir, sleep });
    const nav = runScenario('navigation', {
      device: navDevice,
      observer: navObserver,
      evidenceDir,
      execute: true,
      sleep,
    });
    assert.equal(nav.status, 'passed', nav.stopReason ?? 'navigation failed');
    assert.ok(nav.steps.every((step) => step.status === 'ok'));
    assert.ok(existsSync(nav.reportPath));
    record('navigation scenario executes end-to-end on fake tree');

    // 11b. Every adb call in the whole run carries the verified serial, and no
    //      reset/uninstall/other-device command slipped through.
    for (const call of state.calls) {
      const managerInfo = call.args[0] === 'info' && call.args[1] === '-v';
      if (managerInfo) continue;
      assert.equal(call.args[0], '-s', `unscoped command: ${call.base} ${call.args.join(' ')}`);
      assert.equal(call.args[1], state.serial, 'wrong serial on adb call');
    }
    for (const banned of ['uninstall', 'clear', 'kill-server', 'start-server']) {
      assert.ok(
        !state.calls.some((call) => call.args.includes(banned)),
        `banned adb command was never issued: ${banned}`,
      );
    }
    record('all adb calls scoped to the verified serial; no reset/uninstall');

    // 12. Parser rejects truncated trees.
    assert.throws(() => parseUiTree('<hierarchy rotation="0"><node text="x" />'), /truncated/);
    record('truncated tree rejection');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    rmSync(evidenceDir, { recursive: true, force: true });
  }

  process.stdout.write(`[mumu-selftest] PASS — ${checks.length} groups\n`);
  process.stdout.write(
    'This is a fake-runner safety check only; no ADB, MuMuManager or device action occurred.\n',
  );
  return 0;
}
