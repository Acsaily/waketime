// Synthetic type-only wrong-direction import: classification must not depend
// on time-tracking even through type imports. Used only by
// scripts/arch-selftest.mjs.
import type { track } from '../../time-tracking/index';

export type Track = typeof track;
