// Wrong direction: application must not depend on the legacy React state hook.
// Used only by scripts/arch-selftest.mjs.
import { useApp } from '../state/useApp';

export const usesState = useApp;
