// Architecture rule self-test.
//
// Runs dependency-cruiser programmatically against a small synthetic tree in
// tests/tooling/fixtures/arch and asserts the exact set of violations produced
// by the shared rule set in scripts/arch-rules.mjs. It reuses the production
// rule set and options (only baseDir/tsConfig are pointed at the fixture tree)
// so the checker and its test cannot drift apart while the rules are still in
// observation mode.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cruise } from 'dependency-cruiser';
import { forbiddenRules, baseOptions } from './arch-rules.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(repoRoot, 'tests', 'tooling', 'fixtures', 'arch');
const fixtureRootPosix = fixtureRoot.replace(/\\/g, '/');

// Exact expected violations, normalized as `<rule>|<from>|<to>`.
// Legal fixtures (same-module deep imports, public index imports) must not
// appear here; any extra entry below would fail the test as a false positive.
const expected = new Set([
  // classification must not depend on time-tracking, including type-only edges.
  'classification-independent|src/modules/classification/domain/classify.ts|src/modules/time-tracking/index.ts',
  'classification-independent|src/modules/classification/domain/type-only.ts|src/modules/time-tracking/index.ts',
  // Pure domain and analytics modules must not reach framework or outer layers.
  'domain-no-framework|src/modules/analytics/index.ts|react',
  'domain-no-framework|src/modules/time-tracking/domain/legacy-export.ts|src/export/format.ts',
  'domain-no-framework|src/modules/time-tracking/domain/legacy.ts|src/core/time.ts',
  'domain-no-framework|src/modules/time-tracking/domain/pure.ts|src/application/op.ts',
  // Every module — including public indexes and non-domain helpers — must stay
  // framework-free; these are type-only and value edges respectively.
  'module-no-ui-app|src/modules/analytics/index.ts|react',
  'module-no-ui-app|src/modules/classification/index.ts|react',
  'module-no-ui-app|src/modules/time-tracking/index.ts|react',
  'module-no-ui-app|src/modules/time-tracking/format.ts|@capacitor/core',
  // Domain modules must not depend on UI/assembly/adapters/legacy.
  'module-no-ui-app|src/modules/time-tracking/domain/legacy-export.ts|src/export/format.ts',
  'module-no-ui-app|src/modules/time-tracking/domain/legacy.ts|src/core/time.ts',
  'module-no-ui-app|src/modules/time-tracking/domain/pure.ts|src/application/op.ts',
  // Cross-module deep imports are forbidden, including type-only edges.
  'module-public-api-only|src/modules/time-tracking/domain/deep-type.ts|src/modules/classification/domain/classify.ts',
  // External consumers (including the app assembly) must use module public indexes.
  'external-module-public-api-only|src/application/deep-module.ts|src/modules/time-tracking/domain/pure.ts',
  'external-module-public-api-only|src/app/uses-module-type.ts|src/modules/time-tracking/domain/pure.ts',
  'external-module-public-api-only|src/app/uses-module.ts|src/modules/time-tracking/domain/pure.ts',
  'external-module-public-api-only|src/features/today/deep.ts|src/modules/time-tracking/domain/pure.ts',
  'external-module-public-api-only|src/infrastructure/uses-module.ts|src/modules/time-tracking/domain/pure.ts',
  'external-module-public-api-only|src/shared/deep-module.ts|src/modules/time-tracking/domain/pure.ts',
  // UI/assembly must use the application public index.
  'application-public-api-only|src/features/today/deep-application.ts|src/application/op.ts',
  // application must not depend on UI, assembly, concrete adapters or React.
  'application-layer-boundary|src/application/uses-app.ts|src/app/assembly.ts',
  'application-layer-boundary|src/application/uses-feature.ts|src/features/today/legal.ts',
  'application-layer-boundary|src/application/uses-infra.ts|src/infrastructure/files.ts',
  'application-layer-boundary|src/application/uses-react.ts|react',
  // application must not import the legacy store/native/state/export/core trees,
  // including type-only edges (uses-native-type).
  'application-layer-boundary|src/application/uses-core.ts|src/core/time.ts',
  'application-layer-boundary|src/application/uses-export.ts|src/export/format.ts',
  'application-layer-boundary|src/application/uses-native-type.ts|src/native/contracts.ts',
  'application-layer-boundary|src/application/uses-native.ts|src/native/contracts.ts',
  'application-layer-boundary|src/application/uses-state.ts|src/state/useApp.ts',
  'application-layer-boundary|src/application/uses-store.ts|src/data/store.ts',
  // UI features must not write through legacy persistence or native bridges.
  'features-no-platform-writes|src/features/today/capacitor.ts|@capacitor/filesystem',
  'features-no-platform-writes|src/features/today/store.ts|src/data/store.ts',
  // Type-only cycles must be detected as well.
  'no-circular|src/modules/time-tracking/domain/cycle-a.ts|src/modules/time-tracking/domain/cycle-b.ts',
]);

function normalize(modulePath) {
  let value = String(modulePath).replace(/\\/g, '/');
  if (value.startsWith(fixtureRootPosix)) value = value.slice(fixtureRootPosix.length);
  value = value.replace(/^\.?\//, '');
  if (/(^|\/)node_modules\/react-dom(\/|$)/.test(value) || value === 'react-dom')
    return 'react-dom';
  if (/(^|\/)node_modules\/react(\/|$)/.test(value) || value === 'react') return 'react';
  const capacitorNested = value.indexOf('node_modules/@capacitor/');
  if (capacitorNested !== -1) {
    const rest = value.slice(capacitorNested + 'node_modules/@capacitor/'.length);
    return `@capacitor/${rest.split('/')[0]}`;
  }
  if (value.startsWith('@capacitor/')) return value.split('/').slice(0, 2).join('/');
  return value;
}

// Reuse the production options verbatim, but point exclude/tsConfig at the
// isolated fixture tree instead of the repository.
const sharedOptions = { ...baseOptions };
delete sharedOptions.exclude;
delete sharedOptions.tsConfig;
const result = await cruise(['.'], {
  ...sharedOptions,
  validate: true,
  ruleSet: { forbidden: forbiddenRules },
  baseDir: fixtureRoot,
  tsConfig: { fileName: path.join(fixtureRoot, 'tsconfig.json') },
});

const output = result.output;
const violations = typeof output === 'string' ? [] : output.summary.violations;
const detected = new Set(
  violations.map((v) => `${v.rule.name}|${normalize(v.from)}|${normalize(v.to)}`),
);

const missing = [...expected].filter((key) => !detected.has(key)).sort();
const unexpected = [...detected].filter((key) => !expected.has(key)).sort();

if (missing.length > 0 || unexpected.length > 0) {
  console.error('[arch-selftest] FAIL — rule set did not match the expected fixture violations.');
  if (missing.length > 0) {
    console.error('[arch-selftest] missing expected violations:');
    for (const key of missing) console.error(`  - ${key}`);
  }
  if (unexpected.length > 0) {
    console.error('[arch-selftest] unexpected violations (false positives or drift):');
    for (const key of unexpected) console.error(`  + ${key}`);
  }
  console.error('[arch-selftest] detected:');
  for (const key of [...detected].sort()) console.error(`  * ${key}`);
  process.exit(1);
}

console.log(`[arch-selftest] PASS — ${expected.size} expected violations, no false positives.`);
for (const key of [...expected].sort()) console.log(`  - ${key}`);
