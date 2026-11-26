// Wrong direction: a type-only dependency on the legacy native bridge is
// still a concrete legacy dependency. Used only by scripts/arch-selftest.mjs.
import type { nativeContract } from '../native/contracts';

export type NativeContract = typeof nativeContract;
