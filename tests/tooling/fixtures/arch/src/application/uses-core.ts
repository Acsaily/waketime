// Wrong direction: application must not depend on legacy core helpers.
// Used only by scripts/arch-selftest.mjs.
import { legacyTime } from '../core/time';

export const usesCore = legacyTime;
