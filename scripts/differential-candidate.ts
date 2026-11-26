// This adapter only binds real implementation entry points; it does not normalize outputs.
// Update bindings when the candidate moves its public interfaces.
export { parseDataText, defaultData, applyLiveState } from '../src/application/index';
export { readRestoreBackup, buildRestoredData, categoryConflicts } from '../src/application/index';
export {
  summarizeCycle,
  editSegment,
  mergeAdjacentSegments,
  sanitizeCycle,
} from '../src/modules/time-tracking/index';
export { splitSegments, snapshotOf } from '../src/modules/time-tracking/index';
export { changeCategories } from '../src/modules/classification/index';
export {
  buildDayMetrics,
  buildWeeks,
  weekStats,
  buildMonthView,
  monthsWithRecords,
  summarizeDay,
  startOfLocalDayMs,
  addLocalDaysMs,
} from '../src/modules/analytics/index';
export {
  buildCategoryDayTotals,
  buildCategoryPeriod,
  categoryEntries,
  entryBucketMs,
  percentMap,
  summaryRows,
} from '../src/modules/analytics/index';
export {
  buildTrend,
  summarizeTrend,
  trendWindow,
  wakeDateOf,
  clockMinutesLateNight,
} from '../src/modules/analytics/index';
export {
  computeCycle,
  deriveTimerDisplay,
  validateSleepInput,
  splitByDay,
} from '../src/modules/time-tracking/index';
export { uniqueCycleId } from '../src/modules/time-tracking/index';
export { buildBackupJson, buildDayTxt } from '../src/application/index';
export { buildPdfBlocks } from '../src/application/index';
