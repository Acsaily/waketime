import { useRef } from 'react';
import type { Cycle, Segment } from '../data/store';
import type { CategoryDefinition } from '../core/categories';
import { completeCategories } from '../core/categories';
import type { DayMetric, MonthView } from '../core/history';
import {
  dateKeyOfMs,
  formatClockMinutes,
  formatDayTitle,
  formatMonthTitle,
  formatSignedShort,
  formatSleepShort,
  summarizeDay,
} from '../core/history';
import { summarizeCycle } from '../core/segments';
import { formatClock, formatHuman } from '../core/time';
import { Timeline } from './Timeline';

const CATEGORY_COLORS: Record<string, string> = {
  work: '#4c8dff',
  daily: '#3ddc97',
  unclassified: '#8b94a5',
  sleep: '#ffb02e',
};
const EXTRA_COLORS = ['#c792ea', '#ff8066', '#7bd0ff', '#a3e635', '#f472b6', '#ffb02e'];

function categoryColor(id: string, catalog: CategoryDefinition[]): string {
  if (CATEGORY_COLORS[id]) return CATEGORY_COLORS[id];
  const index = catalog.findIndex((c) => c.id === id);
  return EXTRA_COLORS[Math.abs(index) % EXTRA_COLORS.length];
}

function CategoryChips({
  cycle,
  categories,
  nowMs,
}: {
  cycle: Cycle;
  categories: CategoryDefinition[];
  nowMs: number;
}) {
  const totals = summarizeCycle(cycle, nowMs);
  const catalog = completeCategories(categories, cycle.session?.segments ?? []);
  const visible = catalog.filter((c) => c.id !== 'sleep'
    && (c.id === 'unclassified' || (totals.categoryMs[c.id] ?? 0) > 0));
  if (!visible.length) return null;
  return (
    <div className="history-chips" aria-label="分类汇总">
      {visible.map((c) => (
        <span className="history-chip" key={c.id}>
          <i style={{ background: categoryColor(c.id, catalog) }} />
          {c.name}{c.archived ? '（已停用）' : ''}
          <b>{formatHuman(totals.categoryMs[c.id] ?? 0)}</b>
        </span>
      ))}
    </div>
  );
}

function DayDetail({
  cellKey,
  day,
  dateMs,
  future,
  categories,
  nowMs,
  onEdit,
}: {
  cellKey: string;
  day: DayMetric | null;
  dateMs: number;
  future: boolean;
  categories: CategoryDefinition[];
  nowMs: number;
  onEdit: (cycleId: string, segment: Segment) => void;
}) {
  if (!day) {
    return (
      <section className="history-day-card">
        <div className="history-day-head">
          <div>
            <div className="history-day-title">{formatDayTitle(dateMs)}</div>
            <p className="history-day-sub">{future ? '这一天还没到' : '这天没有记录'}</p>
          </div>
        </div>
        <div className="history-day-empty">{future ? '还没到这一天，先看看别的日期吧。' : '这一天没有睡眠记录。'}</div>
      </section>
    );
  }

  const merged = summarizeDay(day, nowMs);
  const driftClass = day.driftMs === null ? 'none' : day.driftMs > 0 ? '' : 'early';
  const driftText = day.driftMs === null
    ? '缺少下一晚记录'
    : `${day.driftMs > 0 ? '晚于' : '早于'}参考截止 ${formatHuman(Math.abs(day.driftMs))}`;

  return (
    <section className="history-day-card" data-day={cellKey}>
      <div className="history-day-head">
        <div>
          <div className="history-day-title">{formatDayTitle(day.dateMs)}</div>
          <p className="history-day-sub">
            {day.cycles.length > 1 ? `${day.cycles.length} 次睡眠` : merged.napMs > 0
              ? `主睡眠 ${formatHuman(merged.mainSleepMs)} + 补觉 ${formatHuman(merged.napMs)}`
              : '主睡眠，无补觉'}
          </p>
        </div>
        <span className={`history-drift-pill ${driftClass}`}>{driftText}</span>
      </div>

      {day.cycles.map((cycle, index) => {
        const totals = summarizeCycle(cycle, nowMs);
        return (
          <div className="history-cycle-block" key={cycle.id}>
            {day.cycles.length > 1 ? (
              <div className="history-cycle-head">
                第 {index + 1} 次睡眠 · {formatClock(cycle.sleepAtMs)} → {formatClock(cycle.wakeAtMs)}
              </div>
            ) : null}
            <div className="history-day-times mono">
              <span>入睡 <b>{formatClock(cycle.sleepAtMs)}</b></span>
              <span>起床 <b>{formatClock(cycle.wakeAtMs)}</b></span>
              <span>总睡眠 <b>{formatHuman(totals.totalSleepMs)}</b></span>
              <span>实际清醒 <b>{formatHuman(totals.awakeMs)}</b></span>
            </div>
            <CategoryChips cycle={cycle} categories={categories} nowMs={nowMs} />
            <Timeline
              categories={categories}
              segments={cycle.session?.segments ?? []}
              now={cycle.closedAtMs ?? nowMs}
              onEdit={(segment) => onEdit(cycle.id, segment)}
              emptyHint="这天没有时间轴记录"
            />
            <div className="history-meta">
              <span>参考截止 {formatClock(cycle.targetAtMs)}（固定）</span>
              <span>主睡眠 {formatHuman(totals.mainSleepMs)} + 补觉 {formatHuman(totals.napMs)}</span>
              {cycle.sleepMetrics.score !== null ? <span>得分 {cycle.sleepMetrics.score}</span> : null}
              {cycle.source === 'backfill' ? <span>补录</span> : null}
              {cycle.flags.includes('clock_anomaly') ? <span className="warn-text">时间被调整过</span> : null}
            </div>
          </div>
        );
      })}
      <p className="tiny history-edit-hint">点时间段可编辑、拆分或合并相邻连续段。未分类含暂停空档，补觉不计清醒。</p>
    </section>
  );
}

export function HistoryMonthPanel({
  view,
  selectedKey,
  categories,
  nowMs,
  onSelectDay,
  onOpenPicker,
  onEdit,
}: {
  view: MonthView;
  selectedKey: string | null;
  categories: CategoryDefinition[];
  nowMs: number;
  onSelectDay: (key: string) => void;
  onOpenPicker: () => void;
  onEdit: (cycleId: string, segment: Segment) => void;
}) {
  const detailRef = useRef<HTMLDivElement>(null);
  const selectedCell = selectedKey
    ? view.cells.find((cell) => cell?.dateKey === selectedKey) ?? null
    : null;
  const todayKey = dateKeyOfMs(nowMs);

  const pickDay = (key: string) => {
    onSelectDay(key);
    requestAnimationFrame(() => {
      const card = detailRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      if (rect.top < 70 || rect.bottom > window.innerHeight - 70) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  return (
    <div className="history-month-panel">
      <div className="history-month-bar">
        <div>
          <div className="history-month-title">每日明细</div>
          <div className="muted small">按起床日归档 · 点日期看时间轴</div>
        </div>
        <button type="button" className="history-month-pill" onClick={onOpenPicker} aria-haspopup="dialog">
          {formatMonthTitle(view.year, view.month)}<span className="history-month-chev" aria-hidden="true">▼</span>
        </button>
      </div>

      <div className="history-month-summary">
        <span>记录 <b>{view.recordedDays}</b> 天</span>
        <span>平均睡眠 <b>{view.avgSleepMs === null ? '—' : formatHuman(view.avgSleepMs)}</b></span>
        <span>平均入睡 <b>{view.avgBedMinutes === null ? '—' : formatClockMinutes(view.avgBedMinutes)}</b></span>
      </div>

      <section className="history-calendar-card">
        <div className="history-cal-weekdays" aria-hidden="true">
          <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
        </div>
        <div className="history-cal-grid" role="group" aria-label={`${view.year}年${view.month + 1}月每日睡眠`}>
          {view.cells.map((cell, index) => {
            if (!cell) return <div className="history-cal-cell empty" key={`empty-${index}`} />;
            const selected = cell.dateKey === selectedKey;
            const classes = [
              'history-cal-cell',
              cell.day ? 'has' : '',
              selected ? 'selected' : '',
              cell.dateKey === todayKey ? 'today' : '',
              cell.future ? 'future' : '',
            ].filter(Boolean).join(' ');
            const drift = cell.day?.driftMs;
            return (
              <button
                type="button"
                key={cell.dateKey}
                className={classes}
                aria-pressed={selected}
                title={cell.day ? `总睡眠 ${formatHuman(cell.day.totalSleepMs)}` : undefined}
                aria-label={`${new Date(cell.dateMs).getMonth() + 1}月${new Date(cell.dateMs).getDate()}日，${cell.day
                  ? `睡眠 ${formatHuman(cell.day.totalSleepMs)}，相对参考截止 ${drift === null || drift === undefined ? '无法比较' : formatSignedShort(drift)}`
                  : cell.future ? '还没到这一天' : '没有记录'}`}
                onClick={() => pickDay(cell.dateKey)}
              >
                <span className="history-cal-day">{new Date(cell.dateMs).getDate()}</span>
                {cell.day ? (
                  <>
                    <span className="history-cal-sleep">{formatSleepShort(cell.day.totalSleepMs)}</span>
                    <span className={`history-cal-drift ${drift === null || drift === undefined ? 'none' : drift > 0 ? 'late' : 'early'}`}>
                      {drift === null || drift === undefined ? '—' : formatSignedShort(drift)}
                    </span>
                  </>
                ) : (
                  <span className="history-cal-sleep placeholder">{cell.future ? '' : '—'}</span>
                )}
              </button>
            );
          })}
        </div>
        <div className="history-cal-legend" aria-hidden="true">
          <span><i className="late" />晚于参考截止</span>
          <span><i className="early" />早于参考截止</span>
          <span><i className="none" />无法比较</span>
        </div>
      </section>

      <div ref={detailRef}>
        {selectedCell ? (
          <DayDetail
            cellKey={selectedCell.dateKey}
            dateMs={selectedCell.dateMs}
            day={selectedCell.day}
            future={selectedCell.future}
            categories={categories}
            nowMs={nowMs}
            onEdit={onEdit}
          />
        ) : null}
      </div>
    </div>
  );
}
