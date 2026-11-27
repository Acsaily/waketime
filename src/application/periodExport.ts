import {
  addDateKey,
  dateKeyOfMs,
  msOfDateKey,
  startOfWeekMs,
  wakeDateOf,
} from '../modules/analytics/index';
import { formatHuman, summarizeCycle, type Cycle } from '../modules/time-tracking/index';
import { buildBackupJson, buildDayTxt } from './exportFormat';
import { buildPdfBlocks } from './pdfDoc';
import type { Settings } from './recordCodec';
import type { PdfBlock } from './ports';

export interface DateRange {
  startDate: string;
  endDate: string;
}
export type PeriodPreset = 'this-week' | 'last-week' | 'this-month' | 'last-month' | 'last-7-days';
export type PeriodExportKind = 'txt' | 'json' | 'pdf';

export function periodRange(preset: PeriodPreset, nowMs: number): DateRange {
  const today = dateKeyOfMs(nowMs);
  if (preset === 'last-7-days') return { startDate: addDateKey(today, -6), endDate: today };
  if (preset === 'this-week' || preset === 'last-week') {
    const monday = dateKeyOfMs(startOfWeekMs(nowMs));
    const startDate = addDateKey(monday, preset === 'last-week' ? -7 : 0);
    return { startDate, endDate: addDateKey(startDate, 6) };
  }
  const date = new Date(nowMs);
  const month = date.getMonth() - (preset === 'last-month' ? 1 : 0);
  return {
    startDate: dateKeyOfMs(new Date(date.getFullYear(), month, 1).getTime()),
    endDate: dateKeyOfMs(new Date(date.getFullYear(), month + 1, 0).getTime()),
  };
}

function validDate(key: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && dateKeyOfMs(msOfDateKey(key)) === key;
}

/** 与历史页相同的本地起床日归档；不切割跨午夜活动。 */
export function previewPeriod(cycles: Cycle[], range: DateRange, nowMs: number) {
  const { startDate, endDate } = range;
  if (!validDate(startDate) || !validDate(endDate)) throw new Error('请选择有效的起止日期');
  if (startDate > endDate) throw new Error('开始日期不能晚于结束日期');
  const selected = cycles
    .filter((c) => {
      const day = wakeDateOf(c.wakeAtMs);
      return day >= startDate && day <= endDate;
    })
    .sort((a, b) => a.wakeAtMs - b.wakeAtMs);
  let totalSleepMs = 0;
  let awakeMs = 0;
  for (const cycle of selected) {
    const totals = summarizeCycle(cycle, nowMs);
    totalSleepMs += totals.totalSleepMs;
    awakeMs += totals.awakeMs;
  }
  return {
    cycles: selected,
    recordedDays: new Set(selected.map((c) => wakeDateOf(c.wakeAtMs))).size,
    openCycles: selected.filter((c) => c.closedAtMs === null).length,
    totalSleepMs,
    awakeMs,
  };
}

export function buildPeriodExport(
  kind: PeriodExportKind,
  cycles: Cycle[],
  settings: Settings,
  range: DateRange,
  nowMs: number,
): { filename: string; text: string } | { filename: string; blocks: PdfBlock[] } {
  const preview = previewPeriod(cycles, range, nowMs);
  const selected = preview.cycles;
  if (!selected.length) throw new Error('所选日期范围内没有记录');
  const now = () => nowMs;
  const filename = `waketime-period-${range.startDate}_${range.endDate}.${kind}`;
  const title = `清醒时光 · 周期记录 ${range.startDate} — ${range.endDate}`;
  const summary = `按起床日（含首尾日）：${preview.recordedDays} 天 / ${selected.length} 个周期；总睡眠 ${formatHuman(preview.totalSleepMs)}；实际清醒 ${formatHuman(preview.awakeMs)}；未结束 ${preview.openCycles} 个。`;
  const note = '仅包含所选周期；趋势在所选范围内计算，未结束周期按导出统计时刻计算。';
  if (kind === 'json') {
    const payload = JSON.parse(buildBackupJson(selected, settings, now));
    return {
      filename,
      text: JSON.stringify({ ...payload, exportRange: { ...range, by: 'wakeDate' } }, null, 2),
    };
  }
  if (kind === 'txt')
    return {
      filename,
      text: [
        title,
        summary,
        note,
        ...selected.map((c) => buildDayTxt(c, selected, settings.categories, now, 'range')),
      ].join('\n\n'),
    };
  return {
    filename,
    blocks: [
      { kind: 'title', text: title },
      { kind: 'para', text: summary },
      { kind: 'para', text: note },
      ...selected.flatMap((c) => buildPdfBlocks(c, selected, settings.categories, now, 'range')),
    ],
  };
}
