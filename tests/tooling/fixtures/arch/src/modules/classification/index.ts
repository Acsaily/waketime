// Public classification index, but a module public entry must still stay
// framework-free even through type-only imports. Used only by
// scripts/arch-selftest.mjs.
import type { ReactNode } from 'react';

export type PublicNode = ReactNode;
export { classify } from './domain/classify';
