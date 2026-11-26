// This adapter only binds real implementation entry points; it does not normalize outputs.
// Fixed 8307835 isolation tree; never swap these imports to candidate re-exports.
export {
  parseDataText,
  defaultData,
  sanitizeCycle,
  applyLiveState,
} from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/data/store';
export {
  readRestoreBackup,
  buildRestoredData,
  categoryConflicts,
} from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/data/restore';
export {
  summarizeCycle,
  editSegment,
  mergeAdjacentSegments,
} from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/core/segments';
export {
  splitSegments,
  snapshotOf,
} from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/core/splitSegments';
export { changeCategories } from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/core/categories';
export {
  buildDayMetrics,
  buildWeeks,
  weekStats,
  buildMonthView,
  monthsWithRecords,
  summarizeDay,
  startOfLocalDayMs,
  addLocalDaysMs,
} from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/core/history';
export {
  buildCategoryDayTotals,
  buildCategoryPeriod,
  categoryEntries,
  entryBucketMs,
  percentMap,
  summaryRows,
} from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/core/categoryStats';
export {
  buildTrend,
  summarizeTrend,
  trendWindow,
  wakeDateOf,
  clockMinutesLateNight,
} from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/core/trends';
export {
  computeCycle,
  deriveTimerDisplay,
  validateSleepInput,
  splitByDay,
} from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/core/time';
export { uniqueCycleId } from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/core/cycleIds';
export {
  buildBackupJson,
  buildDayTxt,
} from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/export/format';
export { buildPdfBlocks } from '../.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/src/export/pdfDoc';
