// Synthetic wrong-direction import: a domain file must not reach into the
// application layer. Used only by scripts/arch-selftest.mjs.
import { op } from '../../../application/op';

export const pure = op;
