// Wrong direction: UI must not call Capacitor plugins directly.
// Used only by scripts/arch-selftest.mjs.
import { Filesystem } from '@capacitor/filesystem';

export const capacitor = Filesystem;
