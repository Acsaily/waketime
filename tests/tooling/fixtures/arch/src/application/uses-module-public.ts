// Legal: application may consume a module public index while staying clear of
// legacy concrete implementations. Used only by scripts/arch-selftest.mjs.
import { track } from '../modules/time-tracking/index';

export const usesModulePublic = track;
