// Legal same-module import: deep imports inside one module are allowed.
// Used only by scripts/arch-selftest.mjs.
import { pure } from './pure';

export const legalSame = pure;
