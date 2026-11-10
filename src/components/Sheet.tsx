import { useEffect, useId, useRef, useState } from 'react';

export function Sheet({
  open,
  title,
  onClose,
  children,
  busy = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  busy?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-mask" onClick={() => { if (!busy) onClose(); }}>
      <div className="sheet" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (!busy) onClose();
        }
        if (e.key === 'Tab') {
          const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? []).filter((node) => node.offsetParent !== null);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first) { e.preventDefault(); return; }
          if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { e.preventDefault(); first.focus(); }
        }
      }}>
        <div className="sheet-handle" />
        <div className="sheet-head">
          <div className="sheet-title" id={titleId}>{title}</div>
          <button className="sheet-close" disabled={busy} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function NoteSheet({
  open,
  title,
  initial,
  quickNotes,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  initial: string;
  quickNotes: string[];
  onClose: () => void;
  onSave: (note: string) => void;
}) {
  const [text, setText] = useState(initial);

  useEffect(() => {
    if (open) setText(initial);
  }, [open, initial]);

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <div className="chips">
        {quickNotes.map((q) => (
          <button
            key={q}
            className="chip"
            onClick={() => setText((prev) => (prev ? `${prev} ${q}` : q))}
          >
            {q}
          </button>
        ))}
      </div>
      <textarea
        className="note-input"
        placeholder="这段时间在干什么？（可留空）"
        value={text}
        rows={3}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="sheet-actions">
        <button className="btn ghost" onClick={onClose}>
          跳过
        </button>
        <button className="btn primary" onClick={() => onSave(text.trim())}>
          保存
        </button>
      </div>
    </Sheet>
  );
}
