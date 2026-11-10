import { useEffect, useRef, useState } from 'react';
import type { AppApi } from '../state/useApp';
import { SleepDialog, type SleepFormValue } from '../components/SleepDialog';
import { SegmentEditor } from '../components/SegmentEditor';
import { CycleSummary } from '../components/CycleSummary';
import { Timeline } from '../components/Timeline';
import type { Segment } from '../data/store';
import { screenshotUrl } from '../data/files';
import { deriveTimerDisplay, formatClock, formatDuration, formatHuman } from '../core/time';
import { categoryOf, summarizeCycle } from '../core/segments';
import { wakeDateOf } from '../core/trends';

export function Today({ api }: { api: AppApi }) {
  const { live, data, now, error } = api;
  const [sleepOpen, setSleepOpen] = useState(false);
  const [editor, setEditor] = useState<{ cycleId: string; segment: Segment; afterLap: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const locked = useRef(false);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [shotOpen, setShotOpen] = useState(false);

  // 不按午夜切天：只有用户主动开启第二天才进入新周期。
  const active = live !== null && live.status !== 'idle' && live.cycleId !== '';
  const cycle = active ? data.cycles.find((c) => c.id === live?.cycleId) : undefined;
  const segments: Segment[] = active ? live!.segments : [];
  const running = live?.status === 'running';
  const openSegment = segments.find((s) => s.endAtMs === 0);
  const napping = running && !!openSegment && categoryOf(openSegment) === 'sleep';
  const timer = active && live ? deriveTimerDisplay(live.wakeAtMs, live.targetAtMs, now) : null;
  const overrun = timer?.phase === 'overrun';
  // 活动段采用原生最新镜像，所有汇总均复用 core 的统一口径。
  const totals = cycle && live ? summarizeCycle({
    ...cycle,
    sleepAtMs: live.sleepAtMs,
    wakeAtMs: live.wakeAtMs,
    targetAtMs: live.targetAtMs,
    session: { id: live.sessionId, status: running ? 'running' : 'ended', startedAtMs: live.sessionStartedAtMs, segments },
  }, now) : null;
  const budget = Math.max(0, 86_400_000 - (totals?.totalSleepMs ?? (live ? live.wakeAtMs - live.sleepAtMs : 0)));
  const pendingNotes = segments.filter((s) => s.endAtMs > 0 && !s.note?.trim() && s.source === 'notification');

  useEffect(() => {
    let cancelled = false;
    setShotUrl(null);
    if (cycle?.screenshotPath) {
      screenshotUrl(cycle.screenshotPath).then((url) => {
        if (!cancelled) setShotUrl(url);
      }).catch((e) => {
        if (!cancelled) setActionError('睡眠截图读取失败：' + String(e));
      });
    }
    return () => { cancelled = true; };
  }, [cycle?.screenshotPath]);

  // ref 在第一个 await 前上锁，防止同一渲染周期内双击。
  const perform = async (label: string, action: () => Promise<unknown>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(`${label}失败：${e instanceof Error ? e.message : String(e)}。请重试。`);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const onSaveSleep = async (value: SleepFormValue) => {
    await api.startCycle(value); // SleepDialog 自己处理 busy 和可重试错误，不吞掉异常。
    setSleepOpen(false);
  };
  const onLap = () => {
    if (!running || napping || !live) return;
    const cycleId = live.cycleId;
    void perform('计次', async () => {
      const state = await api.lap('');
      const ended = state.segments.filter((s) => s.endAtMs > 0).slice(-1)[0];
      if (ended) setEditor({ cycleId, segment: ended, afterLap: true });
    });
  };
  const onEditSegment = (segment: Segment) => {
    if (live && !busy) setEditor({ cycleId: live.cycleId, segment, afterLap: false });
  };
  const onCloseDay = () => {
    if (locked.current || !window.confirm('结束这个周期？结束后不能再新增记录，历史里仍可编辑与合并；下次起床点「开启第二天」。')) return;
    void perform('结束本周期', api.closeCycle);
  };

  const defaultWake = new Date();
  defaultWake.setHours(7, 0, 0, 0);
  if (defaultWake.getTime() > Date.now()) defaultWake.setDate(defaultWake.getDate() - 1);

  if (!active) {
    return (
      <div className="page">
        <div className="hero-card empty">
          <div className="hero-title">开启新的一天</div>
          <p className="hint">睡醒后点一下「我现在起床了」，再填昨晚睡了多久，开始记录这一周期。</p>
          <button className="btn primary block" onClick={() => setSleepOpen(true)}>录入昨晚的睡眠</button>
        </div>
        {actionError || error ? <p className="error" role="alert">{actionError || error}</p> : null}
        <SleepDialog open={sleepOpen} onClose={() => setSleepOpen(false)} onSave={onSaveSleep} initialWake={defaultWake.getTime()} />
      </div>
    );
  }

  return (
    <div className="page" aria-busy={busy}>
      <div className="sleep-card">
        <div className="sleep-head">
          <span>当前周期 · {wakeDateOf(live!.wakeAtMs)} 起床</span>
          <span className="mono">{formatClock(live!.sleepAtMs)} → {formatClock(live!.wakeAtMs)}</span>
        </div>
        <div className="sleep-body">
          <div><div className="big-num">{formatHuman(totals?.totalSleepMs ?? live!.wakeAtMs - live!.sleepAtMs)}</div><div className="muted small">总睡眠（含补觉）</div></div>
          <div><div className="big-num">{formatHuman(budget)}</div><div className="muted small">清醒预算</div></div>
          {cycle?.sleepMetrics.score !== null && cycle?.sleepMetrics.score !== undefined ? <div><div className="big-num">{cycle.sleepMetrics.score}</div><div className="muted small">手表得分</div></div> : null}
        </div>
        {totals ? <p className="tiny">主睡眠 {formatHuman(totals.mainSleepMs)}，补觉 {formatHuman(totals.napMs)}</p> : null}
        <div className="sleep-foot">
          <span className="muted small">参考截止 {formatClock(live!.targetAtMs)}（固定） · 已完成 {segments.filter((s) => s.endAtMs > 0).length} 段</span>
          <button className="link" disabled={busy} onClick={onCloseDay}>结束本周期</button>
        </div>
        {shotUrl ? <button className="shot-thumb" onClick={() => setShotOpen(true)}><img src={shotUrl} alt="小米睡眠截图" /><span>睡眠截图</span></button> : null}
      </div>

      <div className={`countdown-card ${overrun ? 'over' : ''}`}>
        <div className="card-label">{overrun ? '已超时（超过参考截止）' : '距参考截止剩余'}</div>
        <div className="countdown-value">{timer ? formatDuration(timer.valueMs) : '--:--:--'}</div>
        <div className="progress"><div className="progress-fill" style={{ width: `${Math.round((timer?.progress ?? 0) * 100)}%` }} /></div>
        <div className="muted small">距本次起床 {timer ? formatDuration(timer.sinceWakeMs) : '--'}（含补觉，不等于实际清醒）</div>
        <p className="hint">参考截止为本周期主睡眠开始 + 24 小时，补觉不会顺延；剩余时间按真实时钟继续走。</p>
      </div>

      <div className={`stopwatch-card ${napping ? 'napping' : ''}`}>
        <div className="section-head"><span className="card-label">实际清醒（不含补觉）</span>{napping ? <span className="nap-status" role="status">补觉中 · 秒表暂停</span> : null}</div>
        <div className="stopwatch-value">{formatDuration(totals?.awakeMs ?? timer?.sinceWakeMs ?? 0)}</div>
        <div className="stopwatch-actions">
          {running ? napping ? (
            <button className="btn primary block" disabled={busy} onClick={() => void perform('结束补觉', api.endNap)}>结束补觉</button>
          ) : <>
            <button className="btn primary" disabled={busy} onClick={onLap}>计次</button>
            <button className="btn ghost" disabled={busy} onClick={() => void perform('结束计时', api.endSession)}>结束计时</button>
          </> : <button className="btn primary block" disabled={busy} onClick={() => void perform('继续计时', api.restartSession)}>继续计时</button>}
        </div>
        {running && !napping ? <button className="btn ghost block nap-action" disabled={busy} onClick={() => void perform('开始补觉', api.startNap)}>开始补觉</button> : null}
        <p className="tiny">{napping ? '醒来后点「结束补觉」，自动开始新的未分类清醒段。补觉期间不能计次。' : running ? '计次先结束当前段，再填写该段的分类与备注；补觉会单独记录，不计入清醒。' : '计次已暂停，暂停空档仍计入实际清醒。要记录补觉，请先继续计时，再点「开始补觉」。'}</p>
        {busy ? <p className="hint" role="status">正在处理，请稍候…</p> : null}
        {actionError ? <p className="error" role="alert">{actionError}</p> : null}
      </div>

      {totals ? <CycleSummary totals={totals} categories={data.settings.categories} /> : null}

      {pendingNotes.length > 0 ? <button className="pending-note" disabled={busy} onClick={() => onEditSegment(pendingNotes[pendingNotes.length - 1])}>通知栏有 {pendingNotes.length} 段还没写备注，点这里补分类与备注</button> : null}
      <div className="section">
        <div className="section-head"><span>当前周期时间轴</span><span className="muted small">{segments.length} 段</span></div>
        <p className="tiny">点任意段编辑分类、备注、拆分或合并相邻连续段。</p>
        <Timeline categories={data.settings.categories} segments={segments} now={now} onEdit={onEditSegment} disabled={busy} />
      </div>

      {editor && editor.cycleId === live!.cycleId ? <SegmentEditor
        key={`${editor.cycleId}:${editor.segment.id}`}
        segment={editor.segment} segments={segments} now={now} quickNotes={data.settings.quickNotes}
        title={editor.afterLap ? '刚结束的这一段' : '编辑这一段'}
        onClose={() => setEditor(null)}
        onSplit={(input) => api.splitSegment(editor.cycleId, editor.segment.id, input)}
        categories={data.settings.categories}
        onSave={(patch) => api.updateSegment(editor.cycleId, editor.segment.id, patch)}
        onMerge={(firstId, secondId, category) => api.mergeSegments(editor.cycleId, firstId, secondId, category)}
      /> : null}
      {shotOpen && shotUrl ? <div className="shot-mask" role="dialog" aria-label="睡眠截图" onClick={() => setShotOpen(false)}><img src={shotUrl} alt="小米睡眠截图" onClick={(e) => e.stopPropagation()} /><button className="btn ghost" onClick={() => setShotOpen(false)}>关闭截图</button></div> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}
