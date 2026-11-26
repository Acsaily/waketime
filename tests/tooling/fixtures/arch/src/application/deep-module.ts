// Wrong direction: application must not deep-import module internals.
// Used only by scripts/arch-selftest.mjs.
import { pure } from '../modules/time-tracking/domain/pure';

export const deepModule = pure;
