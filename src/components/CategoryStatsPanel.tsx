import { useState } from 'react';
import type { Segment } from '../data/store';
import type { CategoryDefinition } from '../core/categories';
import type { CategoryEntry, CategoryPeriod, StatsLevel, StatsView } from '../core/categoryStats';
import { entryBucketMs } from '../core/categoryStats';
import { categoryColor } from '../core/categoryColors';
import { formatClock, formatHuman } from '../core/time';
import { formatDateShort } from '../core/history';

export interface PendingSegmentRow {
  cycleId: string;
  segment: Segment;
  wakeAtMs: number;
}

function weekLetter(ms: number): string {
  return ['日', '一', '二', '三', '四', '五', '六'][new Date(ms).getDay()];
}

function chartLabel(period: CategoryPeriod, index: number): string | null {
  if (period.mode === 'week') return weekLetter(period.buckets[index].startMs);
  if (period.mode === 'year') return `${index + 1}`;
  const day = index + 1;
  if (day === 1 || day === period.buckets.length || day % 5 === 0) return `${day}`;
  return null;
}

function TrendChart({ period, entries, view, selectedId, level, categories }: {
  period: CategoryPeriod;
  entries: CategoryEntry[];
  view: StatsView;
  selectedId: string | null;
  level: StatsLevel;
  categories: CategoryDefinition[];
}) {
  const buckets = period.buckets;
  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const bucketTotal = (bucket: CategoryPeriod['buckets'][number]) =>
    entries.reduce((sum, entry) => sum + entryBucketMs(bucket.categoryMs, entry, level, categories), 0);
  const valueOf = (bucket: CategoryPeriod['buckets'][number]) =>
    view === 'single' ? (selectedId ? entryBucketMs(bucket.categoryMs, { id: selectedId }, level, categories) : 0) : bucketTotal(bucket);
  const max = Math.max(1, ...buckets.map(valueOf));
  const width = Math.max(1, buckets.length) * 10;
  const points = buckets.map((bucket, i) => {
    const value = valueOf(bucket);
    return `${(i + 0.5) * 10},${100 - value / max * 100}`;
  }).join(' ');
  const stackEntries = entries.filter((entry) => entry.ms > 0 && !(view === 'single' && entry.id !== selectedId));

  return (
    <div className={`stats-chart ${view === 'single' ? 'is-single' : ''}`}>
      <div className="stats-chart-grid" aria-hidden="true"><i /><i /><i /></div>
      <div className="stats-bars" role="img" aria-label={view === 'single' ? `${selected?.name ?? '分类'}趋势` : '分类合计趋势'}>
        {buckets.map((bucket, i) => {
          const total = bucketTotal(bucket);
          const value = view === 'single' ? (selectedId ? entryBucketMs(bucket.categoryMs, { id: selectedId }, level, categories) : 0) : total;
          const height = Math.max(value ? 2 : 0, value / max * 100);
          return (
            <div className="stats-bar-col" key={bucket.key}>
              <div className="stats-bar" style={{ height: `${height}%` }}>
                {stackEntries.map((entry) => {
                  const ms = entryBucketMs(bucket.categoryMs, entry, level, categories);
                  if (ms <= 0) return null;
                  return (
                    <span
                      key={entry.id}
                      style={{
                        height: view === 'single' ? '100%' : `${ms / Math.max(total, 1) * 100}%`,
                        background: categoryColor(entry.id, categories),
                      }}
                      title={`${entry.name} ${formatHuman(ms)}`}
                    />
                  );
                })}
              </div>
              <small>{chartLabel(period, i)}</small>
            </div>
          );
        })}
      </div>
      <svg className="stats-line" viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" aria-hidden="true">
        {buckets.length > 1 ? <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" /> : null}
        {buckets.map((bucket, i) => {
          const value = valueOf(bucket);
          if (!value) return null;
          return <circle key={bucket.key} cx={(i + 0.5) * 10} cy={100 - value / max * 100} r={1.7} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
    </div>
  );
}

function Donut({ entries, pct, totalMs, categories }: {
  entries: CategoryEntry[];
  pct: Map<string, number>;
  totalMs: number;
  categories: CategoryDefinition[];
}) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="stats-donut-wrap">
      <svg className="stats-donut" viewBox="0 0 100 100" role="img" aria-label="分类占比">
        <circle className="stats-donut-track" cx="50" cy="50" r={radius} />
        {entries.map((entry) => {
          const value = pct.get(entry.id) ?? 0;
          if (!value) return null;
          const dash = `${value / 100 * circumference} ${circumference}`;
          const rotation = -90 + offset / 100 * 360;
          offset += value;
          return (
            <circle
              key={entry.id}
              cx="50" cy="50" r={radius} fill="none"
              stroke={categoryColor(entry.id, categories)} strokeWidth="15"
              strokeDasharray={dash} strokeLinecap="butt"
              transform={`rotate(${rotation} 50 50)`}
            />
          );
        })}
      </svg>
      <div className="stats-donut-center">
        <b>{formatHuman(totalMs)}</b>
        <span>总清醒</span>
      </div>
    </div>
  );
}

function PendingCard({ rows, busy, onAllocate, onEdit }: {
  rows: PendingSegmentRow[];
  busy: boolean;
  onAllocate: (row: PendingSegmentRow) => void;
  onEdit: (row: PendingSegmentRow) => void;
}) {
  const totalMs = rows.reduce((sum, row) => sum + Math.max(0, (row.segment.endAtMs || row.segment.startAtMs) - row.segment.startAtMs), 0);
  return (
    <section className="section stats-pending">
      <div className="section-head">
        <span>睡前时间待分配</span>
        <span className="small muted">{formatHuman(totalMs)}</span>
      </div>
      <p className="hint">开启第二天时，最后一次计次到入睡的时段会自动归到这里。分配后会从「睡前时间」移到你选的分类，历史与统计同步更新。</p>
      <div className="pending-list">
        {rows.slice(0, 6).map((row) => {
          const end = row.segment.endAtMs || row.segment.startAtMs;
          return <div className="pending-row" key={`${row.cycleId}:${row.segment.id}`}>
            <div className="pending-head">
              <span className="mono">{formatDateShort(row.wakeAtMs)} {formatClock(row.segment.startAtMs)}–{formatClock(end)}</span>
              <span className="muted">{formatHuman(Math.max(0, end - row.segment.startAtMs))}</span>
            </div>
            <div className="pending-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => onAllocate(row)}>选择分类分配…</button>
              <button type="button" className="chip" disabled={busy} onClick={() => onEdit(row)}>细分 / 备注</button>
            </div>
          </div>;
        })}
      </div>
      {rows.length > 6 ? <p className="tiny">还有 {rows.length - 6} 段待分配，可在历史页逐段处理。</p> : null}
    </section>
  );
}

export function CategoryStatsPanel({
  period, entries, pct, totalMs, view, onViewChange, selectedId, onSelectId,
  pending, categories, busy, onAllocate, onEditPending,
  level, onLevelChange, drillParentId, onDrill, onBack,
}: {
  period: CategoryPeriod;
  entries: CategoryEntry[];
  pct: Map<string, number>;
  totalMs: number;
  view: StatsView;
  onViewChange: (view: StatsView) => void;
  selectedId: string | null;
  onSelectId: (id: string) => void;
  pending: PendingSegmentRow[];
  categories: CategoryDefinition[];
  busy: boolean;
  onAllocate: (row: PendingSegmentRow) => void;
  onEditPending: (row: PendingSegmentRow) => void;
  level: StatsLevel;
  onLevelChange: (level: StatsLevel) => void;
  drillParentId: string | null;
  onDrill: (parentId: string) => void;
  onBack: () => void;
}) {
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  const activeId = selected?.id ?? null;
  const delta = period.previousTotalMs > 0
    ? Math.round((period.totalMs - period.previousTotalMs) / period.previousTotalMs * 100)
    : null;
  const drillParent = drillParentId ? categories.find((c) => c.id === drillParentId) : null;
  const shareTitle = level === 'parent' ? '大类占比' : drillParent ? `${drillParent.name}的细分占比` : '细分占比';
  const [overviewOpen, setOverviewOpen] = useState(false);
  const ratioTotal = period.totalMs + period.sleepMs;
  const awakePct = ratioTotal > 0 ? Math.round(period.totalMs / ratioTotal * 100) : null;
  const sleepPct = awakePct === null ? null : 100 - awakePct;
  const toggleOverview = () => setOverviewOpen((open) => !open);

  return <>
    <section
      className={`section stats-overview${overviewOpen ? ' is-open' : ''}`}
      role="button"
      tabIndex={0}
      aria-expanded={overviewOpen}
      aria-label="总清醒时间，点击展开睡眠时间与清醒睡眠比例"
      onClick={toggleOverview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOverview(); } }}
    >
      <div className="stats-total-row">
        <div>
          <p className="tiny">总清醒时间 <em className="stats-expand-hint">{overviewOpen ? '收起' : '展开'}</em></p>
          <p className="stats-total">{formatHuman(period.totalMs)}</p>
        </div>
        <div className="stats-total-side">
          <span>已记录 {period.recordedDays} 天</span>
          <span>
            {delta === null ? `${period.prevLabel}无记录` : `较${period.prevLabel} ${delta >= 0 ? '↑' : '↓'}${Math.abs(delta)}%`}
          </span>
          <span className="stats-expand-caret" aria-hidden="true">{overviewOpen ? '▴' : '▾'}</span>
        </div>
      </div>
      {overviewOpen ? <div className="stats-overview-extra">
        <div className="stats-overview-fact"><span>总睡眠时间</span><b>{formatHuman(period.sleepMs)}</b></div>
        <div className="stats-overview-fact"><span>清醒 : 睡眠</span><b>{awakePct === null ? '—' : `${awakePct}% : ${sleepPct}%`}</b></div>
        {awakePct === null ? null : <div className="stats-split-bar" aria-hidden="true">
          <i className="awake" style={{ flexGrow: awakePct }} />
          <i className="sleep" style={{ flexGrow: sleepPct ?? 0 }} />
        </div>}
      </div> : null}
      <p className="tiny">按起床日归档；补觉和主睡眠不计入分类。{period.ongoing ? '本期仍在进行。' : ''}</p>
    </section>

    {pending.length ? <PendingCard rows={pending} busy={busy} onAllocate={onAllocate} onEdit={onEditPending} /> : null}

    {period.totalMs === 0 ? (
      <div className="hero-card empty">
        <div className="hero-title">这段时间还没有分类记录</div>
        <p className="hint">换一个周期看看，或先在「今日」记录并归类。</p>
      </div>
    ) : <>
      <section className="section stats-share">
        <div className="section-head"><span>{shareTitle}</span><span className="small muted">合计 100%</span></div>
        <div className="stats-level-bar">
          <div className="stats-level-toggle" role="group" aria-label="统计层级">
            <button type="button" className={level === 'parent' ? 'active' : ''} aria-pressed={level === 'parent'} onClick={() => onLevelChange('parent')}>大类</button>
            <button type="button" className={level === 'child' ? 'active' : ''} aria-pressed={level === 'child'} onClick={() => onLevelChange('child')}>细分</button>
          </div>
          {level === 'child' && drillParent ? <div className="stats-breadcrumb">
            <button type="button" className="chip" onClick={onBack}>‹ 全部大类</button>
            <span>{drillParent.name}</span>
          </div> : null}
        </div>
        {entries.length === 0 ? <p className="hint">这个大类在这段时间没有可分配的时间。</p> : <div className="stats-share-body">
          <Donut entries={entries} pct={pct} totalMs={totalMs} categories={categories} />
          <div className="stats-legend">
            {entries.map((entry) => {
              const drillable = level === 'parent' && (entry.childCount ?? 0) > 0;
              const content = <>
                <i style={{ background: categoryColor(entry.id, categories) }} aria-hidden="true" />
                <span className="stats-legend-name">
                  {entry.name}
                  {entry.preSleep ? <em>待分配</em> : entry.archived ? <em>已停用</em> : null}
                  {entry.parentBucket ? <em>未细分</em> : null}
                  {drillable ? <em>{entry.childCount} 个细分 ›</em> : null}
                </span>
                <b>{formatHuman(entry.ms)}</b>
                <span className="muted">{pct.get(entry.id) ?? 0}%</span>
              </>;
              return drillable
                ? <button type="button" className="stats-legend-row is-drillable" key={entry.id} aria-label={`查看${entry.name}的细分`} onClick={() => onDrill(entry.id)}>{content}</button>
                : <div className="stats-legend-row" key={entry.id}>{content}</div>;
            })}
          </div>
        </div>}
      </section>

      <section className="section stats-trend">
        <div className="section-head"><span>时间趋势</span><span className="small muted">{period.label}</span></div>
        <div className="stats-view-toggle" role="group" aria-label="趋势展示方式">
          <button type="button" className={view === 'total' ? 'active' : ''} aria-pressed={view === 'total'} onClick={() => onViewChange('total')}>合计</button>
          <button type="button" className={view === 'single' ? 'active' : ''} aria-pressed={view === 'single'} onClick={() => onViewChange('single')}>单分类</button>
        </div>
        {view === 'single' ? (
          <div className="stats-category-picker">
            {entries.map((entry) => <button
              key={entry.id} type="button"
              className={`chip ${activeId === entry.id ? 'active' : ''}`}
              aria-pressed={activeId === entry.id}
              style={activeId === entry.id ? { borderColor: categoryColor(entry.id, categories) } : undefined}
              onClick={() => onSelectId(entry.id)}
            >{entry.name}</button>)}
          </div>
        ) : null}
        <TrendChart period={period} entries={entries} view={view} selectedId={activeId} level={level} categories={categories} />
        <p className="tiny">{view === 'single' && selected ? `只显示「${selected.name}」，纵轴按它自己的最大值缩放。` : level === 'parent' ? '柱状为大类堆叠，折线为当期合计；点图例里的「N 个细分」可下钻。' : '柱状为当前层级的分类堆叠，折线为当期合计。'}</p>
      </section>
    </>}
  </>;
}
