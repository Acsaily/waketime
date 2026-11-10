import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { APP_VERSION, SCHEMA_VERSION, defaultData, type Cycle, type Settings } from '../data/store';
import { categoryName, completeCategories, defaultCategories, type CategoryDefinition } from '../core/categories';
import { categoryLabel, categoryOf, summarizeCycle } from '../core/segments';
import { formatClock, formatDate, formatDuration, formatHuman } from '../core/time';
import { buildTrend, formatSigned, summarizeTrend } from '../core/trends';

function segmentLines(cycle: Cycle, nowMs: number, categories: CategoryDefinition[]): string[] {
  const segs = cycle.session?.segments ?? [];
  if (segs.length === 0) return ['（当天没有计次记录）'];
  return segs.map((s) => {
    const end = Math.min(s.endAtMs || nowMs, cycle.closedAtMs ?? nowMs);
    const dur = Math.max(0, end - s.startAtMs);
    const note = s.note?.trim() ? s.note.trim() : '（无备注）';
    return `${formatClock(s.startAtMs)}-${formatClock(end)}  ${formatHuman(dur).padEnd(6)}  [${categoryLabel(categoryOf(s), categories)}] ${note}${s.endAtMs ? '' : '  [进行中]'}`;
  });
}

export function categorySummaryText(totals: ReturnType<typeof summarizeCycle>, categories: CategoryDefinition[]): string {
  const catalog = completeCategories(categories, Object.keys(totals.categoryMs).map((category) => ({ category })));
  return catalog.filter((c) => c.id !== 'sleep' && (c.id === 'unclassified' || (totals.categoryMs[c.id] ?? 0) > 0))
    .map((c) => `${c.name}${c.archived ? '（已停用）' : ''} ${formatHuman(totals.categoryMs[c.id] ?? 0)}`).join('；');
}

export function buildDayTxt(cycle: Cycle, allCycles: Cycle[] = [cycle], categories: CategoryDefinition[] = defaultCategories()): string {
  const segs = cycle.session?.segments ?? [];
  const nowMs = Date.now();
  const totals = summarizeCycle(cycle, nowMs);
  const noNote = segs.filter((s) => !s.note?.trim() && s.endAtMs).length;
  const m = cycle.sleepMetrics;
  const lines: string[] = [];
  lines.push('清醒时光 · 单日记录');
  lines.push(`导出时间：${formatDate(Date.now())} ${formatClock(Date.now())}`);
  lines.push(`日期：${cycle.id}（${cycle.timeZone}）`);
  lines.push('');
  lines.push('== 睡眠 ==');
  lines.push(`昨晚睡着：${formatClock(cycle.sleepAtMs)}`);
  lines.push(`今早醒来：${formatClock(cycle.wakeAtMs)}`);
  lines.push(`主睡眠：${formatHuman(totals.mainSleepMs)}；补觉：${formatHuman(totals.napMs)}；总睡眠：${formatHuman(totals.totalSleepMs)}`);
  lines.push(`清醒预算：${formatHuman(Math.max(0, 86_400_000 - totals.totalSleepMs))}`);
  lines.push(`参考截止：${formatClock(cycle.targetAtMs)}`);
  if (m.score !== null) lines.push(`睡眠得分：${m.score}`);
  if (m.reportedTotalMs !== null) lines.push(`手表记录总时长：${formatHuman(m.reportedTotalMs)}`);
  if (m.note) lines.push(`睡眠备注：${m.note}`);
  lines.push('');
  lines.push('== 时间轴（含补觉） ==');
  lines.push('时间段             时长    备注');
  lines.push(...segmentLines(cycle, nowMs, categories));
  lines.push('');
  lines.push(`实际清醒：${formatHuman(totals.awakeMs)}；${categorySummaryText(totals, categories)}`);
  lines.push(`共 ${segs.length} 段，其中 ${noNote} 段没有备注。未分类含暂停空档，补觉不计清醒；参考截止固定。`);
  if (cycle.closedAtMs) lines.push(`本次记录已于 ${formatClock(cycle.closedAtMs)} 结束`);
  if (cycle.flags.length > 0) lines.push(`异常标记：${cycle.flags.join(', ')}`);
  // 波动 / 超时：相对上一周期的睡眠变化、相对参考截止的超时或提前
  const trend = buildTrend(allCycles.length > 0 ? allCycles : [cycle]);
  const idx = trend.findIndex((d) => d.id === cycle.id);
  if (idx >= 0) {
    const d = trend[idx];
    lines.push('');
    lines.push('== 波动与超时 ==');
    lines.push('距本次起床：' + formatDuration(Math.max(0, (cycle.closedAtMs ?? Date.now()) - cycle.wakeAtMs)));
    lines.push('本周期睡眠时长：' + formatHuman(totals.totalSleepMs));
    if (d.durationDeltaMs !== null) {
      lines.push('与上一周期相比睡眠：' + formatSigned(d.durationDeltaMs) + (d.durationDeltaMs > 0 ? '（睡久了）' : '（睡少了）'));
    }
    if (d.driftMs !== null) {
      lines.push(
        '相对参考截止：' + formatSigned(d.driftMs) + (d.driftMs > 0 ? '（超时/熬夜）' : d.driftMs < 0 ? '（提前睡/缩减）' : '（刚好）')
      );
    } else {
      lines.push('相对参考截止：还没有下一个周期，无法计算（等下一次录入后自动补上）');
    }
    const s = summarizeTrend(trend);
    lines.push(
      '累计：超时 ' + formatSigned(s.totalOverrunMs) + ' / 提前 ' + formatSigned(s.totalShrinkMs) + ' / 平均睡眠 ' + formatHuman(s.avgSleepMs)
    );
  }
  lines.push('');
  lines.push('（时间为本地时间；本文件由「清醒时光」App 导出，可交给 AI 做作息分析）');
  return lines.join('\n');
}

export function buildBackupJson(cycles: Cycle[], settings: Settings = defaultData().settings): string {
  const categories = completeCategories(settings.categories, cycles.flatMap((c) => c.session?.segments ?? []));
  const nowMs = Date.now();
  const trend = buildTrend(cycles);
  const summary = summarizeTrend(trend);
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      exportedAtMs: Date.now(),
      settings: { ...settings, categories },
      cycles,
      cycleSummaries: cycles.map((c) => {
        const totals = summarizeCycle(c, nowMs);
        return { cycleId: c.id, ...totals, categorySummaries: Object.entries(totals.categoryMs).map(([id, durationMs]) => ({
          id, name: categoryName(id, categories), archived: categories.find((item) => item.id === id)?.archived ?? true, durationMs,
        })) };
      }),
      // 给 AI 的分析字段：每天睡眠时长/入睡/起床/超时或提前，以及汇总
      trend,
      trendSummary: summary,
    },
    null,
    2
  );
}

function isWeb(): boolean {
  return !Capacitor.isNativePlatform();
}

export async function shareTextFile(filename: string, text: string): Promise<void> {
  if (isWeb()) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  await Filesystem.writeFile({
    path: `exports/${filename}`,
    directory: Directory.Cache,
    recursive: true,
    data: text,
    encoding: Encoding.UTF8,
  });
  const uri = await Filesystem.getUri({ path: `exports/${filename}`, directory: Directory.Cache });
  await Share.share({ title: filename, url: uri.uri, dialogTitle: '分享清醒记录' });
}

export function dayFileName(cycleId: string, ext: string): string {
  return `waketime-${cycleId}.${ext}`;
}
