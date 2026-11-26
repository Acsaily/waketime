// Synthetic type-only cycle, part B. Used only by scripts/arch-selftest.mjs.
import type { CycleA } from './cycle-a';

export type CycleB = { a?: CycleA };
