// Wrong direction: application must not depend on the legacy store concrete
// implementation. Used only by scripts/arch-selftest.mjs.
import { data } from '../data/store';

export const usesStore = data;
