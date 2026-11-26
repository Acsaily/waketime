import { useMemo, useRef, useState, type TouchEvent } from 'react';
import type { AppApi } from '../../application/index';
import type { Cycle, Segment } from '../../modules/time-tracking/index';
import type { CategoryId } from '../../modules/classification/index';
import { categoryOf } from '../../modules/time-tracking/index';
import { PRE_SLEEP_CATEGORY } from '../../modules/classification/index';
import {
  buildCategoryDayTotals,
  buildCategoryPeriod,
  canNextPeriod,
  canPrevPeriod,
  categoryEntries,
  percentMap,
  shiftPeriod,
  type StatsLevel,
  type StatsMode,
  type StatsView,
} from '../../modules/analytics/index';
import { buildDayMetrics, formatDateShort } from '../../modules/analytics/index';
import { formatClock, formatHuman } from '../../modules/time-tracking/index';
import { CategoryStatsPanel, type PendingSegmentRow } from './CategoryStatsPanel';
import { CategoryManager } from './CategoryManager';
import { SegmentEditor } from '../../shared/ui/SegmentEditor';
import { CategoryPicker } from '../../shared/ui/CategoryPicker';
import { Sheet } from '../../shared/ui/Sheet';

type Panel = 'stats' | 'manage';

const MODES: Array<{ key: StatsMode; label: string }> = [
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
];

export function Stats({ api }: { api: AppApi }) {
  const { data, now, live, error } = api;
  const nowMinute = Math.floor(now / 60_000) * 60_000;
  const [panel, setPanel] = useState<Panel>('stats');
  const [slide, setSlide] = useState<'left' | 'right'>('right');
  const [mode, setMode] = useState<StatsMode>('week');
  const [anchor, setAnchor] = useState(() => Date.now());
  const [view, setView] = useState<StatsView>('total');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState<StatsLevel>('parent');
  const [drillParentId, setDrillParentId] = useState<string | null>(null);
  const [allocating, setAllocating] = useState<PendingSegmentRow | null>(null);
  const [allocateTarget, setAllocateTarget] = useState<CategoryId | null>(null);
  const [editor, setEditor] = useState<{ cycleId: string; segment: Segment } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef(false);

  // 与历史页一致：当前周期优先用原生实时段，避免统计落后于计时。
  const cycles = useMemo<Cycle[]>(
    () =>
      data.cycles.map((c) =>
        live?.cycleId === c.id && live.status !== 'idle'
          ? {
              ...c,
              session: {
                id: live.sessionId,
                status: live.status,
                startedAtMs: live.sessionStartedAtMs,
                segments: live.segments,
              },
            }
          : c,
      ),
    [data.cycles, live],
  );

  const days = useMemo(() => buildDayMetrics(cycles, nowMinute), [cycles, nowMinute]);
  const dayTotals = useMemo(() => buildCategoryDayTotals(days, nowMinute), [days, nowMinute]);
  const period = useMemo(
    () => buildCategoryPeriod(days, mode, anchor, nowMinute, dayTotals),
    [days, mode, anchor, nowMinute, dayTotals],
  );
  const entries = useMemo(
    () => categoryEntries(period, data.settings.categories, level, drillParentId),
    [period, data.settings.categories, level, drillParentId],
  );
  const levelTotalMs = useMemo(() => entries.reduce((sum, entry) => sum + entry.ms, 0), [entries]);
  const pct = useMemo(() => percentMap(entries, levelTotalMs), [entries, levelTotalMs]);
  const earliestMs = useMemo(
    () => (cycles.length ? Math.min(...cycles.map((c) => c.wakeAtMs)) : null),
    [cycles],
  );
  const pending = useMemo<PendingSegmentRow[]>(
    () =>
      cycles
        .flatMap((cycle) =>
          (cycle.session?.segments ?? [])
            .filter((segment) => categoryOf(segment) === PRE_SLEEP_CATEGORY)
            .map((segment) => ({ cycleId: cycle.id, segment, wakeAtMs: cycle.wakeAtMs })),
        )
        .sort((a, b) => b.segment.startAtMs - a.segment.startAtMs),
    [cycles],
  );

  const showPanel = (next: Panel) => {
    if (next === panel) return;
    setSlide(next === 'manage' ? 'left' : 'right');
    setPanel(next);
    window.scrollTo({ top: 0 });
  };

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('[data-no-swipe]')) {
      touchStart.current = null;
      return;
    }
    const touch = event.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      showPanel(dx < 0 ? 'manage' : 'stats');
    }
  };

  const switchMode = (next: StatsMode) => {
    setMode(next);
    setAnchor(Date.now());
    setMessage(null);
  };

  const changeLevel = (next: StatsLevel) => {
    setLevel(next);
    setDrillParentId(null);
    setSelectedId(null);
  };

  const drillInto = (parentId: string) => {
    setLevel('child');
    setDrillParentId(parentId);
    setSelectedId(null);
  };

  const backToParents = () => {
    setDrillParentId(null);
    setSelectedId(null);
  };

  const allocate = (row: PendingSegmentRow, category: CategoryId) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage(null);
    void api
      .updateSegment(row.cycleId, row.segment.id, { category, note: row.segment.note ?? '' })
      .then(() => {
        const name = data.settings.categories.find((c) => c.id === category)?.name ?? category;
        setMessage(`已把这段睡前时间分配到「${name}」`);
      })
      .catch((e) => setMessage('分配失败：' + (e instanceof Error ? e.message : String(e))))
      .finally(() => {
        locked.current = false;
        setBusy(false);
      });
  };

  const confirmAllocate = () => {
    if (!allocating || !allocateTarget) return;
    allocate(allocating, allocateTarget);
    setAllocating(null);
    setAllocateTarget(null);
  };

  const editingCycle = editor ? cycles.find((c) => c.id === editor.cycleId) : undefined;

  return (
    <div className="page stats-page" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="history-tabs" role="tablist" aria-label="统计视图切换">
        <button
          type="button"
          role="tab"
          id="tab-stats"
          aria-controls="panel-stats"
          aria-selected={panel === 'stats'}
          tabIndex={panel === 'stats' ? 0 : -1}
          onClick={() => showPanel('stats')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              showPanel('manage');
              e.preventDefault();
            }
          }}
        >
          分类统计
        </button>
        <button
          type="button"
          role="tab"
          id="tab-manage"
          aria-controls="panel-manage"
          aria-selected={panel === 'manage'}
          tabIndex={panel === 'manage' ? 0 : -1}
          onClick={() => showPanel('manage')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') {
              showPanel('stats');
              e.preventDefault();
            }
          }}
        >
          分类管理
        </button>
      </div>
      <p className="history-swipe-tip" aria-hidden="true">
        左右滑动切换面板
      </p>

      <div
        className={`history-panel history-panel-${slide}`}
        key={panel}
        id={`panel-${panel}`}
        role="tabpanel"
        aria-labelledby={`tab-${panel}`}
      >
        {panel === 'stats' ? (
          <>
            <div className="stats-period-bar">
              <div className="stats-mode-toggle" role="group" aria-label="统计周期">
                {MODES.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={mode === item.key ? 'active' : ''}
                    aria-pressed={mode === item.key}
                    onClick={() => switchMode(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="stats-period-nav">
                <button
                  type="button"
                  className="btn ghost stats-period-btn"
                  aria-label="上一个周期"
                  disabled={!canPrevPeriod(mode, anchor, earliestMs)}
                  onClick={() => setAnchor(shiftPeriod(mode, anchor, -1))}
                >
                  ‹
                </button>
                <b>{period.label}</b>
                <button
                  type="button"
                  className="btn ghost stats-period-btn"
                  aria-label="下一个周期"
                  disabled={!canNextPeriod(mode, anchor, nowMinute)}
                  onClick={() => setAnchor(shiftPeriod(mode, anchor, 1))}
                >
                  ›
                </button>
              </div>
            </div>

            {cycles.length === 0 ? (
              <div className="hero-card empty">
                <div className="hero-title">还没有可统计的记录</div>
                <p className="hint">先到「今日」录入一次睡眠，这里会按周、月、年汇总分类时间。</p>
              </div>
            ) : (
              <CategoryStatsPanel
                period={period}
                entries={entries}
                pct={pct}
                totalMs={levelTotalMs}
                view={view}
                onViewChange={setView}
                selectedId={selectedId}
                onSelectId={(id) => {
                  setSelectedId(id);
                  setView('single');
                }}
                pending={pending}
                categories={data.settings.categories}
                busy={busy}
                onAllocate={(row) => {
                  setAllocating(row);
                  setAllocateTarget(null);
                }}
                onEditPending={(row) => setEditor({ cycleId: row.cycleId, segment: row.segment })}
                level={level}
                onLevelChange={changeLevel}
                drillParentId={drillParentId}
                onDrill={drillInto}
                onBack={backToParents}
              />
            )}

            {message ? (
              <p
                className={message.startsWith('分配失败') ? 'error' : 'status'}
                role={message.startsWith('分配失败') ? 'alert' : 'status'}
              >
                {message}
              </p>
            ) : null}
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
          </>
        ) : (
          <CategoryManager api={api} />
        )}
      </div>

      <div data-no-swipe>
        <Sheet
          open={!!allocating}
          title="分配睡前时间"
          onClose={() => {
            setAllocating(null);
            setAllocateTarget(null);
          }}
          busy={busy}
        >
          {allocating ? (
            <>
              <p className="hint mono">
                {formatDateShort(allocating.wakeAtMs)} {formatClock(allocating.segment.startAtMs)}–
                {formatClock(allocating.segment.endAtMs || allocating.segment.startAtMs)}
                {' · '}
                {formatHuman(
                  Math.max(
                    0,
                    (allocating.segment.endAtMs || allocating.segment.startAtMs) -
                      allocating.segment.startAtMs,
                  ),
                )}
              </p>
              <CategoryPicker
                categories={data.settings.categories}
                value={allocateTarget}
                onChange={setAllocateTarget}
                allowSleep={false}
                disabled={busy}
              />
              <div className="sheet-actions">
                <button
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => {
                    setAllocating(null);
                    setAllocateTarget(null);
                  }}
                >
                  取消
                </button>
                <button
                  className="btn primary"
                  disabled={busy || !allocateTarget}
                  onClick={confirmAllocate}
                >
                  确认分配
                </button>
              </div>
            </>
          ) : null}
        </Sheet>
        {editor && editingCycle ? (
          <SegmentEditor
            key={`${editor.cycleId}:${editor.segment.id}`}
            segment={editor.segment}
            segments={editingCycle.session?.segments ?? []}
            now={editingCycle.closedAtMs ?? now}
            quickNotes={data.settings.quickNotes}
            title="分配睡前时间"
            onClose={() => setEditor(null)}
            onSplit={(input) => api.splitSegment(editor.cycleId, editor.segment.id, input)}
            categories={data.settings.categories}
            onSave={(patch) => api.updateSegment(editor.cycleId, editor.segment.id, patch)}
            onMerge={(firstId, secondId, category) =>
              api.mergeSegments(editor.cycleId, firstId, secondId, category)
            }
            onFeedback={(kind) => api.feedback(data.settings, kind)}
          />
        ) : null}
      </div>
    </div>
  );
}
