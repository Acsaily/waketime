// dependency-cruiser configuration — architecture dependency gate.
//
// Rules live in scripts/arch-rules.mjs so the self-test exercises the same
// rule set. All rules are observation-mode ("warn") until the legacy tree is
// migrated; see the plan (Task 0/3/7).
import { forbiddenRules, baseOptions } from './scripts/arch-rules.mjs';

export default {
  forbidden: forbiddenRules,
  options: baseOptions,
};
