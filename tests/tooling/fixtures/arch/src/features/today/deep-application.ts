// Wrong direction: UI must not deep-import the application layer.
// Used only by scripts/arch-selftest.mjs.
import { op } from '../../application/op';

export const deepApplication = op;
