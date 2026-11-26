#!/usr/bin/env node
// MuMu native E2E harness CLI.
//
// This is preparation for Task 6/7. Read-only commands (identity, observe,
// snapshot) may run when the operator points them at the authorized instance.
// Physical actions (tap, swipe, scenario run, upgrade) require --execute and
// always target the explicit serial. Without --execute they print a plan.
//
// Exit codes: 0 ok/planned, 2 usage, 7 blocked/needs-agent, 8 failed,
//             9 snapshot mismatch.

import { existsSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ACTIVITY,
  DEFAULT_PACKAGE,
  MumuGuardError,
  createMumuDevice,
  isPackageName,
  resolveEvidenceDir,
} from './mumu-guard.mjs';
import { createObserver, parsePoint, selectorFromOptions } from './mumu-observe.mjs';
import {
  compareSnapshots,
  assertRawDataAuthorized,
  loadSnapshotFile,
  preflightCandidateApk,
  readSnapshot,
  upgradeAndCompare,
  validateTestDataFile,
} from './mumu-data.mjs';
import { planScenario, runScenario, scenarioNames } from './mumu-scenarios.mjs';
import { parseArgv } from './mumu-args.mjs';

const HELP = `MuMu native E2E harness (preparation; no device action without --execute)

Usage:
  node scripts/mumu-cli.mjs <command> [options]

Read-only:
  identity       Verify MuMuManager identity + explicit adb serial
  observe        Fresh UIAutomator tree + screenshot, saved as evidence
  snapshot       Persisted-state summary; full JSON only with --allow-raw-data synthetic
  compare        Compare two full snapshot JSON files (--allow-raw-data synthetic)

Physical actions (require --execute; dry-run prints the plan):
  tap            Tap an element from a fresh tree, or the latest screenshot
  swipe          Agent-driven swipe from the latest screenshot
  scenario run   Run a repeatable navigation/flow scenario
  upgrade        adb install -r with before/after persisted-state comparison

Upgrade preflight (explicit external tools; no auto-discovery):
  --aapt <path>                aapt executable used for 'dump badging'
  --apksigner <path>           apksigner executable used for '--print-certs'
  --baseline-apk <path>        Compare the candidate cert to this baseline APK
  --expected-cert-sha256 <hex> Compare the candidate cert to a known SHA-256

Other:
  scenario list | scenario plan <name>
  validate-test-data --file <synthetic-backup.json>
  selftest       Fake-device safety/CLI checks; never touches ADB or MuMu
  --help

Device options:
  --adb <path>            MuMu adb.exe (explicit, required for live commands)
  --manager <path>        MuMuManager.exe (default: next to adb)
  --instance <index>      Authorized MuMu instance index (e.g. 1)
  --serial <host:port>    Verified serial (e.g. 127.0.0.1:16416)
  --instance-name <name>  Optional expected MuMu instance name
  --package <pkg>         Test package (default ${DEFAULT_PACKAGE})
  --evidence-dir <dir>    Git-ignored local evidence dir (default test-results/mumu-e2e/<run>)
  --allow-foreground <pkg>  Repeatable; permit input while <pkg> is focused
                            (default: test package; system surfaces must be explicit,
                            e.g. com.android.systemui for the notification shade)
  --allow-raw-data synthetic  Persist full app JSON/native prefs for authorized
                            synthetic test data only; default is summary/counts
  --json                  Machine-readable output

Observe options:
  --name <label>           Evidence label
  --expect-text/--expect-contains <value>   Repeatable; missing text exits 7
  --require-package        Require the test package in the fresh tree

Tap options:
  --text/--content-desc/--resource-id/--class <value>
  --text-contains/--content-desc-contains <value>
  --expect-text/--expect-contains <value>   Repeatable; checked after the action
  --settle-ms <ms>
  --coords <x,y> --from-shot <png> [--max-shot-age-ms <ms>]   Agent visual fallback
  --allow-any-package     Do not require the app package in the fresh tree
  Input is refused unless the focused package is allowed; add
  --allow-foreground <pkg> for an intentional system surface.

Scenario options:
  --execute               Actually act on the authorized instance
`;

/** Minimal repeatable-safe flag parser. */
export { parseArgv };

function list(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function required(options, key) {
  const value = options[key];
  if (value === undefined || value === true || value === '') {
    throw new MumuGuardError('CLI_ARG', `missing required --${key}`);
  }
  return String(value);
}

function flag(options, key) {
  return options[key] === true || options[key] === 'true';
}

function allowedForegroundList(options) {
  const values = list(options['allow-foreground']);
  for (const value of values) {
    if (!isPackageName(value)) {
      throw new MumuGuardError('CLI_ARG', `invalid --allow-foreground package: ${value}`);
    }
  }
  return values;
}

function print(options, json, human) {
  if (flag(options, 'json')) {
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  } else {
    process.stdout.write(`${human}\n`);
  }
}

function deviceOptions(options, evidenceDir) {
  return {
    adbPath: required(options, 'adb'),
    managerPath: options.manager ? String(options.manager) : undefined,
    instance: Number(required(options, 'instance')),
    serial: required(options, 'serial'),
    instanceName: options['instance-name'] ? String(options['instance-name']) : undefined,
    packageName: options.package ? String(options.package) : DEFAULT_PACKAGE,
    activity: options.activity ? String(options.activity) : DEFAULT_ACTIVITY,
    evidenceDir,
  };
}

function ensureEvidence(options) {
  const fromShot = options['from-shot'];
  const explicit = options['evidence-dir']
    ? String(options['evidence-dir'])
    : fromShot
      ? path.dirname(path.resolve(String(fromShot)))
      : undefined;
  return resolveEvidenceDir({ dir: explicit });
}

function writeRunMetadata(evidenceDir, identity, options) {
  if (!evidenceDir) return;
  writeFileSync(
    path.join(evidenceDir, 'run.json'),
    `${JSON.stringify(
      {
        schema: 'mumu-e2e-run/v1',
        createdAtMs: Date.now(),
        identity,
        packageName: options.package ? String(options.package) : DEFAULT_PACKAGE,
        inputKinds: ['adb-shell', 'adb-exec-out'],
        physicalPointer: false,
        rawData: options['allow-raw-data'] === 'synthetic',
      },
      null,
      2,
    )}\n`,
  );
}

function live(options, optionsArg = {}) {
  const evidenceDir = ensureEvidence(options);
  const device = createMumuDevice(deviceOptions(options, evidenceDir));
  const identity = device.verifyIdentity();
  writeRunMetadata(evidenceDir, identity, options);
  const observer = optionsArg.observer === false ? null : createObserver(device, { evidenceDir });
  return { device, identity, observer, evidenceDir };
}

function requireExecute(options) {
  if (!flag(options, 'execute')) {
    return false;
  }
  return true;
}

function selectorFromCli(options) {
  const selector = selectorFromOptions(options);
  if (Object.keys(selector).length === 0) {
    throw new MumuGuardError('CLI_ARG', 'tap needs a text/desc/id/class selector or --coords');
  }
  return selector;
}

function commandIdentity(options) {
  const evidenceDir = options['evidence-dir'] ? ensureEvidence(options) : null;
  const device = createMumuDevice(deviceOptions(options, evidenceDir));
  const identity = device.verifyIdentity();
  writeRunMetadata(evidenceDir, identity, options);
  const info = {
    identity,
    foreground: device.foregroundPackage(),
  };
  print(
    options,
    info,
    `identity ok: instance ${identity.instance} ${identity.instanceName ?? ''} ` +
      `serial=${identity.serial} sdk=${identity.androidSdk ?? '?'} foreground=${info.foreground ?? '?'}`,
  );
  return 0;
}

function commandObserve(options) {
  const { observer, identity, evidenceDir } = live(options);
  const observation = observer.observe({
    name: options.name ? String(options.name) : 'observe',
    requirePackage: flag(options, 'require-package'),
    expectText: list(options['expect-text']),
    expectContains: list(options['expect-contains']),
  });
  const missing =
    observation.expectations.missingText.length + observation.expectations.missingContains.length;
  const packageMissing = flag(options, 'require-package') && !observation.packagePresent;
  print(
    options,
    { identity, evidenceDir, observation: { ...observation, nodes: undefined } },
    [
      `observe ${observation.name}: tree=${observation.treeAvailable} package=${observation.packagePresent} ` +
        `${observation.width}x${observation.height} rotation=${observation.rotation}`,
      `png=${observation.pngPath}`,
      `xml=${observation.xmlPath ?? '(none)'}`,
      observation.warnings.length ? `warnings: ${observation.warnings.join('; ')}` : '',
      missing ? `MISSING expectations: ${JSON.stringify(observation.expectations)}` : '',
      packageMissing ? `MISSING package ${DEFAULT_PACKAGE} in fresh tree` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return missing || packageMissing ? 7 : 0;
}

function commandTap(options) {
  const hasCoords = options.coords !== undefined;
  const allowForeground = allowedForegroundList(options);
  if (hasCoords && !options['from-shot']) {
    throw new MumuGuardError('CLI_ARG', 'visual tap needs --from-shot <latest observation png>');
  }
  if (!hasCoords) selectorFromCli(options);
  if (!requireExecute(options)) {
    print(
      options,
      {
        action: 'tap',
        execute: false,
        selector: hasCoords ? null : selectorFromCli(options),
        coords: options.coords ?? null,
        allowedForeground: allowForeground,
      },
      `dry-run tap: ${hasCoords ? `visual ${options.coords}` : JSON.stringify(selectorFromCli(options))} ` +
        `allowedForeground=${allowForeground.length ? allowForeground.join(',') : `${DEFAULT_PACKAGE} (default)`} ` +
        '(pass --execute to act)',
    );
    return 0;
  }
  const { observer, identity, evidenceDir } = live(options);
  let result;
  if (hasCoords) {
    const point = parsePoint(options.coords, '--coords');
    result = observer.tapVisual({
      name: options.name ? String(options.name) : 'tap-visual',
      x: point.x,
      y: point.y,
      fromShot: String(options['from-shot']),
      maxShotAgeMs: Number(options['max-shot-age-ms'] ?? 15_000),
      settleMs: Number(options['settle-ms'] ?? 700),
      expectText: list(options['expect-text']),
      expectContains: list(options['expect-contains']),
      allowedForeground: allowForeground,
    });
  } else {
    result = observer.tap({
      name: options.name ? String(options.name) : 'tap',
      selector: selectorFromCli(options),
      requirePackage: !flag(options, 'allow-any-package'),
      expectText: list(options['expect-text']),
      expectContains: list(options['expect-contains']),
      settleMs: Number(options['settle-ms'] ?? 700),
      allowedForeground: allowForeground,
    });
  }
  const exitCode =
    result.status === 'ok' || result.status === 'applied'
      ? 0
      : result.status === 'unverified'
        ? 6
        : 7;
  print(
    options,
    {
      identity,
      evidenceDir,
      result: { ...result, before: undefined, after: undefined, observation: undefined },
    },
    `tap status=${result.status}${result.reason ? ` — ${result.reason}` : ''}\n` +
      `png=${result.after?.pngPath ?? result.screenshot ?? result.observation?.pngPath ?? '(none)'}`,
  );
  if (result.status === 'unverified') {
    process.stdout.write(
      `missing after tap: ${JSON.stringify(result.missing)}; input was not retried\n`,
    );
  }
  return exitCode;
}

function commandSwipe(options) {
  const from = parsePoint(options.from, '--from');
  const to = parsePoint(options.to, '--to');
  const allowForeground = allowedForegroundList(options);
  if (!options['from-shot']) throw new MumuGuardError('CLI_ARG', 'swipe needs --from-shot');
  if (!requireExecute(options)) {
    print(
      options,
      { action: 'swipe', execute: false, from, to, allowedForeground: allowForeground },
      'dry-run swipe (pass --execute to act)',
    );
    return 0;
  }
  const { observer, identity, evidenceDir } = live(options);
  const result = observer.swipeVisual({
    name: options.name ? String(options.name) : 'swipe-visual',
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
    durationMs: Number(options['duration-ms'] ?? 300),
    fromShot: String(options['from-shot']),
    maxShotAgeMs: Number(options['max-shot-age-ms'] ?? 15_000),
    settleMs: Number(options['settle-ms'] ?? 700),
    expectText: list(options['expect-text']),
    expectContains: list(options['expect-contains']),
    allowedForeground: allowForeground,
  });
  print(
    options,
    { identity, evidenceDir, result: { ...result, preflight: undefined, after: undefined } },
    `swipe status=${result.status}${result.reason ? ` — ${result.reason}` : ''}\n` +
      `png=${result.after?.pngPath ?? result.observation?.pngPath ?? '(none)'}`,
  );
  return result.status === 'applied' ? 0 : result.status === 'unverified' ? 6 : 7;
}

function commandSnapshot(options) {
  const { device, identity, evidenceDir } = live(options, { observer: false });
  const label = options.label ? String(options.label) : 'snapshot';
  const result = readSnapshot(device, {
    evidenceDir,
    label,
    allowRawData: options['allow-raw-data'],
  });
  print(
    options,
    {
      identity,
      evidenceDir,
      summary: result.summary,
      rawData: result.rawAllowed,
      files: result.files,
    },
    `snapshot ${label}: ${JSON.stringify(result.summary)} rawData=${result.rawAllowed}\n` +
      `snapshot=${result.files.primary ?? result.files.summary}`,
  );
  return 0;
}

function commandCompare(options) {
  const before = loadSnapshotFile(required(options, 'before'));
  const after = loadSnapshotFile(required(options, 'after'));
  const comparison = compareSnapshots(before, after);
  const reportPath = options.report ? path.resolve(String(options.report)) : null;
  if (reportPath) {
    if (!existsSync(path.dirname(reportPath))) {
      throw new MumuGuardError(
        'CLI_ARG',
        `report directory does not exist: ${path.dirname(reportPath)}`,
      );
    }
    // The report contains synthetic snapshot content; keep it in an ignored
    // local path rather than a tracked directory.
    resolveEvidenceDir({ dir: path.dirname(reportPath) });
    writeFileSync(reportPath, `${JSON.stringify(comparison, null, 2)}\n`);
  }
  print(
    options,
    { comparison, reportPath },
    `compare equal=${comparison.equal} appData=${comparison.appDataEqual} ` +
      `native=${comparison.nativeSessionEqual} mirror=${comparison.mirrorConsistent} ` +
      `diffs=${comparison.diffCount}${reportPath ? ` report=${reportPath}` : ''}`,
  );
  if (comparison.diffs.length) {
    for (const diff of comparison.diffs.slice(0, 20)) {
      process.stdout.write(
        `  ${diff.path}: ${JSON.stringify(diff.before)} -> ${JSON.stringify(diff.after)}\n`,
      );
    }
  }
  return comparison.equal ? 0 : 9;
}

function hasUpgradePreflightOptions(options) {
  return ['aapt', 'apksigner', 'baseline-apk', 'expected-cert-sha256'].some(
    (key) => options[key] !== undefined,
  );
}

function upgradePreflight(options, apk) {
  return preflightCandidateApk({
    apkPath: apk,
    packageName: options.package ? String(options.package) : DEFAULT_PACKAGE,
    aaptPath: required(options, 'aapt'),
    apksignerPath: required(options, 'apksigner'),
    baselineApkPath: options['baseline-apk'] ? String(options['baseline-apk']) : undefined,
    expectedCertSha256: options['expected-cert-sha256']
      ? String(options['expected-cert-sha256'])
      : undefined,
  });
}

function commandUpgrade(options) {
  const apk = required(options, 'apk');
  if (!existsSync(apk) || !statSync(apk).isFile()) {
    throw new MumuGuardError('APK_MISSING', `APK does not exist: ${path.resolve(apk)}`);
  }
  const execute = requireExecute(options);
  const wantsPreflight = execute || hasUpgradePreflightOptions(options);
  const preflight = wantsPreflight ? upgradePreflight(options, apk) : null;
  if (!execute) {
    print(
      options,
      {
        action: 'upgrade',
        execute: false,
        apk: path.resolve(apk),
        launch: flag(options, 'launch'),
        preflight,
      },
      `dry-run upgrade: ` +
        (preflight
          ? `preflight ok package=${preflight.packageName} ` +
            `cert=${preflight.certSha256[0]} ` +
            `tools=${preflight.tools.aapt}/${preflight.tools.apksigner}; `
          : 'pass --aapt, --apksigner and --baseline-apk/--expected-cert-sha256 with --execute; ') +
        `adb install -r ${path.basename(apk)} then snapshot/compare (pass --execute to act)`,
    );
    return 0;
  }
  const { device, identity, evidenceDir } = live(options, { observer: false });
  const result = upgradeAndCompare(device, {
    apkPath: apk,
    evidenceDir,
    launch: flag(options, 'launch'),
    launchWaitMs: Number(options['launch-wait-ms'] ?? 2000),
    preflight,
    allowRawData: options['allow-raw-data'],
  });
  print(
    options,
    {
      identity,
      evidenceDir,
      equal: result.report.equal,
      preflight,
      comparison: result.report.comparison,
      launchedComparison: result.report.launchedComparison,
      reportPath: result.reportPath,
    },
    `upgrade equal=${result.report.equal} ` +
      `preflight=${preflight.packageName}/${preflight.certSha256[0]} ` +
      `before=${JSON.stringify(result.report.before)} after=${JSON.stringify(result.report.after)} ` +
      (result.report.launchedComparison?.allowance
        ? `launch refresh allowance=${result.report.launchedComparison.allowance.path} (strict comparison retained); `
        : '') +
      `report=${result.reportPath}`,
  );
  return result.report.equal ? 0 : 9;
}

function commandScenario(options) {
  const [subcommand, name] = options._;
  if (!subcommand || subcommand === 'list') {
    const rows = scenarioNames().map((scenarioName) => {
      const plan = planScenario(scenarioName);
      return {
        name: scenarioName,
        title: plan.title,
        requires: plan.requires,
        completion: plan.completion,
      };
    });
    print(
      options,
      rows,
      rows
        .map((row) => `${row.name}: ${row.title} (${row.requires}) [${row.completion}]`)
        .join('\n'),
    );
    return 0;
  }
  if (subcommand === 'plan') {
    if (!name) throw new MumuGuardError('CLI_ARG', 'scenario plan needs a scenario name');
    const plan = planScenario(name);
    print(
      options,
      plan,
      [
        `${plan.name}: ${plan.title}`,
        `requires: ${plan.requires}`,
        `completion: ${plan.completion}`,
      ]
        .concat(plan.steps.map((step) => `  ${step.id} ${step.action}: ${step.description}`))
        .join('\n'),
    );
    return 0;
  }
  if (subcommand !== 'run') {
    throw new MumuGuardError('CLI_ARG', `unknown scenario subcommand ${subcommand}`);
  }
  if (!name) throw new MumuGuardError('CLI_ARG', 'scenario run needs a scenario name');
  if (!requireExecute(options)) {
    const plan = planScenario(name);
    print(
      options,
      { ...plan, execute: false },
      [`dry-run scenario ${name} (pass --execute to act)`]
        .concat(plan.steps.map((step) => `  ${step.id} ${step.action}: ${step.description}`))
        .join('\n'),
    );
    return 0;
  }
  const { device, observer, identity, evidenceDir } = live(options);
  const result = runScenario(name, {
    device,
    observer,
    evidenceDir,
    execute: true,
    allowRawData: options['allow-raw-data'],
  });
  print(
    options,
    {
      identity,
      evidenceDir,
      scenario: result.scenario,
      status: result.status,
      stopReason: result.stopReason,
      steps: result.steps,
    },
    `scenario ${name}: status=${result.status}${result.stopReason ? ` — ${result.stopReason}` : ''}\n` +
      result.steps.map((step) => `  ${step.id} ${step.status}: ${step.detail}`).join('\n') +
      `\nreport=${result.reportPath}`,
  );
  if (result.status === 'passed') return 0;
  if (result.status === 'failed') return 8;
  return 7;
}

function commandValidateTestData(options) {
  const result = validateTestDataFile(required(options, 'file'));
  print(options, result, `test data ok: ${JSON.stringify(result)}`);
  return 0;
}

export async function runCli(argv) {
  const { command, options } = parseArgv(argv);
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  try {
    if (options['allow-raw-data'] !== undefined) {
      assertRawDataAuthorized(options['allow-raw-data']);
    }
    switch (command) {
      case 'identity':
        return commandIdentity(options);
      case 'observe':
        return commandObserve(options);
      case 'tap':
        return commandTap(options);
      case 'swipe':
        return commandSwipe(options);
      case 'snapshot':
        return commandSnapshot(options);
      case 'compare':
        return commandCompare(options);
      case 'upgrade':
        return commandUpgrade(options);
      case 'scenario':
        return commandScenario(options);
      case 'validate-test-data':
        return commandValidateTestData(options);
      case 'selftest': {
        const { runSelfTest } = await import('./mumu-selftest.mjs');
        return runSelfTest({ verbose: flag(options, 'verbose') });
      }
      default:
        throw new MumuGuardError('CLI_UNKNOWN', `unknown command ${command}; use --help`);
    }
  } catch (error) {
    if (error instanceof MumuGuardError) {
      process.stderr.write(`error [${error.code}]: ${error.message}\n`);
      const usage = new Set([
        'CLI_ARG',
        'CLI_UNKNOWN',
        'SCENARIO_UNKNOWN',
        'SELECTOR_EMPTY',
        'RAW_DATA_UNAUTHORIZED',
        'APK_PREFLIGHT_TOOL',
        'APK_CERT_REFERENCE',
        'APK_CERT_DIGEST',
      ]);
      return usage.has(error.code) ? 2 : 8;
    }
    process.stderr.write(
      `error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    return 8;
  }
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
