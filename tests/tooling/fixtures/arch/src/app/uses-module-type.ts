// Wrong direction: a type-only deep import of module internals from app is
// still forbidden. Used only by scripts/arch-selftest.mjs.
import type { pure } from '../modules/time-tracking/domain/pure';

export type Pure = typeof pure;
