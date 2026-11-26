// Guard for the differential harness.
//
// `scripts/differential.mjs` compares the candidate tree against the isolated
// 8307835 baseline. That baseline lives outside git and needs its own
// node_modules, so fail with a clear message instead of a generic worker error.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseline = path.join(
  repoRoot,
  '.superpowers',
  'sdd',
  '2026-11-26-engineering-refactor',
  'baseline-8307835',
);

const checks = [
  [baseline, 'isolated baseline tree'],
  [path.join(baseline, 'package.json'), 'baseline package.json'],
  [path.join(baseline, 'node_modules'), 'baseline node_modules'],
];

const missing = checks.filter(([target]) => !existsSync(target));

if (missing.length > 0) {
  console.error('[test:differential] FAIL — isolated baseline is not available:');
  for (const [target, label] of missing) console.error(`  - missing ${label}: ${target}`);
  console.error(
    '[test:differential] Create it with the Task 0 baseline procedure ' +
      '(git archive 8307835 into the ledger, then npm ci inside it), then rerun.',
  );
  process.exit(1);
}

console.log(`[test:differential] baseline present: ${baseline}`);
