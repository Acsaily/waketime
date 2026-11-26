// Synthetic wrong-direction import: a domain file must not reach legacy code.
// Used only by scripts/arch-selftest.mjs.
import { legacyTime } from '../../../core/time';

export const legacy = legacyTime;
