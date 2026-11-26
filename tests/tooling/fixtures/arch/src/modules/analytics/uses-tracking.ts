// Legal cross-module dependency: a module may consume another module's public
// index. Used only by scripts/arch-selftest.mjs.
import { track } from '../time-tracking/index';

export const usesTracking = track;
