import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock, formatHuman } from '../../modules/time-tracking/index';
import type { FeedbackKind } from '../../application/index';

const ROW_HEIGHT = 34;
const VIEWPORT = 170;
const MINUTE = 60_000;

function nearestIndex(minutes: number[], target: number): number {
  let best = 0;
  for (let i = 1; i < minutes.length; i++) {
    if (Math.abs(minutes[i] - target) < Math.abs(minutes[best] - target)) best = i;
  }
  return best;
}

/** 像行李箱密码盘一样上下拨动：每格 1 分钟，5 / 15 分钟有刻度强调。 */
export function SplitWheel({
  startMs,
  endMs,
  initialMs,
  disabled,
  onFeedback,
  onChange,
}: {
  startMs: number;
  endMs: number;
  initialMs: number;
  disabled?: boolean;
  onFeedback: (kind: FeedbackKind) => void;
  onChange: (ms: number) => void;
}) {
  const minutes = useMemo(() => {
    const first = Math.floor(startMs / MINUTE) * MINUTE + MINUTE;
    const last = Math.ceil(endMs / MINUTE) * MINUTE - MINUTE;
    const out: number[] = [];
    for (let ms = first; ms <= last; ms += MINUTE) out.push(ms);
    return out;
  }, [startMs, endMs]);
  const initialIndex = minutes.length ? nearestIndex(minutes, initialMs) : 0;
  const [index, setIndex] = useState(initialIndex);
  const viewport = useRef<HTMLDivElement>(null);
  const lastValue = useRef<number | null>(minutes[initialIndex] ?? null);
  const lastFeedbackAt = useRef(0);

  // 只在挂载时定位一次；用户拨动后不能再被渲染重置。
  useEffect(() => {
    const el = viewport.current;
    if (el) el.scrollTop = initialIndex * ROW_HEIGHT;
    // 父组件的初始值按整分钟对齐，避免显示 10:01 却按 10:01:30 切分。
    if (minutes.length) onChange(minutes[initialIndex]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!minutes.length) {
    return <p className="hint">这段不到两分钟，没有可用的整分钟分界点。</p>;
  }

  const commit = (nextIndex: number) => {
    const clamped = Math.max(0, Math.min(minutes.length - 1, nextIndex));
    setIndex(clamped);
    const value = minutes[clamped];
    if (value === lastValue.current) return;
    lastValue.current = value;
    onChange(value);
    const now = Date.now();
    if (now - lastFeedbackAt.current > 45) {
      lastFeedbackAt.current = now;
      onFeedback('tick');
    }
  };

  const onScroll = () => {
    const el = viewport.current;
    if (!el || disabled) return;
    commit(Math.round(el.scrollTop / ROW_HEIGHT));
  };

  const nudge = (delta: number) => {
    const next = Math.max(0, Math.min(minutes.length - 1, index + delta));
    if (next === index) return;
    viewport.current?.scrollTo({ top: next * ROW_HEIGHT, behavior: 'smooth' });
    commit(next);
    onFeedback('detent');
  };

  const selected = minutes[index];
  return (
    <div className={`split-wheel ${disabled ? 'disabled' : ''}`}>
      <div className="split-wheel-head">
        <span>上下拨动刻度，选分界点</span>
        <b className="mono">{formatClock(selected)}</b>
      </div>
      <div className="split-wheel-body">
        <div className="split-wheel-marker" aria-hidden="true" />
        <div
          className="split-wheel-viewport"
          ref={viewport}
          onScroll={onScroll}
          style={{ height: VIEWPORT }}
          aria-hidden="true"
        >
          <div style={{ height: (VIEWPORT - ROW_HEIGHT) / 2 }} />
          {minutes.map((ms, i) => {
            const d = new Date(ms);
            const minute = d.getMinutes();
            const five = minute % 5 === 0;
            const quarter = minute % 15 === 0;
            return (
              <div
                key={ms}
                className={`split-wheel-row ${i === index ? 'selected' : ''} ${five ? 'five' : ''} ${quarter ? 'quarter' : ''}`}
                style={{ height: ROW_HEIGHT }}
              >
                <span>{five ? formatClock(ms) : `:${String(minute).padStart(2, '0')}`}</span>
                {quarter ? <i>{formatHuman(ms - startMs)}</i> : null}
              </div>
            );
          })}
          <div style={{ height: (VIEWPORT - ROW_HEIGHT) / 2 }} />
        </div>
      </div>
      <div className="split-wheel-controls">
        <button
          type="button"
          className="btn ghost"
          disabled={disabled || index === 0}
          onClick={() => nudge(-1)}
          aria-label="分界点提前一分钟"
        >
          −1 分
        </button>
        <span className="tiny">距开始 {formatHuman(Math.max(0, selected - startMs))}</span>
        <button
          type="button"
          className="btn ghost"
          disabled={disabled || index === minutes.length - 1}
          onClick={() => nudge(1)}
          aria-label="分界点推后一分钟"
        >
          +1 分
        </button>
      </div>
      <label className="split-wheel-range">
        <span className="tiny">用滑块精确调整（无障碍）</span>
        <input
          type="range"
          min={0}
          max={minutes.length - 1}
          step={1}
          value={index}
          disabled={disabled}
          aria-label="分界点分钟"
          onChange={(e) => commit(Number(e.target.value))}
        />
      </label>
    </div>
  );
}
