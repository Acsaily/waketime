// Legal consumer: public module and application indexes only.
// Used only by scripts/arch-selftest.mjs.
import { applicationOp } from '../../application/index';
import { classify } from '../../modules/classification/index';
import { track } from '../../modules/time-tracking/index';

export const legal = track + applicationOp + classify;
