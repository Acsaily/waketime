// Negative fixture: module files outside domain/ (e.g. format helpers) must
// also stay framework-free. Value import proves runtime edges are caught.
// Used only by scripts/arch-selftest.mjs.
import { Capacitor } from '@capacitor/core';

export const platform = Capacitor;
