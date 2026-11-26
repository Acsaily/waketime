import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { FeedbackKind } from '../../application/index';

/** 滑到 86% 松手确认；也保留一个普通按钮，方便操作或无障碍使用。 */
export function MergeSlide({
  label,
  disabled,
  busy,
  onFeedback,
  onConfirm,
}: {
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onFeedback: (kind: FeedbackKind) => void;
  onConfirm: () => void;
}) {
  const [ratio, setRatio] = useState(0);
  const [armed, setArmed] = useState(false);
  const dragging = useRef(false);
  const rect = useRef<{ left: number; width: number } | null>(null);
  const armedRef = useRef(false);
  const track = useRef<HTMLDivElement>(null);

  const setArmedState = (next: boolean) => {
    if (armedRef.current === next) return;
    armedRef.current = next;
    setArmed(next);
    if (next) onFeedback('detent');
  };

  const move = (clientX: number) => {
    const box = rect.current;
    if (!box) return;
    const next = Math.max(0, Math.min(1, (clientX - box.left - 26) / Math.max(1, box.width - 52)));
    setRatio(next);
    setArmedState(next >= 0.86);
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || busy || !track.current) return;
    const box = track.current.getBoundingClientRect();
    rect.current = { left: box.left, width: box.width };
    dragging.current = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* 合成事件或旧 WebView 没有指针捕获 */
    }
    move(event.clientX);
  };

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    move(event.clientX);
  };

  const onUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (armedRef.current) {
      armedRef.current = false;
      setArmed(false);
      setRatio(0);
      onConfirm();
    } else {
      setRatio(0);
    }
  };

  const onCancel = () => {
    dragging.current = false;
    armedRef.current = false;
    setArmed(false);
    setRatio(0);
  };

  return (
    <div className={`merge-slide ${armed ? 'armed' : ''} ${disabled || busy ? 'disabled' : ''}`}>
      <div
        ref={track}
        className="merge-slide-track"
        role="presentation"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        style={{ '--merge-p': `${ratio * 100}%` } as CSSProperties}
      >
        <div className="merge-slide-fill" />
        <span className="merge-slide-text">{armed ? '松手确认合并' : label}</span>
        <div className="merge-slide-thumb" aria-hidden="true">
          ›
        </div>
      </div>
      <button
        type="button"
        className="btn ghost merge-slide-fallback"
        disabled={disabled || busy}
        onClick={onConfirm}
      >
        直接确认合并
      </button>
    </div>
  );
}
