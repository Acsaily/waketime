// Wrong direction: application must not depend on the legacy export layer.
// Used only by scripts/arch-selftest.mjs.
import { format } from '../export/format';

export const usesExport = format;
