// Wrong direction: application must not depend on the legacy native bridge.
// Used only by scripts/arch-selftest.mjs.
import { nativeContract } from '../native/contracts';

export const usesNative = nativeContract;
