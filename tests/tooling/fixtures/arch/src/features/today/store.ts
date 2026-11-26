// Wrong direction: UI must not write through legacy persistence directly.
// Used only by scripts/arch-selftest.mjs.
import { data } from '../../data/store';

export const store = data;
