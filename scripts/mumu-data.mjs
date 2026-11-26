// Persisted-state snapshots and upgrade continuity checks for MuMu E2E.
//
// Only the dedicated test package is read, through `run-as`, and only synthetic
// app data is written into the ignored evidence directory. The comparison is
// intentionally strict: the full persisted app JSON (cycles, segments,
// settings) and the full native `timer_state_v1` session are compared, plus a
// cross-check that the app's active cycle mirror agrees with the native session.
// Nothing is printed as a data dump; callers get counts, paths and diffs.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  MumuGuardError,
  assertExistingFile,
  assertNoProductionBackupPath,
  decodeText,
  defaultRunner,
  stripBom,
  readJsonFile,
  sleepMs,
} from './mumu-guard.mjs';
import { decodeXmlEntities } from './mumu-observe.mjs';

export const APP_DATA_PATH = 'files/waketime/data.json';
export const NATIVE_PREFS_PATH = 'shared_prefs/waketime_timer.xml';
export const NATIVE_STATE_KEY = 'timer_state_v1';
const EXPORT_PREFIX = 'cache/exports/';

export function parsePackageInfo(text) {
  const source = decodeText(text);
  const packageMatch = /Package \[([^\]]+)\]/.exec(source);
  const versionCodeMatch = /versionCode=(\d+)/.exec(source);
  const versionNameMatch = /versionName=([^\s]+)/.exec(source);
  const installed = packageMatch !== null && versionCodeMatch !== null;
  return {
    installed,
    packageName: packageMatch ? packageMatch[1] : null,
    versionCode: versionCodeMatch ? Number(versionCodeMatch[1]) : null,
    versionName: versionNameMatch ? versionNameMatch[1] : null,
    debuggable: /flags=\[[^\]]*\bDEBUGGABLE\b[^\]]*\]/.test(source),
  };
}

export function parseNativePrefs(xmlText) {
  const text = decodeText(xmlText);
  const match = new RegExp(`<string\\s+name="${NATIVE_STATE_KEY}"\\s*>([\\s\\S]*?)</string>`).exec(
    text,
  );
  if (!match) {
    return { exists: true, state: null, raw: null, error: `${NATIVE_STATE_KEY} is missing` };
  }
  const raw = decodeXmlEntities(match[1]);
  try {
    return { exists: true, state: JSON.parse(raw), raw, error: null };
  } catch (error) {
    return { exists: true, state: null, raw, error: `native JSON parse failed: ${error.message}` };
  }
}

/** Parse `aapt dump badging` package metadata (explicit external tool). */
export function parseAaptBadging(text) {
  const source = decodeText(text);
  const match =
    /package:\s+name='([^']+)'(?:\s+versionCode='([^']*)')?(?:\s+versionName='([^']*)')?/.exec(
      source,
    );
  if (!match) return { packageName: null, versionCode: null, versionName: null };
  return {
    packageName: match[1],
    versionCode: match[2] ? Number(match[2]) : null,
    versionName: match[3] ?? null,
  };
}

/** Parse `apksigner verify --print-certs` SHA-256 signer digests. */
export function parseApksignerCerts(text) {
  const certs = new Set();
  const pattern = /certificate SHA-256 digest:\s*([0-9a-fA-F:]+)/g;
  let match;
  const source = decodeText(text);
  while ((match = pattern.exec(source)) !== null) {
    certs.add(match[1].replace(/[^0-9a-fA-F]/g, '').toLowerCase());
  }
  return [...certs];
}

function normalizeCertDigest(value) {
  const normalized = String(value ?? '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new MumuGuardError(
      'APK_CERT_DIGEST',
      `expected cert SHA-256 must be 64 hex characters; got ${JSON.stringify(value)}`,
    );
  }
  return normalized;
}

function runTool(toolPath, args, runner, timeoutMs = 60_000) {
  // Windows ships apksigner as a .bat wrapper; Node cannot spawn it directly.
  const windowsScript = process.platform === 'win32' && /\.(?:bat|cmd)$/i.test(toolPath);
  const program = windowsScript ? process.env.ComSpec || 'cmd.exe' : toolPath;
  const argv = windowsScript ? ['/d', '/s', '/c', toolPath, ...args] : args;
  return runner(program, argv, { timeoutMs });
}

function readApkCerts(apksignerPath, apkPath, runner, label) {
  const result = runTool(apksignerPath, ['verify', '--print-certs', apkPath], runner);
  const output = `${decodeText(result.stdout)}\n${decodeText(result.stderr)}`;
  if (result.status !== 0) {
    throw new MumuGuardError(
      'APK_SIGNATURE_INVALID',
      `${label} APK failed apksigner verify (${result.status}): ${output.trim() || '(no output)'}`,
    );
  }
  const certs = parseApksignerCerts(output);
  if (certs.length === 0) {
    throw new MumuGuardError(
      'APK_CERT_MISSING',
      `${label} APK has no signer SHA-256 certificate in apksigner output`,
    );
  }
  return certs;
}

/**
 * Upgrade preflight contract: external aapt/apksigner paths are explicit (no
 * auto-discovery), the candidate package name must equal the authorized test
 * package, and the candidate signing cert must match an explicit reference
 * (`--baseline-apk` or `--expected-cert-sha256`). All tool calls are local; no
 * device or install happens here.
 */
export function preflightCandidateApk(options) {
  const {
    apkPath,
    packageName,
    aaptPath,
    apksignerPath,
    baselineApkPath,
    expectedCertSha256,
    runner = defaultRunner,
  } = options;
  if (!aaptPath) {
    throw new MumuGuardError(
      'APK_PREFLIGHT_TOOL',
      'upgrade preflight needs explicit --aapt <path>',
    );
  }
  if (!apksignerPath) {
    throw new MumuGuardError(
      'APK_PREFLIGHT_TOOL',
      'upgrade preflight needs explicit --apksigner <path>',
    );
  }
  const apk = assertExistingFile(apkPath, 'candidate APK');
  const aapt = assertExistingFile(aaptPath, 'aapt');
  const apksigner = assertExistingFile(apksignerPath, 'apksigner');

  const badging = runTool(aapt, ['dump', 'badging', apk], runner);
  if (badging.status !== 0) {
    throw new MumuGuardError(
      'APK_PREFLIGHT_FAILED',
      `aapt dump badging failed (${badging.status}): ${decodeText(badging.stderr).trim() || '(no stderr)'}`,
    );
  }
  const info = parseAaptBadging(badging.stdout);
  if (!info.packageName) {
    throw new MumuGuardError('APK_PREFLIGHT_FAILED', 'aapt output has no package name');
  }
  if (info.packageName !== packageName) {
    throw new MumuGuardError(
      'APK_PACKAGE_MISMATCH',
      `candidate package ${info.packageName} does not match authorized test package ${packageName}`,
    );
  }

  const candidateCerts = readApkCerts(apksigner, apk, runner, 'candidate');
  let reference = null;
  if (baselineApkPath) {
    const baseline = assertExistingFile(baselineApkPath, 'baseline APK');
    reference = {
      kind: 'baseline-apk',
      apk: path.basename(baseline),
      certSha256: readApkCerts(apksigner, baseline, runner, 'baseline'),
    };
  } else if (expectedCertSha256) {
    reference = {
      kind: 'expected-cert-sha256',
      certSha256: [normalizeCertDigest(expectedCertSha256)],
    };
  } else {
    throw new MumuGuardError(
      'APK_CERT_REFERENCE',
      'upgrade preflight needs --baseline-apk <path> or --expected-cert-sha256 <hex> to verify the signing identity',
    );
  }
  const certIdentityVerified = candidateCerts.some((cert) => reference.certSha256.includes(cert));
  if (!certIdentityVerified) {
    throw new MumuGuardError(
      'APK_CERT_MISMATCH',
      `candidate cert ${candidateCerts.join(', ')} does not match ${reference.kind} ${reference.certSha256.join(', ')}`,
    );
  }

  return {
    schema: 'mumu-e2e-apk-preflight/v1',
    apk: path.basename(apk),
    packageName: info.packageName,
    versionCode: info.versionCode,
    versionName: info.versionName,
    certSha256: candidateCerts,
    reference,
    certIdentityVerified,
    tools: { aapt: path.basename(aapt), apksigner: path.basename(apksigner) },
  };
}

/**
 * Raw persisted data is only written when the caller passes the literal token
 * "synthetic". `--allow-raw-data` alone (or any other value) is refused so a
 * real backup cannot be copied to disk by accident.
 */
export function assertRawDataAuthorized(value) {
  if (value === undefined || value === null || value === false) return false;
  if (value === true) {
    throw new MumuGuardError(
      'RAW_DATA_UNAUTHORIZED',
      'raw snapshot writes require the explicit token: --allow-raw-data synthetic',
    );
  }
  if (String(value) !== 'synthetic') {
    throw new MumuGuardError(
      'RAW_DATA_UNAUTHORIZED',
      `--allow-raw-data only accepts "synthetic" (authorized synthetic test data); got ${JSON.stringify(value)}`,
    );
  }
  return true;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function preview(value) {
  if (typeof value === 'string') return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  return value;
}

/** Deep equality diff with JSON paths; arrays are compared by index and order. */
export function deepDiff(before, after, pathName = '$', limit = 200, out = []) {
  if (out.length >= limit) return out;
  if (Object.is(before, after)) return out;
  if (typeof before !== typeof after || before === null || after === null) {
    out.push({ path: pathName, before: preview(before), after: preview(after), kind: 'value' });
    return out;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      out.push({ path: pathName, before: preview(before), after: preview(after), kind: 'type' });
      return out;
    }
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length && out.length < limit; index += 1) {
      if (index >= before.length) {
        out.push({
          path: `${pathName}[${index}]`,
          before: '<missing>',
          after: preview(after[index]),
          kind: 'added',
        });
      } else if (index >= after.length) {
        out.push({
          path: `${pathName}[${index}]`,
          before: preview(before[index]),
          after: '<missing>',
          kind: 'removed',
        });
      } else {
        deepDiff(before[index], after[index], `${pathName}[${index}]`, limit, out);
      }
    }
    return out;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (out.length >= limit) break;
      const childPath = `${pathName}.${key}`;
      if (!(key in before)) {
        out.push({
          path: childPath,
          before: '<missing>',
          after: preview(after[key]),
          kind: 'added',
        });
      } else if (!(key in after)) {
        out.push({
          path: childPath,
          before: preview(before[key]),
          after: '<missing>',
          kind: 'removed',
        });
      } else {
        deepDiff(before[key], after[key], childPath, limit, out);
      }
    }
    return out;
  }
  out.push({ path: pathName, before: preview(before), after: preview(after), kind: 'value' });
  return out;
}

function activeCycle(snapshot) {
  const cycles = snapshot?.app?.data?.cycles;
  if (!Array.isArray(cycles)) return null;
  const nativeCycleId = snapshot?.native?.state?.cycleId;
  if (nativeCycleId) return cycles.find((cycle) => cycle?.id === nativeCycleId) ?? null;
  return cycles.find((cycle) => cycle?.closedAtMs === null && cycle?.session) ?? null;
}

function summarizeSnapshot(snapshot) {
  const cycles = Array.isArray(snapshot?.app?.data?.cycles) ? snapshot.app.data.cycles : [];
  const active = activeCycle(snapshot);
  const nativeSegments = Array.isArray(snapshot?.native?.state?.segments)
    ? snapshot.native.state.segments
    : [];
  return {
    cycles: cycles.length,
    activeCycleId: active?.id ?? null,
    appActiveSegments: Array.isArray(active?.session?.segments)
      ? active.session.segments.length
      : 0,
    nativeStatus: snapshot?.native?.state?.status ?? null,
    nativeSegments: nativeSegments.length,
    settingsCategories: Array.isArray(snapshot?.app?.data?.settings?.categories)
      ? snapshot.app.data.settings.categories.length
      : 0,
    debuggable: snapshot?.packageInfo?.debuggable ?? null,
    appDataParseError: snapshot?.app?.parseError ?? null,
    appAccessError: snapshot?.app?.accessError ?? null,
    nativeParseError: snapshot?.native?.error ?? null,
    nativeAccessError: snapshot?.native?.accessError ?? null,
  };
}

const NATIVE_SEGMENT_KEYS = [
  'id',
  'seq',
  'startAtMs',
  'endAtMs',
  'note',
  'category',
  'source',
  'splitFromId',
];

function projectSegment(segment) {
  const projected = {};
  for (const key of NATIVE_SEGMENT_KEYS) {
    if (segment && Object.prototype.hasOwnProperty.call(segment, key))
      projected[key] = segment[key];
  }
  return projected;
}

function mirrorDiff(snapshot) {
  const native = snapshot?.native?.state;
  if (!native) {
    const active = Array.isArray(snapshot?.app?.data?.cycles)
      ? snapshot.app.data.cycles.find((cycle) => cycle?.closedAtMs === null && cycle?.session)
      : null;
    if (active) {
      return {
        ok: false,
        diffs: [
          {
            path: '$.nativeSession',
            before: '<missing>',
            after: { cycleId: active.id },
            kind: 'mirror',
          },
        ],
        note: 'app has an active cycle but the native timer session is missing',
      };
    }
    return { ok: true, diffs: [], note: 'no native timer state' };
  }
  const cycle = activeCycle(snapshot);
  if (!cycle) {
    return {
      ok: false,
      diffs: [
        {
          path: '$.activeCycle',
          before: native.cycleId ?? null,
          after: '<missing>',
          kind: 'mirror',
        },
      ],
      note: 'native cycle is not present in app data',
    };
  }
  const diffs = [];
  if (native.cycleId !== cycle.id) {
    diffs.push({ path: '$.cycleId', before: native.cycleId, after: cycle.id, kind: 'mirror' });
  }
  const nativeSession = native;
  const appSession = cycle.session ?? {};
  if (nativeSession.status !== appSession.status) {
    diffs.push({
      path: '$.status',
      before: nativeSession.status,
      after: appSession.status,
      kind: 'mirror',
    });
  }
  if (nativeSession.sessionId !== appSession.id) {
    diffs.push({
      path: '$.sessionId',
      before: nativeSession.sessionId,
      after: appSession.id,
      kind: 'mirror',
    });
  }
  if (nativeSession.sessionStartedAtMs !== appSession.startedAtMs) {
    diffs.push({
      path: '$.sessionStartedAtMs',
      before: nativeSession.sessionStartedAtMs,
      after: appSession.startedAtMs,
      kind: 'mirror',
    });
  }
  const nativeSegments = Array.isArray(nativeSession.segments) ? nativeSession.segments : [];
  const appSegments = Array.isArray(appSession.segments) ? appSession.segments : [];
  if (nativeSegments.length !== appSegments.length) {
    diffs.push({
      path: '$.segments.length',
      before: nativeSegments.length,
      after: appSegments.length,
      kind: 'mirror',
    });
  }
  const length = Math.min(nativeSegments.length, appSegments.length);
  for (let index = 0; index < length; index += 1) {
    const segmentDiffs = [];
    deepDiff(
      projectSegment(nativeSegments[index]),
      projectSegment(appSegments[index]),
      `$.segments[${index}]`,
      100,
      segmentDiffs,
    );
    for (const diff of segmentDiffs) diffs.push({ ...diff, kind: 'mirror' });
  }
  return { ok: diffs.length === 0, diffs, note: null };
}

export function compareSnapshots(before, after, options = {}) {
  const limit =
    Number.isSafeInteger(options.maxDiffs) && options.maxDiffs > 0 ? options.maxDiffs : 200;
  const appDiffs = deepDiff(
    before?.app?.data ?? null,
    after?.app?.data ?? null,
    '$.appData',
    limit,
  );
  const nativeDiffs = deepDiff(
    before?.native?.state ?? null,
    after?.native?.state ?? null,
    '$.nativeSession',
    limit,
  );
  const mirrorBefore = mirrorDiff(before);
  const mirrorAfter = mirrorDiff(after);
  const mirrorOk = mirrorBefore.ok && mirrorAfter.ok;
  const diffs = [...appDiffs, ...nativeDiffs, ...mirrorBefore.diffs, ...mirrorAfter.diffs].slice(
    0,
    limit,
  );
  const equal =
    appDiffs.length === 0 &&
    nativeDiffs.length === 0 &&
    mirrorOk &&
    isPlainObject(before?.app?.data) &&
    isPlainObject(after?.app?.data) &&
    before?.app?.exists === true &&
    after?.app?.exists === true &&
    !before?.app?.parseError &&
    !after?.app?.parseError &&
    !before?.native?.parseError &&
    !after?.native?.parseError;
  return {
    schema: 'mumu-e2e-compare/v1',
    generatedAtMs: options.clock ? options.clock() : Date.now(),
    equal,
    appDataEqual: appDiffs.length === 0,
    nativeSessionEqual: nativeDiffs.length === 0,
    mirrorConsistent: mirrorOk,
    mirrorBeforeConsistent: mirrorBefore.ok,
    mirrorAfterConsistent: mirrorAfter.ok,
    mirrorNote: mirrorAfter.note ?? mirrorBefore.note,
    diffCount: diffs.length,
    diffs,
    summary: {
      before: summarizeSnapshot(before),
      after: summarizeSnapshot(after),
      package: {
        before: before?.packageInfo ?? null,
        after: after?.packageInfo ?? null,
      },
    },
  };
}

// On initialization/foreground refresh, applyLiveState in application/records.ts
// sets updatedAtMs = clock.now() on the native cycle. No other persisted change
// is expected. The capture times bound that write; if the host/device clocks
// disagree beyond this interval, leave the comparison failed rather than guess.
// This policy is never used for the install-only comparison.
export function compareRefreshSnapshots(before, after, options = {}) {
  const strictComparison = compareSnapshots(before, after, options);
  let allowance = null;
  const native = before?.native?.state;
  const cycleId = native?.cycleId;
  const beforeCycles = before?.app?.data?.cycles;
  const afterCycles = after?.app?.data?.cycles;
  if (
    !strictComparison.equal &&
    strictComparison.nativeSessionEqual &&
    strictComparison.mirrorConsistent &&
    typeof cycleId === 'string' &&
    cycleId !== '' &&
    ['running', 'ended'].includes(native.status) &&
    Array.isArray(beforeCycles) &&
    Array.isArray(afterCycles)
  ) {
    const index = beforeCycles.findIndex((cycle) => cycle.id === cycleId);
    const previous = beforeCycles[index];
    const refreshed = afterCycles[index];
    const lower = before.capturedAtMs;
    const upper = after.capturedAtMs;
    if (
      previous?.closedAtMs === null &&
      refreshed?.closedAtMs === null &&
      refreshed.id === cycleId &&
      beforeCycles.filter((cycle) => cycle.id === cycleId).length === 1 &&
      afterCycles.filter((cycle) => cycle.id === cycleId).length === 1 &&
      [lower, upper, previous.updatedAtMs, refreshed.updatedAtMs].every(Number.isSafeInteger) &&
      previous.updatedAtMs <= lower &&
      refreshed.updatedAtMs > previous.updatedAtMs &&
      refreshed.updatedAtMs >= lower &&
      refreshed.updatedAtMs <= upper
    ) {
      const normalized = structuredClone(after);
      normalized.app.data.cycles[index].updatedAtMs = previous.updatedAtMs;
      // Recompare the entire state, not a filtered or truncated list of diffs.
      if (compareSnapshots(before, normalized, options).equal) {
        allowance = {
          kind: 'current-native-cycle-refresh-timestamp',
          path: `$.appData.cycles[${index}].updatedAtMs`,
          cycleId,
          beforeMs: previous.updatedAtMs,
          afterMs: refreshed.updatedAtMs,
          captureWindowMs: [lower, upper],
        };
      }
    }
  }
  return {
    schema: 'mumu-e2e-refresh-compare/v1',
    equal: strictComparison.equal || allowance !== null,
    strictEqual: strictComparison.equal,
    diffCount: strictComparison.diffCount,
    strictComparison,
    allowance,
  };
}

function safeLabel(label) {
  return (
    String(label ?? 'snapshot')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'snapshot'
  );
}

/** Read app JSON + native prefs through run-as and persist a local snapshot. */
export function readSnapshot(device, options) {
  const evidenceDir = path.resolve(options.evidenceDir);
  const label = safeLabel(options.label);
  const clock = options.clock ?? Date.now;
  const rawAllowed = assertRawDataAuthorized(options.allowRawData);
  assertNoProductionBackupPath(evidenceDir);
  device.verifyIdentity();

  const app = device.readFile(APP_DATA_PATH);
  const nativeRaw = device.readFile(NATIVE_PREFS_PATH);
  const packageInfo = parsePackageInfo(device.dumpsysPackage().stdout);

  let appData = null;
  let parseError = null;
  if (app.exists && app.text !== null) {
    try {
      appData = JSON.parse(stripBom(app.text).trim());
    } catch (error) {
      parseError = `app JSON parse failed: ${error.message}`;
    }
  }
  const native = nativeRaw.exists
    ? parseNativePrefs(nativeRaw.text)
    : { exists: false, state: null, raw: null, error: 'native prefs missing' };

  const snapshot = {
    schema: 'mumu-e2e-snapshot/v1',
    label,
    capturedAtMs: clock(),
    identity: device.identity(),
    packageInfo,
    app: {
      exists: app.exists,
      bytes: app.bytes,
      data: appData,
      parseError,
      textPresent: app.text !== null,
      accessError: app.exists ? null : (app.stderr ?? '').trim().slice(0, 200) || null,
    },
    native: {
      exists: nativeRaw.exists,
      bytes: nativeRaw.bytes,
      state: native.state,
      parseError: native.error,
      accessError: nativeRaw.exists ? null : (nativeRaw.stderr ?? '').trim().slice(0, 200) || null,
    },
  };

  // Snapshot contents stay in memory for comparison. On disk we persist only
  // counts/labels by default; raw app JSON and native prefs are written only
  // when the caller passed the explicit `synthetic` token.
  mkdirSync(evidenceDir, { recursive: true });
  const summaryPath = path.join(evidenceDir, `${label}-summary.json`);
  const files = { primary: summaryPath, summary: summaryPath };
  let rawFiles = null;
  if (rawAllowed) {
    files.snapshot = path.join(evidenceDir, `${label}-snapshot.json`);
    if (app.exists) files.appData = path.join(evidenceDir, `${label}-data.json`);
    if (nativeRaw.exists) files.nativeXml = path.join(evidenceDir, `${label}-native.xml`);
    if (files.appData) writeFileSync(files.appData, app.text);
    if (files.nativeXml) writeFileSync(files.nativeXml, nativeRaw.text);
    writeFileSync(files.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`);
    rawFiles = {
      snapshot: files.snapshot,
      appData: files.appData ?? null,
      nativeXml: files.nativeXml ?? null,
    };
  }
  const summaryDocument = {
    schema: 'mumu-e2e-snapshot-summary/v1',
    label,
    capturedAtMs: snapshot.capturedAtMs,
    identity: snapshot.identity,
    packageInfo: snapshot.packageInfo,
    summary: summarizeSnapshot(snapshot),
    rawData: rawAllowed,
    rawFiles,
  };
  writeFileSync(summaryPath, `${JSON.stringify(summaryDocument, null, 2)}\n`);
  return { snapshot, files, summary: summarizeSnapshot(snapshot), rawAllowed };
}

export function loadSnapshotFile(filePath) {
  const snapshot = readJsonFile(filePath);
  if (snapshot?.schema === 'mumu-e2e-snapshot-summary/v1') {
    throw new MumuGuardError(
      'SNAPSHOT_SUMMARY',
      `${filePath} is summary-only; regenerate a full snapshot with --allow-raw-data synthetic for offline comparison`,
    );
  }
  if (snapshot?.schema !== 'mumu-e2e-snapshot/v1') {
    throw new MumuGuardError(
      'SNAPSHOT_SCHEMA',
      `${filePath} is not a mumu-e2e snapshot (schema=${JSON.stringify(snapshot?.schema)})`,
    );
  }
  if (
    !snapshot.app ||
    snapshot.app.data === undefined ||
    !snapshot.native ||
    snapshot.native.state === undefined
  ) {
    throw new MumuGuardError(
      'SNAPSHOT_INCOMPLETE',
      `${filePath} lacks full app/native state; regenerate with --allow-raw-data synthetic`,
    );
  }
  return snapshot;
}

/** Drop raw diff values from an on-disk report; keep counts and flags. */
export function comparisonSummary(comparison) {
  if (!comparison) return null;
  const summary = { ...comparison, diffsOmitted: true };
  delete summary.diffs;
  if (summary.strictComparison) {
    summary.strictComparison = comparisonSummary(summary.strictComparison);
  }
  return summary;
}

/** Full strict before/after snapshot around `adb install -r`. */
export function upgradeAndCompare(device, options) {
  const evidenceDir = path.resolve(options.evidenceDir);
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? sleepMs;
  const rawAllowed = assertRawDataAuthorized(options.allowRawData);
  if (options.preflight && options.preflight.packageName !== device.packageName) {
    throw new MumuGuardError(
      'APK_PACKAGE_MISMATCH',
      `preflight package ${options.preflight.packageName} does not match device package ${device.packageName}`,
    );
  }
  const before = readSnapshot(device, {
    evidenceDir,
    label: 'upgrade-before',
    clock,
    allowRawData: options.allowRawData,
  });
  if (!before.snapshot.packageInfo?.installed) {
    throw new MumuGuardError(
      'PACKAGE_NOT_INSTALLED',
      `test package ${device.packageName} is not installed; install the baseline APK before testing an upgrade`,
    );
  }
  if (!before.snapshot.app.exists) {
    throw new MumuGuardError(
      'APP_DATA_MISSING',
      'baseline app data is missing through run-as; use a debuggable candidate/debug baseline or an app-provided export for readback',
    );
  }
  device.verifyIdentity();
  const install = device.installUpgrade(options.apkPath);
  const after = readSnapshot(device, {
    evidenceDir,
    label: 'upgrade-after',
    clock,
    allowRawData: options.allowRawData,
  });
  const comparison = compareSnapshots(before.snapshot, after.snapshot, { clock });
  let launch = null;
  let launched = null;
  if (options.launch === true && comparison.equal) {
    device.launchApp();
    sleep(options.launchWaitMs ?? 2000);
    launch = device.assertForeground();
    launched = readSnapshot(device, {
      evidenceDir,
      label: 'upgrade-launched',
      clock,
      allowRawData: options.allowRawData,
    });
  }
  const launchedComparison = launched
    ? compareRefreshSnapshots(after.snapshot, launched.snapshot, { clock })
    : null;
  const report = {
    schema: 'mumu-e2e-upgrade/v1',
    generatedAtMs: clock(),
    apk: path.basename(install.apk),
    installOutput: install.output,
    preflight: options.preflight ?? null,
    before: before.summary,
    after: after.summary,
    launched: launched?.summary ?? null,
    foregroundAfterLaunch: launch,
    rawData: rawAllowed,
    comparison: rawAllowed ? comparison : comparisonSummary(comparison),
    launchedComparison: launchedComparison
      ? rawAllowed
        ? launchedComparison
        : comparisonSummary(launchedComparison)
      : null,
    equal: comparison.equal && (launchedComparison ? launchedComparison.equal : true),
  };
  mkdirSync(evidenceDir, { recursive: true });
  const reportPath = path.join(evidenceDir, 'upgrade-report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return { report, reportPath, before, after, launched, comparison, launchedComparison };
}

export function backupFilename(nowMs) {
  return `waketime-backup-${new Date(nowMs).toISOString().slice(0, 10)}.json`;
}

export function dayFilename(cycleId, extension) {
  return `waketime-${String(cycleId).replace(/[^A-Za-z0-9._-]/g, '-')}.${extension}`;
}

export function validateBackupExport(device, filePath, expectedCycles) {
  const read = device.readFileRaw(EXPORT_PREFIX + filePath);
  if (!read.exists) {
    return {
      ok: false,
      kind: 'backup',
      file: filePath,
      error: 'backup file not found in app cache',
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(stripBom(read.data.toString('utf8')));
  } catch (error) {
    return {
      ok: false,
      kind: 'backup',
      file: filePath,
      error: `backup JSON invalid: ${error.message}`,
    };
  }
  const diffs = deepDiff(expectedCycles ?? [], parsed?.cycles ?? [], '$.cycles', 50);
  const categories = Array.isArray(parsed?.settings?.categories)
    ? parsed.settings.categories.length
    : 0;
  return {
    ok: diffs.length === 0 && categories > 0,
    kind: 'backup',
    file: filePath,
    bytes: read.bytes,
    cycles: Array.isArray(parsed?.cycles) ? parsed.cycles.length : 0,
    categories,
    cycleDiffs: diffs,
    error: diffs.length === 0 ? null : 'exported cycles differ from live persisted cycles',
  };
}

export function validateTxtExport(device, filePath, cycleId) {
  const read = device.readFileRaw(EXPORT_PREFIX + filePath);
  if (!read.exists) {
    return { ok: false, kind: 'txt', file: filePath, error: 'TXT file not found in app cache' };
  }
  const text = stripBom(read.data.toString('utf8'));
  const ok = text.trim().length > 0 && text.includes(String(cycleId)) && text.includes('清醒');
  return {
    ok,
    kind: 'txt',
    file: filePath,
    bytes: read.bytes,
    chars: text.length,
    error: ok ? null : 'TXT is empty or missing the cycle id/清醒 marker',
  };
}

export function validateJsonExport(device, filePath, cycleId) {
  const read = device.readFileRaw(EXPORT_PREFIX + filePath);
  if (!read.exists) {
    return { ok: false, kind: 'json', file: filePath, error: 'JSON file not found in app cache' };
  }
  try {
    const parsed = JSON.parse(stripBom(read.data.toString('utf8')));
    const cycles = Array.isArray(parsed?.cycles) ? parsed.cycles : [];
    const ok = cycles.length === 1 && cycles[0]?.id === cycleId;
    return {
      ok,
      kind: 'json',
      file: filePath,
      bytes: read.bytes,
      cycles: cycles.length,
      error: ok ? null : 'single-cycle JSON export is empty or has the wrong cycle id',
    };
  } catch (error) {
    return {
      ok: false,
      kind: 'json',
      file: filePath,
      error: `JSON parse failed: ${error.message}`,
    };
  }
}

export function validatePdfExport(device, filePath) {
  const read = device.readFileRaw(EXPORT_PREFIX + filePath);
  if (!read.exists) {
    return { ok: false, kind: 'pdf', file: filePath, error: 'PDF file not found in app cache' };
  }
  const data = read.data;
  const header = data.subarray(0, 5).toString('latin1');
  const ok = header === '%PDF-' && data.length > 1000;
  return {
    ok,
    kind: 'pdf',
    file: filePath,
    bytes: data.length,
    error: ok ? null : 'PDF header/size check failed',
  };
}

/** Validate a restore fixture without reading any real backup location. */
export function validateTestDataFile(filePath) {
  assertNoProductionBackupPath(filePath);
  const data = readJsonFile(filePath);
  if (typeof data?.schemaVersion !== 'number') {
    throw new MumuGuardError('TEST_DATA_SCHEMA', 'backup fixture has no numeric schemaVersion');
  }
  if (!Array.isArray(data?.cycles)) {
    throw new MumuGuardError('TEST_DATA_SCHEMA', 'backup fixture has no cycles array');
  }
  if (!Array.isArray(data?.settings?.categories)) {
    throw new MumuGuardError('TEST_DATA_SCHEMA', 'backup fixture has no settings.categories array');
  }
  return {
    ok: true,
    cycles: data.cycles.length,
    categories: data.settings.categories.length,
    schemaVersion: data.schemaVersion,
  };
}

export const dataInternals = {
  summarizeSnapshot,
  mirrorDiff,
  activeCycle,
};
