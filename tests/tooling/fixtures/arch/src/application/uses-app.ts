// Wrong direction: application must not depend on the assembly layer.
// Used only by scripts/arch-selftest.mjs.
import { assembly } from '../app/assembly';

export const usesApp = assembly;
