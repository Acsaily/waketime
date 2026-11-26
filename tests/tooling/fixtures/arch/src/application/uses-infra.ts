// Wrong direction: application must not import concrete infrastructure.
// Used only by scripts/arch-selftest.mjs.
import { files } from '../infrastructure/files';

export const usesInfra = files;
