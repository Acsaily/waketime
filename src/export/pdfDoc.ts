import type { Cycle } from '../data/store';
import { categoryLabel, categoryOf, summarizeCycle } from '../core/segments';
import type { PdfBlock } from '../native/pdfExport';
import { formatClock, formatHuman } from '../core/time';
import { buildTrend, formatSigned, summarizeTrend } from '../core/trends';
import { defaultCategories, type CategoryDefinition } from '../core/categories';
import { categorySummaryText } from './format';

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function buildPdfBlocks(cycle: Cycle, allCycles: Cycle[] = [cycle], categories: CategoryDefinition[] = defaultCategories()): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  const segs = cycle.session?.segments ?? [];
  const nowMs = Date.now();
  const totals = summarizeCycle(cycle, nowMs);

  blocks.push({ kind: 'title', text: `清醒时光 · ${cycle.id} ${WEEKDAY[new Date(cycle.wakeAtMs).getDay()]}` });
  blocks.push({ kind: 'para', text: `时区 ${cycle.timeZone} · 参考截止 ${formatClock(cycle.targetAtMs)} · 共 ${segs.length} 段` });

  blocks.push({ kind: 'h2', text: '睡眠' });
  blocks.push({
    kind: 'row',
    text: `昨晚睡着 ${formatClock(cycle.sleepAtMs)} · 今早醒来 ${formatClock(cycle.wakeAtMs)}`,
    right: formatHuman(totals.mainSleepMs),
  });
  blocks.push({
    kind: 'row',
    text: `补觉 ${formatHuman(totals.napMs)} · 总睡眠 ${formatHuman(totals.totalSleepMs)}`,
    right: cycle.sleepMetrics.score !== null ? `得分 ${cycle.sleepMetrics.score}` : '',
  });
  if (cycle.sleepMetrics.reportedTotalMs !== null) {
    blocks.push({ kind: 'row', text: '手表记录总睡眠', right: formatHuman(cycle.sleepMetrics.reportedTotalMs) });
  }
  if (cycle.sleepMetrics.note) {
    blocks.push({ kind: 'para', text: `睡眠备注：${cycle.sleepMetrics.note}` });
  }

  blocks.push({ kind: 'h2', text: '清醒分类汇总' });
  blocks.push({ kind: 'para', text: `实际清醒 ${formatHuman(totals.awakeMs)}；${categorySummaryText(totals, categories)}` });
  blocks.push({ kind: 'para', text: '补觉不计清醒，未分类含暂停空档；参考截止为主睡眠开始 + 24 小时，不因补觉顺延。' });

  // 波动与超时
  const trend = buildTrend(allCycles.length > 0 ? allCycles : [cycle]);
  const idx = trend.findIndex((d) => d.id === cycle.id);
  if (idx >= 0) {
    const d = trend[idx];
    const s = summarizeTrend(trend);
    blocks.push({ kind: 'h2', text: '波动与超时' });
    blocks.push({ kind: 'row', text: '本周期总睡眠', right: formatHuman(totals.totalSleepMs) });
    if (d.durationDeltaMs !== null) {
      blocks.push({ kind: 'row', text: '与上一周期相比', right: formatSigned(d.durationDeltaMs) });
    }
    if (d.driftMs !== null) {
      blocks.push({
        kind: 'row',
        text: d.driftMs > 0 ? '相对参考截止（超时/熬夜）' : '相对参考截止（提前/缩减）',
        right: formatSigned(d.driftMs),
      });
    } else {
      blocks.push({ kind: 'para', text: '相对参考截止：还没有下一个周期，无法计算' });
    }
    blocks.push({
      kind: 'para',
      text: `累计：超时 ${formatSigned(s.totalOverrunMs)}，提前 ${formatSigned(s.totalShrinkMs)}，平均睡眠 ${formatHuman(s.avgSleepMs)}`,
    });
  }

  blocks.push({ kind: 'h2', text: '时间轴（含补觉）' });
  if (segs.length === 0) {
    blocks.push({ kind: 'para', text: '（当天没有计次记录）' });
  }
  for (const s of segs) {
    const end = Math.min(s.endAtMs || nowMs, cycle.closedAtMs ?? nowMs);
    const dur = Math.max(0, end - s.startAtMs);
    const note = s.note?.trim() || '（无备注）';
    blocks.push({
      kind: 'row',
      text: `${formatClock(s.startAtMs)}–${s.endAtMs ? formatClock(s.endAtMs) : '现在'}  [${categoryLabel(categoryOf(s), categories)}] ${note}`,
      right: formatHuman(dur),
    });
  }

  const noNote = segs.filter((s) => !s.note?.trim() && s.endAtMs).length;
  blocks.push({ kind: 'para', text: `合计 ${segs.length} 段，实际清醒 ${formatHuman(totals.awakeMs)}，其中 ${noNote} 段没有备注。` });
  if (cycle.flags.length > 0) {
    blocks.push({ kind: 'para', text: `异常标记：${cycle.flags.join(', ')}（时间可能不准，请核对）` });
  }
  return blocks;
}
