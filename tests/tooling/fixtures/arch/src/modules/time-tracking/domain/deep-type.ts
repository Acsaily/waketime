// Synthetic type-only cross-module deep import through a file (not index.ts).
// Used only by scripts/arch-selftest.mjs.
import type { classify } from '../../classification/domain/classify';

export type DeepType = typeof classify;
