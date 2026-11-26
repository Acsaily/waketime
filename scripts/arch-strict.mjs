// Strict architecture gate.
//
// Reuses the production rule set and options but promotes every severity to
// "error". `npm run arch:check` stays in observation mode for daily work;
// `npm run arch:strict` is the executable entry for the final verify gate.
import { cruise } from 'dependency-cruiser';
import { forbiddenRules, baseOptions } from './arch-rules.mjs';

const strictRules = forbiddenRules.map((rule) => ({ ...rule, severity: 'error' }));

const result = await cruise(['src', 'tests'], {
  ...baseOptions,
  validate: true,
  ruleSet: { forbidden: strictRules },
});

const output = result.output;
const violations = typeof output === 'string' ? [] : output.summary.violations;

if (violations.length > 0) {
  console.error(`[arch-strict] FAIL — ${violations.length} architecture violation(s):`);
  for (const violation of violations) {
    console.error(`  - [${violation.rule.name}] ${violation.from} -> ${violation.to}`);
  }
  process.exit(1);
}

console.log('[arch-strict] PASS — no architecture violations.');
