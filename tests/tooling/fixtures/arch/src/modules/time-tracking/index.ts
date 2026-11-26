// Synthetic module public entry. Even the public index must stay
// framework-free, including type-only imports. Used only by
// scripts/arch-selftest.mjs.
import type { ReactNode } from 'react';

export type PublicNode = ReactNode;
export const track = 1;
