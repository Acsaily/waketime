#!/usr/bin/env node
// Waketime local verification entry.
//
// This wrapper keeps package.json scripts as the source of truth. It adds:
//   - a fast daily `check` and a blocking `strict` gate;
//   - area selection for domain / application / data / contract / UI / native;
//   - the isolated 8307835 baseline rebuild/check;
//   - property seed/path replay;
//   - the explicit, repo-external production backup differential;
//   - a pass-through to the MuMu harness (read-only unless --execute is explicit).
//
// It never prints backup contents, never copies production data, and never
// changes files. `--dry-run` prints every command without executing it.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const node = process.execPath;
const baselineCommit = '8307835';
const defaultBaseline = path.join(
  root,
  '.superpowers',
  'sdd',
  '2026-11-26-engineering-refactor',
  'baseline-8307835',
);

const areaTests = {
  domain: ['tests/modules', 'tests/core'],
  application: ['tests/application', 'tests/infrastructure'],
  data: [
    'tests/data',
    'tests/infrastructure/recordStore.test.ts',
    'tests/infrastructure/codecClock.test.ts',
  ],
  contract: ['tests/contracts'],
  ui: ['tests/ui'],
  native: [],
};
const allAreas = Object.keys(areaTests);
const propertyAreas = new Set(['domain', 'application', 'data']);
const differentialAreas = new Set(['domain', 'application', 'data', 'contract']);
const nativeAreas = new Set(['native', 'contract']);
const privateZones = ['Asia/Shanghai', 'UTC', 'America/New_York'];

const HELP = `Waketime local verification entry

Usage:
  node scripts/verify.mjs <command> [options]

Commands:
  check                 Fast daily gate: typecheck + observation lint/arch + unit tests
                        Never runs format:check, property replay, differential, E2E or native.
  strict                Blocking acceptance gate: typecheck + strict lint/arch + format:check
                        + unit tests + property + differential self/baseline + browser E2E
                        + native JUnit (unless --no-native). Device E2E is separate.
  property              Run the fast-check property suite; replay with --seed/--path.
  private               Run the production-backup differential (aggregate output only).
                        Requires explicit --backup <absolute external path> --now <ms> --tz <zone>.
  baseline              Check the isolated 8307835 baseline; --rebuild recreates it.
  mumu-selftest         Run the MuMu harness fake-device safety checks (no ADB, no device).
  mumu <args>           Forward to scripts/mumu-cli.mjs. Read-only unless --execute is explicit.
  list                  List modes, areas and area-to-test mapping.
  help, --help          Show this help.

Options:
  --areas <a,b,...>     domain, application, data, contract, ui, native (repeatable).
  --dry-run             Print commands without running them.
  --with-native         check also runs :app:testDebugUnitTest.
  --no-native           strict skips :app:testDebugUnitTest (final acceptance must not use it).
  --seed <n>            property: fast-check seed (FC_SEED).
  --path <path>         property: fast-check counterexample path (FC_PATH).
  --backup <path>       private: absolute production backup path outside the repository.
  --now <epochMs>       private: fixed as-of time, at or after every record boundary.
  --tz <zone>           private: Asia/Shanghai | UTC | America/New_York.
  --dir <path>          baseline: target directory (default: isolated ledger baseline).
  --check               baseline: verify the existing baseline (default when --rebuild is absent).
  --rebuild             baseline: create the target with git archive + npm ci.

Examples:
  node scripts/verify.mjs check
  node scripts/verify.mjs check --areas ui --dry-run
  node scripts/verify.mjs strict --areas domain,application,data
  node scripts/verify.mjs property --seed 26092601 --path 12:3
  node scripts/verify.mjs private --backup E:\\backup\\waketime.json --now 1764000000000 --tz Asia/Shanghai
  node scripts/verify.mjs baseline --check
  node scripts/verify.mjs mumu -- scenario plan nav --adb <MuMu adb.exe> --instance 1 --serial <host:port>
`;

function usage(message) {
  if (message) console.error(`[verify] ERROR — ${message}`);
  console.error(HELP);
  process.exit(2);
}

function fail(message) {
  console.error(`[verify] FAIL — ${message}`);
  process.exit(1);
}

function parse(args) {
  const options = {
    areas: [],
    positional: [],
    dryRun: false,
    native: undefined,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      options.positional.push(...args.slice(index + 1));
      break;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--with-native') {
      options.native = true;
      continue;
    }
    if (arg === '--no-native') {
      options.native = false;
      continue;
    }
    if (arg === '--check') {
      options.check = true;
      continue;
    }
    if (arg === '--rebuild') {
      options.rebuild = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const key = equals > 0 ? arg.slice(2, equals) : arg.slice(2);
      const inline = equals > 0 ? arg.slice(equals + 1) : undefined;
      const value = inline ?? args[(index += 1)];
      if (value === undefined || (inline === undefined && value.startsWith('--'))) {
        usage(`missing value for --${key}`);
      }
      if (key === 'areas') {
        options.areas.push(
          ...String(value)
            .split(',')
            .map((area) => area.trim())
            .filter(Boolean),
        );
      } else if (['seed', 'path', 'backup', 'now', 'tz', 'dir'].includes(key)) {
        options[key] = value;
      } else {
        usage(`unknown option --${key}`);
      }
      continue;
    }
    options.positional.push(arg);
  }
  return options;
}

function selectedAreas(options) {
  if (options.areas.length === 0) return null;
  const unknown = options.areas.filter((area) => !allAreas.includes(area));
  if (unknown.length > 0) usage(`unknown area(s): ${unknown.join(', ')}`);
  return [...new Set(options.areas)];
}

function areaSet(areas) {
  return new Set(areas ?? allAreas);
}

function selectedTests(areas) {
  if (areas === null) return null;
  const paths = new Set();
  for (const area of areas) for (const testPath of areaTests[area]) paths.add(testPath);
  // Collapse nested selections: if tests/infrastructure is already selected,
  // do not also pass tests/infrastructure/recordStore.test.ts to Vitest.
  const ordered = [...paths].sort((a, b) => a.length - b.length);
  const kept = [];
  for (const testPath of ordered) {
    if (!kept.some((parent) => testPath.startsWith(`${parent}/`))) kept.push(testPath);
  }
  return kept;
}

function includesAny(set, triggers) {
  return set.size === 0 || [...set].some((area) => triggers.has(area));
}

function execute(label, command, args, options = {}) {
  console.log(`\n[verify] ${label}`);
  console.log(`  $ ${options.display ?? [command, ...args].join(' ')}`);
  if (options.dryRun) return;
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
    shell: options.shell ?? false,
  });
  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label}: exit ${result.status ?? result.signal}`);
}

function runNpm(label, args, options = {}) {
  execute(label, npm, args, { ...options, shell: isWin });
}

function nativeEnv() {
  const jdk = path.join(root, '.toolchain', 'jdk21');
  if (!existsSync(jdk)) {
    fail('native JUnit requires .toolchain/jdk21; do not use the system JDK 25');
  }
  const env = { JAVA_HOME: jdk };
  const sdk = path.join(root, '.toolchain', 'android-sdk');
  if (existsSync(sdk)) {
    env.ANDROID_HOME = sdk;
    env.ANDROID_SDK_ROOT = sdk;
  }
  const gradleHome = path.join(root, '.toolchain', 'gradle-home');
  if (existsSync(gradleHome)) env.GRADLE_USER_HOME = gradleHome;
  const prefs = path.join(root, '.toolchain', 'prefs');
  if (existsSync(prefs)) {
    env.JAVA_TOOL_OPTIONS = `-Djava.util.prefs.userRoot=${prefs.replace(/\\/g, '/')}`;
  }
  return env;
}

function runNative(options) {
  const gradlew = path.join(root, 'android', isWin ? 'gradlew.bat' : 'gradlew');
  if (!existsSync(gradlew)) fail('android Gradle wrapper is missing');
  execute(
    'native JUnit (:app:testDebugUnitTest)',
    gradlew,
    [':app:testDebugUnitTest', '--console=plain'],
    {
      cwd: path.join(root, 'android'),
      env: options.dryRun ? {} : nativeEnv(),
      shell: isWin,
      dryRun: options.dryRun,
    },
  );
}

function runUnitTests(areas, tests, options) {
  if (tests === null) {
    runNpm('unit tests (all)', ['test'], options);
    return;
  }
  if (tests.length === 0) return;
  runNpm(`unit tests (${areas.join(',')})`, ['run', 'test', '--', ...tests], options);
}

function runCheck(options) {
  const areas = selectedAreas(options);
  const tests = selectedTests(areas);
  const set = areaSet(areas);
  runNpm('typecheck', ['run', 'typecheck'], options);
  runNpm('lint (observation mode)', ['run', 'lint'], options);
  runNpm('architecture (observation mode)', ['run', 'arch:check'], options);
  runUnitTests(areas, tests, options);
  if (options.native ?? (areas !== null && set.has('native'))) runNative(options);
}

function runStrict(options) {
  const areas = selectedAreas(options);
  const tests = selectedTests(areas);
  const set = areaSet(areas);
  runNpm('typecheck', ['run', 'typecheck'], options);
  runNpm('lint (strict)', ['run', 'lint:strict'], options);
  runNpm('architecture (strict)', ['run', 'arch:strict'], options);
  runNpm('format (check)', ['run', 'format:check'], options);
  runUnitTests(areas, tests, options);
  if (includesAny(set, propertyAreas)) {
    runNpm('property (replay with --seed/--path)', ['run', 'test:property'], options);
  }
  if (includesAny(set, differentialAreas)) {
    runNpm(
      'differential self-test (old-v-old + perturbations)',
      ['run', 'test:differential:self'],
      options,
    );
    runNpm('differential baseline vs candidate', ['run', 'test:differential'], options);
  }
  if (includesAny(set, new Set(['ui']))) {
    runNpm('browser E2E (strict)', ['run', 'test:e2e:strict'], options);
  }
  if (options.native ?? includesAny(set, nativeAreas)) runNative(options);
  console.log(
    '\n[verify] note: MuMu/APK E2E is not part of this local gate. Run the explicit device command when authorized.',
  );
}

function runPrivate(options) {
  if (!options.backup) usage('private requires --backup <absolute path>');
  if (!path.isAbsolute(options.backup)) usage('--backup must be an absolute path');
  if (!options.now) usage('private requires --now <epochMs>');
  if (!options.tz) usage('private requires --tz <zone>');
  const now = Number(options.now);
  if (!Number.isSafeInteger(now) || now <= 0)
    usage('--now must be a positive safe integer epoch ms');
  if (!privateZones.includes(options.tz)) usage(`--tz must be one of ${privateZones.join(', ')}`);
  const backup = path.resolve(options.backup);
  if (!existsSync(backup)) fail('private backup file does not exist');
  const relative = path.relative(root, backup);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    fail('private backup must live outside the repository');
  }
  execute(
    'private differential (aggregate output; original must stay unchanged)',
    node,
    ['scripts/differential.mjs', '--backup', backup, '--now', String(now), '--tz', options.tz],
    {
      dryRun: options.dryRun,
      display: `node scripts/differential.mjs --backup <external-backup> --now ${now} --tz ${options.tz}`,
    },
  );
}

function runProperty(options) {
  const env = {};
  if (options.seed !== undefined) {
    const seed = Number(options.seed);
    if (!Number.isSafeInteger(seed) || seed < 0)
      usage('--seed must be a non-negative safe integer');
    env.FC_SEED = String(seed);
  }
  if (options.path !== undefined) env.FC_PATH = String(options.path);
  runNpm('property replay', ['run', 'test:property'], { ...options, env });
}

function runBaseline(options) {
  const dir = options.dir ? path.resolve(options.dir) : defaultBaseline;
  if (!options.rebuild) {
    const checks = [dir, path.join(dir, 'package.json'), path.join(dir, 'node_modules')];
    const missing = checks.filter((target) => !existsSync(target));
    if (missing.length > 0) {
      fail(
        `baseline missing: ${missing.join(', ')}. Rebuild with: node scripts/verify.mjs baseline --rebuild`,
      );
    }
    console.log(`[verify] baseline present: ${dir}`);
    return;
  }
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    fail(`baseline target already exists and is not empty: ${dir}; refusing to overwrite`);
  }
  console.log(`[verify] rebuilding isolated baseline ${baselineCommit}`);
  console.log(`  $ git archive --format=tar ${baselineCommit} | tar -x -C ${dir}`);
  console.log(`  $ npm ci  (cwd ${dir})`);
  if (options.dryRun) return;
  mkdirSync(dir, { recursive: true });
  const archive = spawnSync('git', ['archive', '--format=tar', baselineCommit], {
    cwd: root,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (archive.error || archive.status !== 0) {
    fail(`git archive failed: ${archive.error?.message ?? archive.status}`);
  }
  const untar = spawnSync('tar', ['-x', '-C', dir], { input: archive.stdout });
  if (untar.error || untar.status !== 0) {
    fail(`tar extraction failed: ${untar.error?.message ?? untar.status}`);
  }
  const install = spawnSync(npm, ['ci'], {
    cwd: dir,
    stdio: 'inherit',
    shell: isWin,
    env: { ...process.env },
  });
  if (install.error || install.status !== 0) {
    fail(`npm ci failed: ${install.error?.message ?? install.status}`);
  }
  console.log('[verify] baseline rebuilt');
}

function runMumu(args) {
  execute('MuMu harness (read-only unless --execute is explicit)', node, [
    'scripts/mumu-cli.mjs',
    ...args,
  ]);
}

function printList() {
  console.log('Modes: check, strict, property, private, baseline, mumu-selftest, mumu');
  console.log(`Areas: ${allAreas.join(', ')}`);
  console.log('Area -> Vitest paths:');
  for (const area of allAreas) {
    const paths = areaTests[area];
    console.log(`  ${area}: ${paths.length > 0 ? paths.join(', ') : '(native JUnit only)'}`);
  }
  console.log('Property gates: domain, application, data');
  console.log('Differential gates: domain, application, data, contract');
  console.log('Browser E2E gate: ui');
  console.log('Native JUnit gate: native, contract');
}

const argv = process.argv.slice(2);
const command = argv[0];

if (!command || command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP);
  process.exit(0);
}

if (command === 'list') {
  printList();
  process.exit(0);
}

if (command === 'mumu') {
  const args = argv.slice(1);
  if (args[0] === '--') args.shift();
  runMumu(args);
  process.exit(0);
}

if (command === 'mumu-selftest') {
  runMumu(['selftest']);
  process.exit(0);
}

const options = parse(argv.slice(1));
if (options.help) {
  console.log(HELP);
  process.exit(0);
}

switch (command) {
  case 'check':
    runCheck(options);
    break;
  case 'strict':
    runStrict(options);
    break;
  case 'property':
    runProperty(options);
    break;
  case 'private':
    runPrivate(options);
    break;
  case 'baseline':
    runBaseline(options);
    break;
  default:
    usage(`unknown command ${JSON.stringify(command)}`);
}

console.log('\n[verify] PASS');
