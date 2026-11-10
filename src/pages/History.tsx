import { useMemo, useRef, useState, type TouchEvent } from 'react';
import type { AppApi } from '../state/useApp';
import type { Cycle, Segment } from '../data/store';
import { SegmentEditor } from '../components/SegmentEditor';
import { HistoryWeekPanel } from '../components/HistoryWeekPanel';
import { HistoryMonthPanel } from '../components/HistoryMonthPanel';
import { Sheet } from '../components/Sheet';
import {
  buildDayMetrics,
  buildMonthView,
  buildWeeks,
  monthsWithRecords,
  weekStats,
  type DayMetric,
  type MonthView,
} from '../core/history';

type Panel = 'week' | 'days';

function monthOfDate(ms: number): { year: number; month: number } {
  const d = new Date(ms);
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function History({ api }: { api: AppApi }) {
  const { data, now, live, error } = api;
  const nowMinute = Math.floor(now / 60_000) * 60_000;

  const cycles = useMemo<Cycle[]>(() => data.cycles.map((c) => (
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
      : c
  )), [data.cycles, live]);

  const days = useMemo(() => buildDayMetrics(cycles, nowMinute), [cycles, nowMinute]);
  const weeks = useMemo(() => buildWeeks(days), [days]);
  const months = useMemo(() => monthsWithRecords(days), [days]);

  const latestDay = useMemo(() => {
    let best: DayMetric | null = null;
    for (const day of days.values()) {
      if (!best || day.dateMs > best.dateMs) best = day;
    }
    return best;
  }, [days]);

  const [panel, setPanel] = useState<Panel>('week');
  const [slide, setSlide] = useState<'left' | 'right'>('right');
  const [weekKey, setWeekKey] = useState<string | null>(null);
  const [monthSel, setMonthSel] = useState<{ year: number; month: number } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetYear, setSheetYear] = useState(() => new Date(now).getFullYear());
  const [editor, setEditor] = useState<{ cycleId: string; segment: Segment } | null>(null);

  const activeWeek = weeks.find((week) => week.key === weekKey) ?? weeks[weeks.length - 1] ?? null;
  const activeStats = activeWeek ? weekStats(activeWeek) : null;
  const activeIndex = activeWeek ? weeks.findIndex((week) => week.key === activeWeek.key) : -1;
  const previousStats = activeIndex > 0 ? weekStats(weeks[activeIndex - 1]) : null;

  const fallbackMonth = latestDay ? monthOfDate(latestDay.dateMs) : monthOfDate(nowMinute);
  const activeMonth = monthSel ?? fallbackMonth;
  const monthView: MonthView = useMemo(
    () => buildMonthView(days, activeMonth.year, activeMonth.month, nowMinute),
    [days, activeMonth.year, activeMonth.month, nowMinute],
  );
  const defaultSelectedKey = monthView.recorded.length
    ? monthView.recorded[monthView.recorded.length - 1].dateKey
    : monthView.cells.find((cell) => cell !== null)?.dateKey ?? null;
  const effectiveSelectedKey = selectedKey && monthView.cells.some((cell) => cell?.dateKey === selectedKey)
    ? selectedKey
    : defaultSelectedKey;

  const editingCycle = editor ? cycles.find((c) => c.id === editor.cycleId) : undefined;
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const showPanel = (next: Panel) => {
    if (next === panel) return;
    setSlide(next === 'days' ? 'left' : 'right');
    setPanel(next);
    // 两个面板共用页面滚动；切面板时回到顶部，避免落在另一端的中段。
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
      showPanel(dx < 0 ? 'days' : 'week');
    }
  };

  const openPicker = () => {
    setSheetYear(activeMonth.year);
    setSheetOpen(true);
  };

  const chooseMonth = (year: number, month: number) => {
    setMonthSel({ year, month });
    setSelectedKey(null);
    setSheetOpen(false);
  };

  if (cycles.length === 0) {
    return (
      <div className="page">
        <div className="hero-card empty">
          <div className="hero-title">还没有历史记录</div>
          <p className="hint">在「今日」里录入第一次睡眠后，这里会按周期存档。</p>
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="page history-page" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="history-tabs" role="tablist" aria-label="历史视图切换">
        <button
          type="button" role="tab" id="tab-week" aria-controls="panel-week"
          aria-selected={panel === 'week'} tabIndex={panel === 'week' ? 0 : -1}
          onClick={() => showPanel('week')}
          onKeyDown={(e) => { if (e.key === 'ArrowRight') { showPanel('days'); e.preventDefault(); } }}
        >
          周趋势
        </button>
        <button
          type="button" role="tab" id="tab-days" aria-controls="panel-days"
          aria-selected={panel === 'days'} tabIndex={panel === 'days' ? 0 : -1}
          onClick={() => showPanel('days')}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') { showPanel('week'); e.preventDefault(); } }}
        >
          每日明细
        </button>
      </div>
      <p className="history-swipe-tip" aria-hidden="true">左右滑动切换面板</p>

      <div
        className={`history-panel history-panel-${slide}`}
        key={panel}
        id={`panel-${panel}`}
        role="tabpanel"
        aria-labelledby={`tab-${panel}`}
      >
        {panel === 'week' ? (
          activeWeek && activeStats ? (
            <HistoryWeekPanel
              weeks={weeks}
              active={activeWeek}
              stats={activeStats}
              previousStats={previousStats}
              onSelectWeek={setWeekKey}
              onShowDays={() => showPanel('days')}
            />
          ) : (
            <div className="hero-card empty">
              <div className="hero-title">这一周还没有记录</div>
              <p className="hint">左右滑动周条，或回到有记录的周。</p>
            </div>
          )
        ) : (
          <HistoryMonthPanel
            view={monthView}
            selectedKey={effectiveSelectedKey}
            categories={data.settings.categories}
            nowMs={nowMinute}
            onSelectDay={setSelectedKey}
            onOpenPicker={openPicker}
            onEdit={(cycleId, segment) => setEditor({ cycleId, segment })}
          />
        )}
      </div>

      <div data-no-swipe>
        {editor && editingCycle ? (
          <SegmentEditor
            key={`${editor.cycleId}:${editor.segment.id}`}
            segment={editor.segment}
            segments={editingCycle.session?.segments ?? []}
            now={editingCycle.closedAtMs ?? now}
            quickNotes={data.settings.quickNotes}
            onClose={() => setEditor(null)}
            onSplit={(input) => api.splitSegment(editor.cycleId, editor.segment.id, input)}
            categories={data.settings.categories}
            onSave={(patch) => api.updateSegment(editor.cycleId, editor.segment.id, patch)}
            onMerge={(firstId, secondId, category) => api.mergeSegments(editor.cycleId, firstId, secondId, category)}
          />
        ) : null}
      </div>

      <div data-no-swipe>
        <Sheet open={sheetOpen} title="选择年月" onClose={() => setSheetOpen(false)}>
          <div className="history-year-row">
            <button type="button" className="btn ghost history-year-btn" onClick={() => setSheetYear((y) => y - 1)} aria-label="上一年">‹</button>
            <b>{sheetYear}</b>
            <button type="button" className="btn ghost history-year-btn" onClick={() => setSheetYear((y) => y + 1)} aria-label="下一年">›</button>
          </div>
          <div className="history-month-grid">
            {Array.from({ length: 12 }, (_, i) => {
              const has = months.has(`${sheetYear}-${i}`);
              const active = activeMonth.year === sheetYear && activeMonth.month === i;
              return (
                <button
                  type="button"
                  key={i}
                  className={`history-month-option ${has ? 'has-data' : ''}`}
                  aria-current={active ? 'true' : undefined}
                  aria-label={`${sheetYear}年${i + 1}月${has ? '，有记录' : '，无记录'}`}
                  onClick={() => chooseMonth(sheetYear, i)}
                >
                  {i + 1}月
                  {has ? <i aria-hidden="true" /> : null}
                </button>
              );
            })}
          </div>
        </Sheet>
      </div>

      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}
