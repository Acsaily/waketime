// Synthetic wrong-direction import: classification must not depend on
// time-tracking implementation. Used only by scripts/arch-selftest.mjs.
import { track } from '../../time-tracking/index';

export const classify = track;
