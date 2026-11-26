// Legal app consumer: app may consume a module public index.
// Used only by scripts/arch-selftest.mjs.
import { track } from '../modules/time-tracking/index';

export const legalModule = track;
