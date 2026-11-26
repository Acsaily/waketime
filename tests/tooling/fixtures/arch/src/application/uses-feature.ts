// Wrong direction: application must not import the UI feature layer.
// Used only by scripts/arch-selftest.mjs.
import { legal } from '../features/today/legal';

export const usesFeature = legal;
