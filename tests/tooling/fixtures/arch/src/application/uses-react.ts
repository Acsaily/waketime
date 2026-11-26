// Wrong direction: application must stay framework-free.
// Used only by scripts/arch-selftest.mjs.
import { useState } from 'react';

export const usesReact = useState;
