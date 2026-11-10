import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet } from './Sheet';
import { deriveSleep, formatClock, formatHuman, toLocalInputValue, validateDuration } from '../core/time';

export interface SleepFormValue {
  wakeAtMs: number;
  sleepDurationMs: number;
  score: number | null;
  note: string | null;
  screenshot: File | null;
}

const QUICK: Array<{ label: string; minutes: number }> = [
  { label: '6h', minutes: 360 },
  { label: '6.5h', minutes: 390 },
  { label: '7h', minutes: 420 },
  { label: '7.5h', minutes: 450 },
  { label: '8h', minutes: 480 },
];

/**
 * 录入只做两件事：点一下"起床"（默认现在），填昨晚睡了多久，入睡时间自动反推。
 * 得分不自己评：需要的话从手表截图抄，或者干脆留着以后 OCR。
 */
export function SleepDialog({
  open,
  onClose,
  onSave,
  initialWake,
  initialDurationMs,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (value: SleepFormValue) => void | Promise<void>;
  initialWake: number;
  /** 默认睡眠时长：开启第二天时沿用上一次，少改一个数 */
  initialDurationMs?: number;
}) {
  const [wake, setWake] = useState(toLocalInputValue(initialWake));
  const [hours, setHours] = useState('7');
  const [minutes, setMinutes] = useState('30');
  const [score, setScore] = useState('');
  const [note, setNote] = useState('');
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  useEffect(() => {
    if (open) {
      const totalMinutes =
        initialDurationMs && initialDurationMs > 0 ? Math.round(initialDurationMs / 60_000) : 450;
      setWake(toLocalInputValue(initialWake));
      setHours(String(Math.floor(totalMinutes / 60)));
      setMinutes(String(totalMinutes % 60));
      setScore('');
      setNote('');
      setScreenshot(null);
      setPreview(null);
      setError(null);
    }
  }, [open, initialWake, initialDurationMs]);

  useEffect(() => {
    if (!screenshot) {
      setPreview(null);
      return undefined;
    }
    const url = URL.createObjectURL(screenshot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);

  const durationMs = useMemo(() => {
    const h = Number(hours || '0');
    const m = Number(minutes || '0');
    if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
    return (h * 60 + m) * 60_000;
  }, [hours, minutes]);

  const wakeAtMs = useMemo(() => new Date(wake).getTime(), [wake]);
  const derived = Number.isFinite(wakeAtMs) && Number.isFinite(durationMs) ? deriveSleep(wakeAtMs, durationMs) : null;
  const sleepAtMs = derived ? derived.sleepAtMs : NaN;

  const setQuick = (m: number) => {
    setHours(String(Math.floor(m / 60)));
    setMinutes(String(m % 60));
  };

  const submit = async () => {
    if (locked.current) return;
    setError(null);
    if (!Number.isFinite(wakeAtMs)) {
      setError('请先点一下"我现在起床了"或选择起床时间');
      return;
    }
    if (wakeAtMs > Date.now() + 60_000) {
      setError('起床时间不能是未来');
      return;
    }
    const durErr = validateDuration(durationMs);
    if (durErr) {
      setError(durErr === 'too-short' || durErr === 'too-long' ? '睡眠时长看起来不太对（应在 1~24 小时之间）' : '睡眠时长要大于 0');
      return;
    }
    locked.current = true;
    setBusy(true);
    try {
      await onSave({
        wakeAtMs,
        sleepDurationMs: durationMs,
        score: score.trim() === '' ? null : Number(score),
        note: note.trim() === '' ? null : note.trim(),
        screenshot,
      });
    } catch (e) {
      setError('保存失败：' + (e instanceof Error ? e.message : String(e)) + '。输入已保留，请重试。');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} title="记一下昨晚的睡眠" busy={busy} onClose={onClose}>
      <fieldset className="editor-fields" disabled={busy}>
      <button
        className="btn primary block"
        style={{ marginBottom: 12 }}
        onClick={() => setWake(toLocalInputValue(Date.now()))}
      >
        我现在起床了（{formatClock(Date.now())}）
      </button>

      <label className="field">
        <span>或者手动选起床时间</span>
        <input type="datetime-local" value={wake} onChange={(e) => setWake(e.target.value)} />
      </label>

      <div className="field">
        <span>昨晚睡了多久</span>
        <div className="duration-row">
          <input
            inputMode="numeric"
            value={hours}
            onChange={(e) => setHours(e.target.value.replace(/[^\d]/g, ''))}
            aria-label="小时"
          />
          <span className="muted">小时</span>
          <input
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))}
            aria-label="分钟"
          />
          <span className="muted">分钟</span>
        </div>
        <div className="chips" style={{ marginTop: 8 }}>
          {QUICK.map((q) => (
            <button key={q.label} className="chip" onClick={() => setQuick(q.minutes)}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      {Number.isFinite(sleepAtMs) ? (
        <p className="hint">
          推算：昨晚 <b>{formatClock(sleepAtMs)}</b> 睡着 → 今早 <b>{formatClock(wakeAtMs)}</b> 醒来（睡了{' '}
          {formatHuman(durationMs)}）
        </p>
      ) : null}

      <div className="field">
        <span>小米睡眠截图（选填，存着以后自动识别）</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
        />
        {preview ? <img className="shot-preview" src={preview} alt="睡眠截图预览" /> : null}
      </div>

      <div className="two-col">
        <label className="field">
          <span>睡眠得分（照抄手表，选填）</span>
          <input inputMode="numeric" placeholder="如 82" value={score} onChange={(e) => setScore(e.target.value)} />
        </label>
        <label className="field">
          <span>一句话备注（选填）</span>
          <input placeholder="睡得怎么样" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      </fieldset>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="sheet-actions">
        <button className="btn ghost" disabled={busy} onClick={onClose}>
          取消
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void submit()}>
          {busy ? '正在保存…' : '保存并开始计时'}
        </button>
      </div>
    </Sheet>
  );
}
