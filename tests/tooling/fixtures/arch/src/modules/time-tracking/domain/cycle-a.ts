// Synthetic type-only cycle, part A. Used only by scripts/arch-selftest.mjs.
import type { CycleB } from './cycle-b';

export type CycleA = { b?: CycleB };
