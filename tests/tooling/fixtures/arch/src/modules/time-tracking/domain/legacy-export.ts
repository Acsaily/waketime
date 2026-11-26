// Synthetic wrong-direction import: a domain file must not reach the legacy
// export layer. Used only by scripts/arch-selftest.mjs.
import { format } from '../../../export/format';

export const legacyExport = format;
