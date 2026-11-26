// MuMu E2E device guard: identity, explicit serial, narrow command surface.
//
// The harness is for one explicitly identified emulator instance. Every device
// command is sent to that serial with `-s`; there are no unscoped adb calls, no
// port scans, no adb server restart, no uninstall, no app-data clear, and no
// physical desktop pointer. Arguments are passed as arrays (never a shell
// string), and shell subcommands are matched against an allowlist so a bug or
// a mistyped scenario cannot turn into `pm clear` or `rm -rf`.
//
// Read-only observation (identity/observe/snapshot) and physical actions
// (tap/swipe/install) both run through this module.

import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PACKAGE = 'com.personal.waketime';
export const DEFAULT_ACTIVITY = '.MainActivity';
// Lawnchair was observed as the authorized MuMu instance's launcher in Task 2a.
const LAUNCHER_PACKAGES = ['com.android.launcher3', 'com.android.launcher', 'app.lawnchair'];
const SYSTEM_UI = 'com.android.systemui';

export class MumuGuardError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MumuGuardError';
    this.code = code;
    this.details = details;
  }
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function decodeText(value) {
  if (Buffer.isBuffer(value)) return stripBom(value.toString('utf8'));
  return stripBom(String(value ?? ''));
}

function normalizeResult(result) {
  if (!result || typeof result !== 'object') {
    throw new MumuGuardError('BAD_RUNNER_RESULT', 'command runner returned no result');
  }
  const status = typeof result.status === 'number' ? result.status : result.error ? -1 : 0;
  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout ?? '', 'utf8');
  const stderr = Buffer.isBuffer(result.stderr)
    ? decodeText(result.stderr)
    : String(result.stderr ?? '');
  return { status, stdout, stderr, error: result.error ?? null };
}

// Sync runner keeps the CLI deterministic. Evidence logs store argv and exit
// code only, never command output (persisted app data stays out of logs).
export function defaultRunner(program, args, options = {}) {
  const result = spawnSync(program, args, {
    encoding: 'buffer',
    timeout: options.timeoutMs ?? 30_000,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
  return normalizeResult(result);
}

const SAFE_TOKEN = /^[A-Za-z0-9_./:=+@-]+$/;
const SAFE_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SAFE_PROP = /^[A-Za-z0-9_.-]+$/;
const SAFE_SERIAL = /^[A-Za-z0-9_.:-]+$/;
const SAFE_ACTIVITY = /^[A-Za-z][A-Za-z0-9_.]*\/\.?[A-Za-z][A-Za-z0-9_.]*$/;
const SAFE_REMOTE_DUMP = /^\/data\/local\/tmp\/waketime-mumu-[a-z0-9-]+\.xml$/;
const SAFE_RUN_AS_PATH =
  /^(?:files\/waketime\/(?:data\.json|data\.prev\.json|data\.tmp\.json|backups\/data-\d{8}-\d{6}\.json)|files\/sleep-shots\/[A-Za-z0-9._-]+\.(?:jpg|png)|shared_prefs\/waketime_timer\.xml|cache\/exports\/[A-Za-z0-9._-]+\.(?:json|txt|pdf))$/;
const SAFE_KEYEVENT = new Set([
  'BACK',
  'ENTER',
  'TAB',
  'HOME',
  'KEYCODE_BACK',
  'KEYCODE_ENTER',
  'KEYCODE_TAB',
  'KEYCODE_HOME',
  'KEYCODE_MOVE_END',
  'KEYCODE_DEL',
]);

function isPackage(value) {
  return SAFE_PACKAGE.test(String(value));
}

/** Public package-name predicate shared by the CLI and observers. */
export function isPackageName(value) {
  return isPackage(value);
}

function isInt(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max;
}

function assertToken(value, label) {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value)) {
    throw new MumuGuardError('UNSAFE_ARG', `unsafe ${label}: ${JSON.stringify(value)}`);
  }
}

/** Validate a device-shell argv against the harness allowlist. */
export function assertSafeShellArgv(argv, options = {}) {
  const packageName = options.packageName ?? DEFAULT_PACKAGE;
  const allowInternalRm = options.allowInternalRm === true;
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new MumuGuardError('UNSAFE_SHELL', 'shell command must be a non-empty array');
  }
  for (const arg of argv) assertToken(arg, 'shell argument');
  const [command, ...rest] = argv;
  const fail = (message) => {
    throw new MumuGuardError('UNSAFE_SHELL', message, { argv });
  };

  switch (command) {
    case 'getprop':
      if (rest.length !== 1 || !SAFE_PROP.test(rest[0])) fail('getprop needs one property name');
      return;
    case 'dumpsys':
      if (rest.length === 1 && rest[0] === 'window') return;
      if (rest.length === 2 && rest[0] === 'package' && isPackage(rest[1])) return;
      fail('only `dumpsys window` and `dumpsys package <pkg>` are read');
      return;
    case 'wm':
      if (rest.length === 1 && rest[0] === 'size') return;
      fail('only `wm size` is allowed');
      return;
    case 'uiautomator':
      if (
        rest.length === 3 &&
        rest[0] === 'dump' &&
        rest[1] === '--compressed' &&
        SAFE_REMOTE_DUMP.test(rest[2])
      ) {
        return;
      }
      fail('uiautomator dump must target a unique harness path under /data/local/tmp');
      return;
    case 'input': {
      if (
        rest[0] === 'tap' &&
        rest.length === 3 &&
        isInt(rest[1], 0, 10_000) &&
        isInt(rest[2], 0, 10_000)
      ) {
        return;
      }
      if (
        rest[0] === 'swipe' &&
        rest.length === 6 &&
        rest.slice(1, 5).every((value) => isInt(value, 0, 10_000)) &&
        isInt(rest[5], 50, 5000)
      ) {
        return;
      }
      if (rest[0] === 'keyevent' && rest.length === 2 && SAFE_KEYEVENT.has(rest[1])) return;
      if (rest[0] === 'text' && rest.length === 2 && /^[A-Za-z0-9]{1,32}$/.test(rest[1])) return;
      fail(
        'input allows tap/swipe coordinates, synthetic alphanumeric text and allowlisted key events only',
      );
      return;
    }
    case 'am': {
      const startTarget = rest.length === 3 ? rest[2] : '';
      if (
        rest[0] === 'start' &&
        rest[1] === '-n' &&
        SAFE_ACTIVITY.test(startTarget) &&
        startTarget.startsWith(`${packageName}/`)
      ) {
        return;
      }
      if (rest.length === 2 && rest[0] === 'force-stop' && rest[1] === packageName) return;
      fail('am allows launching or force-stopping the test package only');
      return;
    }
    case 'cmd':
      if (
        rest.length === 2 &&
        rest[0] === 'statusbar' &&
        (rest[1] === 'expand-notifications' || rest[1] === 'collapse-notifications')
      ) {
        return;
      }
      fail('cmd allows statusbar expand/collapse only');
      return;
    case 'run-as': {
      const target = rest.length === 3 ? rest[2] : '';
      if (
        rest.length === 3 &&
        rest[0] === packageName &&
        rest[1] === 'cat' &&
        SAFE_RUN_AS_PATH.test(target)
      ) {
        return;
      }
      if (
        rest.length === 3 &&
        rest[0] === packageName &&
        rest[1] === 'ls' &&
        target === 'cache/exports'
      ) {
        return;
      }
      fail('run-as may only cat known app data/export files or list cache/exports');
      return;
    }
    case 'rm':
      if (
        allowInternalRm &&
        rest.length === 2 &&
        rest[0] === '-f' &&
        SAFE_REMOTE_DUMP.test(rest[1])
      ) {
        return;
      }
      fail('rm is limited to removing the harness dump file');
      return;
    default:
      fail(`shell command not allowlisted: ${command}`);
  }
}

/** Validate an adb argv (without the serial prefix) against the allowlist. */
export function assertSafeAdbArgs(args, options = {}) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new MumuGuardError('UNSAFE_ADB', 'adb command must be a non-empty array');
  }
  if (args.includes('-s')) {
    throw new MumuGuardError(
      'UNSAFE_ADB',
      'do not pass -s manually; the guard adds the verified serial',
    );
  }
  const [command] = args;
  if (command === 'shell') {
    assertSafeShellArgv(args.slice(1), options);
    return;
  }
  if (command === 'exec-out') {
    const rest = args.slice(1);
    if (rest.length === 2 && rest[0] === 'screencap' && rest[1] === '-p') return;
    if (rest.length === 2 && rest[0] === 'cat' && SAFE_REMOTE_DUMP.test(rest[1])) return;
    if (
      rest.length === 4 &&
      rest[0] === 'run-as' &&
      rest[1] === (options.packageName ?? DEFAULT_PACKAGE) &&
      rest[2] === 'cat' &&
      SAFE_RUN_AS_PATH.test(rest[3])
    ) {
      return;
    }
    throw new MumuGuardError(
      'UNSAFE_ADB',
      'exec-out allows screencap, harness dump cat, and run-as cat',
    );
  }
  if (command === 'get-state' && args.length === 1) return;
  if (
    command === 'logcat' &&
    args.length === 4 &&
    args[1] === '-d' &&
    args[2] === '-t' &&
    isInt(args[3], 1, 500)
  ) {
    return;
  }
  if (command === 'install' && args.length === 3 && args[1] === '-r' && /\.apk$/i.test(args[2]))
    return;
  throw new MumuGuardError('UNSAFE_ADB', `adb command not allowlisted: ${command}`, { args });
}

export function parseMuMuInfo(text) {
  let parsed;
  try {
    parsed = JSON.parse(decodeText(text).trim());
  } catch (error) {
    throw new MumuGuardError('MUMU_INFO_PARSE', `MuMuManager info is not JSON: ${error.message}`);
  }
  if (Array.isArray(parsed)) {
    const mapped = {};
    parsed.forEach((entry, index) => {
      mapped[String(entry?.index ?? index)] = entry;
    });
    return mapped;
  }
  if (parsed && typeof parsed === 'object') return parsed;
  throw new MumuGuardError('MUMU_INFO_SHAPE', 'MuMuManager info must be an object or array');
}

/** Verify the requested index, name, state and serial map to one instance. */
export function verifyInstanceRecord(instances, options) {
  const { instance, serial, instanceName } = options;
  if (!SAFE_SERIAL.test(String(serial ?? ''))) {
    throw new MumuGuardError('IDENTITY_ARG', `invalid serial: ${JSON.stringify(serial)}`);
  }
  const key = String(instance);
  const entry = instances[key];
  if (!entry || typeof entry !== 'object') {
    throw new MumuGuardError(
      'INSTANCE_MISSING',
      `MuMu instance ${key} not found; available: ${Object.keys(instances).join(', ')}`,
    );
  }
  if (instanceName && entry.name !== instanceName) {
    throw new MumuGuardError(
      'INSTANCE_NAME',
      `instance ${key} is ${JSON.stringify(entry.name)}, expected ${JSON.stringify(instanceName)}`,
    );
  }
  if (entry.player_state !== 'start_finished') {
    throw new MumuGuardError(
      'INSTANCE_NOT_READY',
      `instance ${key} player_state=${JSON.stringify(entry.player_state)}, expected "start_finished"`,
    );
  }
  const host = entry.adb_host_ip;
  const port = entry.adb_port;
  const actualSerial = `${host}:${port}`;
  if (actualSerial !== serial) {
    throw new MumuGuardError(
      'INSTANCE_SERIAL',
      `instance ${key} serial is ${actualSerial}, expected ${serial}`,
    );
  }
  const matches = Object.entries(instances).filter(
    ([, value]) => `${value?.adb_host_ip}:${value?.adb_port}` === serial,
  );
  if (matches.length !== 1 || matches[0][0] !== key) {
    throw new MumuGuardError(
      'SERIAL_AMBIGUOUS',
      `serial ${serial} must map to exactly instance ${key}; got ${matches.map(([id]) => id).join(', ') || 'none'}`,
    );
  }
  return {
    instance: Number(instance),
    instanceName: entry.name ?? null,
    serial,
    playerState: entry.player_state,
    host,
    port,
  };
}

export function assertExistingFile(filePath, label) {
  if (!filePath || typeof filePath !== 'string') {
    throw new MumuGuardError('PATH_REQUIRED', `${label} path is required`);
  }
  const absolute = path.resolve(filePath);
  if (!existsSync(absolute)) {
    throw new MumuGuardError('PATH_MISSING', `${label} does not exist: ${absolute}`);
  }
  if (!statSync(absolute).isFile()) {
    throw new MumuGuardError('PATH_NOT_FILE', `${label} is not a file: ${absolute}`);
  }
  return absolute;
}

export function sleepMs(ms) {
  const duration = Math.max(0, Math.min(Number(ms) || 0, 30_000));
  if (duration === 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, duration);
}

function redactArgs(args) {
  if (args[0] === 'install' && args.length === 3) {
    return ['install', '-r', path.basename(args[2])];
  }
  return args;
}

/**
 * Create a guarded device handle. `runner` is injectable so the self-test can
 * exercise every branch without spawning adb or touching a real emulator.
 */
export function createMumuDevice(options) {
  const {
    adbPath,
    managerPath,
    instance,
    serial,
    packageName = DEFAULT_PACKAGE,
    instanceName,
    activity = DEFAULT_ACTIVITY,
    runner = defaultRunner,
    evidenceDir = null,
    clock = Date.now,
    sleep = sleepMs,
  } = options;

  const adb = assertExistingFile(adbPath, 'adb');
  const manager = assertExistingFile(
    managerPath ?? path.join(path.dirname(adb), 'MuMuManager.exe'),
    'MuMuManager',
  );
  if (!Number.isInteger(Number(instance)) || Number(instance) < 0) {
    throw new MumuGuardError('IDENTITY_ARG', `invalid MuMu instance index: ${instance}`);
  }
  if (!SAFE_SERIAL.test(String(serial ?? ''))) {
    throw new MumuGuardError('IDENTITY_ARG', `invalid serial: ${serial}`);
  }
  if (!isPackage(packageName)) {
    throw new MumuGuardError('IDENTITY_ARG', `invalid package name: ${packageName}`);
  }

  let identity = null;
  let sequence = 0;
  // A launcher or shade is owned only after an observed transition from the
  // test app on this handle. A fresh handle cannot assume somebody else's UI.
  let ownedSurface = null;
  let ownershipLost = false;

  function logCall(kind, argv, result, note = '') {
    if (!evidenceDir) return;
    try {
      mkdirSync(evidenceDir, { recursive: true });
      const line = JSON.stringify({
        atMs: clock(),
        seq: ++sequence,
        kind,
        argv: redactArgs(argv),
        status: result.status,
        stdoutBytes: result.stdout.length,
        stderr: result.stderr.slice(0, 200),
        note,
      });
      appendFileSync(path.join(evidenceDir, 'command-log.jsonl'), `${line}\n`);
    } catch {
      // Evidence logging must not break the operation.
    }
  }

  function runProgram(program, argv, timeoutMs) {
    return normalizeResult(runner(program, argv, { timeoutMs }));
  }

  function runAdb(args, optionsArg = {}) {
    assertSafeAdbArgs(args, {
      packageName,
      allowInternalRm: optionsArg.allowInternalRm === true,
    });
    const full = ['-s', serial, ...args];
    const result = runProgram(adb, full, optionsArg.timeoutMs ?? 30_000);
    logCall('adb', full, result, optionsArg.note ?? '');
    if (optionsArg.check === false || optionsArg.tolerateFailure) return result;
    if (result.status !== 0) {
      throw new MumuGuardError(
        'ADB_FAILED',
        `adb ${args[0]} failed with ${result.status}: ${result.stderr.trim() || '(no stderr)'}`,
        { args },
      );
    }
    return result;
  }

  function managerInfo() {
    const result = runProgram(manager, ['info', '-v', 'all'], 15_000);
    logCall('mumumanager', ['info', '-v', 'all'], result);
    if (result.status !== 0) {
      throw new MumuGuardError(
        'MUMU_INFO_FAILED',
        `MuMuManager info failed with ${result.status}: ${result.stderr.trim() || '(no stderr)'}`,
      );
    }
    return parseMuMuInfo(result.stdout);
  }

  function verifyIdentity() {
    const instances = managerInfo();
    const record = verifyInstanceRecord(instances, { instance, serial, instanceName });
    const state = runAdb(['get-state']);
    const value = decodeText(state.stdout).trim();
    if (value !== 'device') {
      throw new MumuGuardError(
        'DEVICE_NOT_READY',
        `adb -s ${serial} get-state=${JSON.stringify(value)}, expected "device"`,
      );
    }
    let sdk = null;
    const sdkResult = runAdb(['shell', 'getprop', 'ro.build.version.sdk'], {
      tolerateFailure: true,
      timeoutMs: 10_000,
    });
    if (sdkResult.status === 0) sdk = decodeText(sdkResult.stdout).trim() || null;
    identity = {
      ...record,
      packageName,
      androidSdk: sdk,
      checkedAtMs: clock(),
    };
    return identity;
  }

  function shell(argv, optionsArg = {}) {
    assertSafeShellArgv(argv, { packageName, allowInternalRm: optionsArg.allowInternalRm });
    if (['am', 'cmd'].includes(argv[0]) || (argv[0] === 'input' && argv[1] === 'keyevent')) {
      throw new MumuGuardError('GUARDED_ACTION', 'use the guarded lifecycle or keyevent method');
    }
    if (argv[0] === 'input') {
      verifyIdentity();
      assertForeground([optionsArg.expectedForeground ?? packageName]);
    }
    return runAdb(['shell', ...argv], optionsArg);
  }

  function execOut(argv, optionsArg = {}) {
    return runAdb(['exec-out', ...argv], optionsArg);
  }

  function readFile(relativePath) {
    const result = runAdb(['shell', 'run-as', packageName, 'cat', relativePath], {
      tolerateFailure: true,
      timeoutMs: 20_000,
    });
    if (result.status !== 0) {
      return { exists: false, text: null, bytes: 0, stderr: result.stderr };
    }
    return {
      exists: true,
      text: decodeText(result.stdout),
      bytes: result.stdout.length,
      stderr: result.stderr,
    };
  }

  function readFileRaw(relativePath) {
    const result = runAdb(['exec-out', 'run-as', packageName, 'cat', relativePath], {
      tolerateFailure: true,
      timeoutMs: 30_000,
    });
    return {
      exists: result.status === 0,
      data: result.stdout,
      bytes: result.stdout.length,
      stderr: result.stderr,
    };
  }

  function listExports() {
    const result = runAdb(['shell', 'run-as', packageName, 'ls', 'cache/exports'], {
      tolerateFailure: true,
      timeoutMs: 10_000,
    });
    if (result.status !== 0) return [];
    return decodeText(result.stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.includes('/') && !line.includes('..'));
  }

  function dumpsysPackage() {
    return runAdb(['shell', 'dumpsys', 'package', packageName], {
      tolerateFailure: true,
      timeoutMs: 20_000,
    });
  }

  function foregroundPackage() {
    const result = runAdb(['shell', 'dumpsys', 'window'], {
      tolerateFailure: true,
      timeoutMs: 20_000,
    });
    if (result.status !== 0) return null;
    const text = decodeText(result.stdout);
    const focus = /mCurrentFocus=Window\{[^}]*?\s([A-Za-z0-9_.]+)\/[A-Za-z0-9_.]+/.exec(text);
    if (focus) return focus[1];
    // mFocusedApp can describe the app underneath an overlay/null focus.
    // It is not proof that the app currently owns input.
    return null;
  }

  function rejectForeground(current, allowed) {
    ownershipLost = true;
    ownedSurface = null;
    throw new MumuGuardError(
      'APP_NOT_FOREGROUND',
      `focused package is ${JSON.stringify(current)}, expected ${allowed.join(' or ')}; input stopped`,
    );
  }

  function assertForeground(allowed = [packageName]) {
    if (ownershipLost) {
      throw new MumuGuardError(
        'APP_NOT_FOREGROUND',
        'foreground ownership was lost; stop this run',
      );
    }
    const current = foregroundPackage();
    if (!allowed.includes(current)) rejectForeground(current, allowed);
    if (current === packageName) ownedSurface = null;
    return current;
  }

  // The expected successor may take a moment to gain focus. Only the old
  // focus (or a transient null) can be waited out; never operate on either.
  function observeTransition(from, destinations) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const current = foregroundPackage();
      if (destinations.includes(current)) {
        ownedSurface = current === packageName ? null : current;
        return current;
      }
      if (current !== from && current !== null) rejectForeground(current, destinations);
      sleep(200);
    }
    rejectForeground(foregroundPackage(), destinations);
  }

  function keyevent(key) {
    verifyIdentity();
    const current = assertForeground();
    const result = runAdb(['shell', 'input', 'keyevent', key]);
    if (key === 'HOME' || key === 'KEYCODE_HOME') observeTransition(current, LAUNCHER_PACKAGES);
    else assertForeground();
    return result;
  }

  function assertOwnedForeground() {
    return assertForeground(ownedSurface ? [packageName, ownedSurface] : [packageName]);
  }

  function launchApp() {
    verifyIdentity();
    const current = assertOwnedForeground();
    const result = runAdb(['shell', 'am', 'start', '-n', `${packageName}/${activity}`], {
      timeoutMs: 20_000,
    });
    observeTransition(current, [packageName]);
    return result;
  }

  function forceStopApp() {
    verifyIdentity();
    const current = assertForeground();
    const result = runAdb(['shell', 'am', 'force-stop', packageName], { timeoutMs: 20_000 });
    observeTransition(current, LAUNCHER_PACKAGES);
    return result;
  }

  function setNotificationShade(expanded) {
    verifyIdentity();
    if (!expanded && ownedSurface !== SYSTEM_UI) {
      // Already in the app: unnecessary global collapse is not sent.
      assertForeground();
      return null;
    }
    const current = assertForeground(expanded ? [packageName] : [SYSTEM_UI, packageName]);
    if (!expanded && current === packageName) {
      ownedSurface = null;
      return null;
    }
    const result = runAdb(
      ['shell', 'cmd', 'statusbar', expanded ? 'expand-notifications' : 'collapse-notifications'],
      { timeoutMs: 10_000 },
    );
    observeTransition(current, expanded ? [SYSTEM_UI] : [packageName]);
    return result;
  }

  function installUpgrade(apkPath) {
    const apk = assertExistingFile(apkPath, 'APK');
    if (!/\.apk$/i.test(apk)) {
      throw new MumuGuardError('APK_EXTENSION', `not an .apk file: ${apk}`);
    }
    verifyIdentity();
    const current = assertForeground();
    const result = runAdb(['install', '-r', apk], {
      timeoutMs: 180_000,
      note: 'same-cert upgrade',
    });
    const output = `${decodeText(result.stdout)}\n${result.stderr}`;
    if (result.status !== 0 || !/Success/i.test(output)) {
      throw new MumuGuardError(
        'INSTALL_FAILED',
        `adb install -r did not report Success: ${output.trim()}`,
      );
    }
    observeTransition(current, [packageName, ...LAUNCHER_PACKAGES]);
    return { apk, output: output.trim() };
  }

  function stageSyntheticFixture(filePath, optIn) {
    if (optIn !== 'synthetic') {
      throw new MumuGuardError('FIXTURE_OPT_IN', 'staging requires explicit synthetic-only opt-in');
    }
    const source = path.resolve(filePath);
    const basename = path.basename(source);
    if (
      !evidenceDir ||
      !/^e2e-[a-z0-9-]+\.(?:json|png)$/.test(basename) ||
      path.dirname(source) !== path.resolve(evidenceDir)
    ) {
      throw new MumuGuardError(
        'FIXTURE_PATH',
        'fixture must be a named e2e file directly in this evidence directory',
      );
    }
    assertNoProductionBackupPath(source);
    resolveEvidenceDir({ dir: evidenceDir });
    assertExistingFile(source, 'synthetic fixture');
    if (
      realpathSync(source).toLowerCase() !==
      realpathSync(path.resolve(evidenceDir)).concat(path.sep, basename).toLowerCase()
    ) {
      throw new MumuGuardError(
        'FIXTURE_PATH',
        'fixture must not resolve outside its evidence directory',
      );
    }
    const data = readFileSync(source);
    if (basename.endsWith('.json')) {
      const parsed = JSON.parse(data.toString('utf8'));
      if (
        parsed?.schemaVersion !== 3 ||
        !Array.isArray(parsed?.cycles) ||
        !Array.isArray(parsed?.settings?.categories)
      ) {
        throw new MumuGuardError('FIXTURE_SCHEMA', 'expected synthetic schema-3 backup');
      }
    } else if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new MumuGuardError('FIXTURE_SCHEMA', 'expected synthetic PNG fixture');
    }
    const destination = `/sdcard/Download/waketime-e2e-${randomUUID()}${path.extname(source)}`;
    verifyIdentity();
    assertForeground();
    const full = ['-s', serial, 'push', source, destination];
    const result = runProgram(adb, full, 30_000);
    logCall('adb', full, result, 'synthetic fixture staging');
    if (result.status !== 0)
      throw new MumuGuardError('ADB_FAILED', 'synthetic fixture staging failed');
    assertForeground();
    return destination;
  }

  function logcat(lines = 200) {
    const count = Math.max(1, Math.min(Number(lines) || 200, 500));
    return runAdb(['logcat', '-d', '-t', String(count)], {
      tolerateFailure: true,
      timeoutMs: 20_000,
    });
  }

  return {
    adbPath: adb,
    managerPath: manager,
    packageName,
    instance: Number(instance),
    serial,
    activity,
    verifyIdentity,
    identity: () => identity,
    shell,
    execOut,
    readFile,
    readFileRaw,
    listExports,
    dumpsysPackage,
    foregroundPackage,
    assertForeground,
    assertOwnedForeground,
    keyevent,
    launchApp,
    forceStopApp,
    setNotificationShade,
    installUpgrade,
    stageSyntheticFixture,
    logcat,
  };
}

export function assertNoProductionBackupPath(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  const blocked = ['/docs/backup-from-phone', '/docs/shots', '/docs/gpt-ds'];
  if (blocked.some((marker) => normalized.includes(marker))) {
    throw new MumuGuardError(
      'PRODUCTION_PATH_DENIED',
      'refusing to read a production backup or private evidence path; pass only synthetic test data',
    );
  }
}

/**
 * Resolve the evidence directory. Inside the repo it must already be ignored by
 * git; outside the repo any local path is allowed. Production backup folders
 * are always rejected.
 */
export function resolveEvidenceDir(options = {}) {
  const root = options.repoRoot ?? repoRoot;
  const clock = options.clock ?? Date.now;
  const stamp = new Date(clock()).toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const suffix = Math.random().toString(16).slice(2, 8);
  const target = path.resolve(
    options.dir ?? path.join(root, 'test-results', 'mumu-e2e', `${stamp}-${suffix}`),
  );
  assertNoProductionBackupPath(target);
  const relative = path.relative(root, target);
  const insideRepo = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  if (relative === '') {
    throw new MumuGuardError('EVIDENCE_DIR', 'evidence directory cannot be the repository root');
  }
  if (insideRepo) {
    const posixRelative = relative.split(path.sep).join('/');
    if (/^(?:out|tools)(?:\/|$)/.test(posixRelative)) {
      throw new MumuGuardError(
        'EVIDENCE_DIR',
        `refusing to write evidence into the separate ${posixRelative.split('/')[0]}/ work line`,
      );
    }
    const check = spawnSync('git', ['-C', root, 'check-ignore', '-q', '--', posixRelative], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (check.status !== 0) {
      throw new MumuGuardError(
        'EVIDENCE_NOT_IGNORED',
        `evidence path is not git-ignored: ${posixRelative}; use test-results/ or a path outside the repo`,
      );
    }
  }
  mkdirSync(target, { recursive: true });
  return target;
}

export function readJsonFile(filePath) {
  const absolute = assertExistingFile(filePath, 'JSON file');
  try {
    return JSON.parse(stripBom(readFileSync(absolute, 'utf8')));
  } catch (error) {
    throw new MumuGuardError('JSON_PARSE', `${absolute} is not valid JSON: ${error.message}`);
  }
}
