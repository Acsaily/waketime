// Wrong direction: an external consumer must not deep-import module internals.
// Used only by scripts/arch-selftest.mjs.
import { pure } from '../../modules/time-tracking/domain/pure';

export const deep = pure;
