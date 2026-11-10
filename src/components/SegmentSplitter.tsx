import { useState } from 'react';
import type { Segment } from '../data/store';
import type { CategoryDefinition } from '../core/categories';
import { categoryName, selectableCategories } from '../core/categories';
import { categoryOf } from '../core/segments';
import { matchesSnapshot, snapshotOf, splitSegments, type SplitInput } from '../core/splitSegments';
import { formatHuman } from '../core/time';

export function localDateTime(ms: number): string {
  const d = new Date(ms); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export function exactTime(ms: number): string { return localDateTime(ms).replace('T', ' '); }

export function SegmentSplitter({ segment, segments, now, categories, busy, onCancel, onSave }: {
  segment: Segment; segments: Segment[]; now: number; categories: CategoryDefinition[]; busy: boolean;
  onCancel: () => void; onSave: (input: SplitInput) => Promise<void>;
}) {
  const [expected] = useState(() => snapshotOf(segment));
  const [cuts, setCuts] = useState<number[]>([]);
  const [parts, setParts] = useState(() => [{ category: categoryOf(segment), note: segment.note }]);
  const [mode, setMode] = useState<'clock' | 'elapsed'>('clock');
  const [clock, setClock] = useState(() => localDateTime(segment.startAtMs + Math.floor(((segment.endAtMs || now) - segment.startAtMs) / 2)));
  const [elapsed, setElapsed] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const current = segments.find((s) => s.id === segment.id);
  const stale = !current || !matchesSnapshot(current, expected);
  const end = segment.endAtMs || now;
  const draft: SplitInput = { expected, cuts, parts };
  let validation = '';
  if (cuts.length) {
    try { splitSegments(segments, segment.id, draft, now, (() => { let n = 0; return () => `preview-${segment.id}-${++n}`; })()); }
    catch (e) { validation = e instanceof Error ? e.message : String(e); }
  }
  const addCut = () => {
    const value = mode === 'clock' ? new Date(clock).getTime() : elapsed.trim() ? segment.startAtMs + Math.round(Number(elapsed) * 60_000) : NaN;
    const last = cuts.at(-1) ?? segment.startAtMs;
    if (!Number.isSafeInteger(value) || value <= last || value >= end) {
      setError('请按先后顺序添加原段内部的分界点，不能重复、越界或使用未来时间。'); return;
    }
    setCuts([...cuts, value]); setParts([...parts, { ...parts[parts.length - 1] }]);
    setClock(localDateTime(value + Math.floor((end - value) / 2))); setError(null);
  };
  const removeCut = (index: number) => {
    const a = parts[index], b = parts[index + 1];
    const merged = { category: a.category, note: [...new Set([a.note, b.note].filter((n) => n.trim()))].join('\n') };
    setCuts(cuts.filter((_, i) => i !== index));
    setParts([...parts.slice(0, index), merged, ...parts.slice(index + 2)]); setError(null);
  };
  return <section className="split-editor" aria-label="补分段编辑器">
    <h3>拆分这一段</h3>
    <p className="hint">{exactTime(segment.startAtMs)} 至 {segment.endAtMs ? exactTime(segment.endAtMs) : '现在（继续计时）'}</p>
    <p className="tiny">只补分界点，不改原段外侧起止。原备注已复制到各段，可分别修改；跨午夜请核对日期。最后的进行中段会继续计时。</p>
    {stale ? <p className="error" role="alert">这一段已被其他操作修改，请关闭后重新打开。</p> : null}
    <fieldset className="editor-fields" disabled={busy || stale}>
      {!preview ? <>
        <div className="category-options" role="group" aria-label="分界点输入方式">
          <button className={`chip ${mode === 'clock' ? 'active' : ''}`} onClick={() => setMode('clock')}>按日期和时刻</button>
          <button className={`chip ${mode === 'elapsed' ? 'active' : ''}`} onClick={() => setMode('elapsed')}>按经过时长</button>
        </div>
        {mode === 'clock' ? <label className="field"><span>分界日期和时刻</span><input aria-label="分界日期和时刻" type="datetime-local" step="1" value={clock} onChange={(e) => setClock(e.target.value)} /></label>
          : <label className="field"><span>从原段开始经过多少分钟</span><input type="number" aria-label="经过分钟数" min="0" step="0.01" placeholder="例如 80 = 1 小时 20 分" value={elapsed} onChange={(e) => setElapsed(e.target.value)} /></label>}
        <button className="btn block" onClick={addCut}>添加分界点</button>
        {cuts.length ? <div className="split-cut-list">{cuts.map((cut, i) => <div key={cut}><span>{exactTime(cut)}</span><button className="chip" aria-label={`删除第${i + 1}个分界点`} onClick={() => removeCut(i)}>删除分界</button></div>)}</div> : <p className="hint">至少添加一个分界点，可以一次添加多个。</p>}
      </> : null}
      {cuts.length ? <div className="split-parts">
        {parts.map((part, i) => {
          const start = i === 0 ? segment.startAtMs : cuts[i - 1];
          const stop = cuts[i] ?? end;
          const open = !segment.endAtMs && i === parts.length - 1;
          return <div className="split-part" key={i}>
            <h4>第 {i + 1} 段 <span className="muted">{formatHuman(Math.max(0, stop - start))}{open ? ' · 进行中' : ''}</span></h4>
            <p className="tiny mono">{exactTime(start)} 至 {open ? '现在' : exactTime(stop)}</p>
            {preview ? <><p>{categoryName(part.category, categories)}</p><p className="retained-notes">{part.note || '没有备注'}</p></> : <>
              <label className="field"><span>第 {i + 1} 段分类</span><select aria-label={`第${i + 1}段分类`} value={part.category} onChange={(e) => setParts(parts.map((p, n) => n === i ? { ...p, category: e.target.value } : p))}>
                {selectableCategories(categories, expected.category, !open).map((c) => <option key={c.id} value={c.id}>{c.name}{c.archived ? '（已停用，仅保留原类别）' : ''}</option>)}
              </select></label>
              <label className="field"><span>第 {i + 1} 段备注</span><textarea aria-label={`第${i + 1}段备注`} rows={2} value={part.note} onChange={(e) => setParts(parts.map((p, n) => n === i ? { ...p, note: e.target.value } : p))} /></label>
            </>}
          </div>;
        })}
        <p className="hint">合计 {formatHuman(Math.max(0, end - segment.startAtMs))}，原段覆盖范围不变。{!segment.endAtMs ? '尾段时长随计时继续增加。' : ''}</p>
      </div> : null}
    </fieldset>
    {validation || error ? <p className="error" role="alert">{validation || error}</p> : null}
    <div className="sheet-actions split-actions">
      <button className="btn ghost" disabled={busy} onClick={preview ? () => setPreview(false) : onCancel}>{preview ? '返回修改' : '取消拆分'}</button>
      <button className="btn primary" disabled={busy || stale || !cuts.length || !!validation} onClick={() => {
        if (!preview) { setPreview(true); return; }
        void onSave(draft);
      }}>{busy ? '正在保存…' : preview ? '确认拆分并保存' : '预览拆分结果'}</button>
    </div>
  </section>;
}
