// Synthetic wrong-direction import: analytics is a pure read model and must
// not depend on React. Used only by scripts/arch-selftest.mjs.
import { useState } from 'react';

export const analytics = useState;
