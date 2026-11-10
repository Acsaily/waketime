import { useEffect, useRef, useState } from 'react';
import type { Segment } from '../data/store';
import type { SegmentCategory } from '../native/contracts';
import { categoryLabel, categoryOf } from '../core/segments';
import { formatClock, formatHuman } from '../core/time';
import { Sheet } from './Sheet';
import { SegmentSplitter } from './SegmentSplitter';
import { selectableCategories, type CategoryDefinition } from '../core/categories';
import type { SplitInput } from '../core/splitSegments';

type Details = { note: string; category: SegmentCategory };
type MergePair = { first: Segment; second: Segment };

/** UI 只提供相邻且精确连续的候选，数据层仍负责在刷新后重新校验。 */
function isContinuous(first: Segment | undefined, second: Segment | undefined): boolean {
  return !!first && !!second && first.endAtMs > 0 && first.endAtMs === second.startAtMs;
}

export function SegmentEditor({
  segment,
  segments,
  now,
  quickNotes,
  title = '编辑这一段',
  onClose,
  onSave,
  onMerge,
  onSplit,
  categories,
}: {
  segment: Segment;
  segments: Segment[];
  now: number;
  quickNotes: string[];
  title?: string;
  onClose: () => void;
  onSave: (patch: Details) => Promise<void>;
  onMerge: (firstId: string, secondId: string, category: SegmentCategory) => Promise<void>;
  onSplit: (input: SplitInput) => Promise<void>;
  categories: CategoryDefinition[];
}) {
  const [note, setNote] = useState(segment.note ?? '');
  const [category, setCategory] = useState<SegmentCategory>(categoryOf(segment));
  const [direction, setDirection] = useState<'previous' | 'next' | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [mergeCategory, setMergeCategory] = useState<SegmentCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = useRef(false);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorMessage.current?.focus();
      errorMessage.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [error]);

  // 引用最新时间轴，不用打开弹层时的快照决定可否合并。
  const index = segments.findIndex((s) => s.id === segment.id);
  const current = segments[index];
  const previous = index > 0 ? segments[index - 1] : undefined;
  const next = index >= 0 ? segments[index + 1] : undefined;
  const open = current?.endAtMs === 0;
  const napping = open && categoryOf(current) === 'sleep';
  const dirty = note.trim() !== (current?.note ?? '').trim() || category !== categoryOf(current ?? segment);
  const canPrevious = isContinuous(previous, current);
  const canNext = isContinuous(current, next);
  const pair: MergePair | null = direction === 'previous' && canPrevious
    ? { first: previous!, second: current }
    : direction === 'next' && canNext ? { first: current, second: next! } : null;
  const availableCategories = napping ? ['sleep'] : selectableCategories(categories, categoryOf(current ?? segment), !open).map((c) => c.id);
  const mergeCategories = pair?.second.endAtMs === 0 && categoryOf(pair.second) === 'sleep'
    ? ['sleep'] : selectableCategories(categories, undefined, pair?.second.endAtMs !== 0).map((c) => c.id);
  const retainedNotes = pair
    ? [...new Set([pair.first.note, pair.second.note].filter((text) => text?.trim()))].join('\n')
    : '';

  const perform = async (action: () => Promise<void>, label: string) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(`${label}失败：${e instanceof Error ? e.message : String(e)}。修改仍保留，可重试。`);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const chooseMerge = (value: 'previous' | 'next') => {
    setDirection(value);
    setMergeCategory(null); // 即使原类别相同，也必须由用户明确选择。
    setError(null);
  };

  return (
    <Sheet open title={title} busy={busy} onClose={onClose}>
      <p className="hint mono">
        {formatClock(segment.startAtMs)} – {current?.endAtMs ? formatClock(current.endAtMs) : '现在'}
        {' · '}{formatHuman(Math.max(0, (current?.endAtMs || now) - segment.startAtMs))}
      </p>
      {!current ? <p className="error" role="alert">这一段已被其他操作更改或合并，请关闭后重新选择。</p> : null}
      {splitting && current ? <SegmentSplitter segment={current} segments={segments} now={now} categories={categories} busy={busy} onCancel={() => setSplitting(false)} onSave={(input) => perform(() => onSplit(input), '拆分')} /> : <>
      <fieldset className="editor-fields" disabled={busy || !current}>
        <legend>这段时间的类别</legend>
        <div className="category-options">
          {availableCategories.map((value) => (
            <label key={value} className={`category-option category-${value} ${category === value ? 'selected' : ''}`}>
              <input type="radio" name="segment-category" value={value} checked={category === value} onChange={() => setCategory(value)} />
              {categoryLabel(value, categories)}
            </label>
          ))}
        </div>
        {open ? <p className="tiny">{napping ? '补觉进行中。请用「结束补觉」恢复清醒，不能在这里改成清醒类别。' : '进行中段只能选清醒类别；要记录睡眠，请用「开始补觉」。已完成段可以标为补觉。'}</p> : null}
        <label className="field">
          <span>备注（可留空）</span>
          <textarea className="note-input" value={note} rows={3} placeholder="这段时间在做什么？" onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="chips">
          {quickNotes.map((text) => <button type="button" key={text} className="chip" onClick={() => setNote((prev) => prev ? `${prev} ${text}` : text)}>{text}</button>)}
        </div>
      </fieldset>
      <div className="sheet-actions">
        <button className="btn ghost" disabled={busy} onClick={onClose}>取消</button>
        <button className="btn primary" disabled={busy || !current} onClick={() => void perform(() => onSave({ note: note.trim(), category }), '保存')}>
          {busy ? '正在处理…' : '保存分类与备注'}
        </button>
      </div>

      <div className="merge-section">
        <h3>补上漏记的分段</h3>
        <p className="tiny">一大段里包含了不同活动？补上分界点，再分别填写分类与备注。原段总时间不变。</p>
        {dirty ? <p className="hint">有未保存修改，请先保存，再拆分。</p> : null}
        {napping ? <p className="hint">正在补觉，请先结束补觉再拆分。</p> : null}
        <button className="btn block" disabled={busy || dirty || !current || napping} onClick={() => { setSplitting(true); setDirection(null); setError(null); }}>拆分这一段</button>
      </div>
      <div className="merge-section">
        <h3>合并相邻段</h3>
        <p className="tiny">只能合并首段已结束、相邻且连续的两段，不跨暂停空档。不同备注换行保留，完全相同的备注只保留一次。</p>
        {dirty ? <p className="hint">有未保存修改，请先保存，再打开此段合并。</p> : null}
        <div className="buttons-grid">
          <button className="btn ghost" disabled={busy || dirty || !canPrevious} onClick={() => chooseMerge('previous')}>合并前一段</button>
          <button className="btn ghost" disabled={busy || dirty || !canNext} onClick={() => chooseMerge('next')}>合并后一段</button>
        </div>
        {!canPrevious && !canNext ? <p className="tiny">没有可合并的相邻连续段。</p> : null}
        {pair && !dirty ? (
          <div className="merge-preview">
            <p className="hint mono">{formatClock(pair.first.startAtMs)} – {pair.second.endAtMs ? formatClock(pair.second.endAtMs) : '现在'}</p>
            <p className="hint">{categoryLabel(categoryOf(pair.first), categories)} + {categoryLabel(categoryOf(pair.second), categories)}，合并后{pair.second.endAtMs === 0 ? '仍在进行' : '为已完成段'}。</p>
            <fieldset className="editor-fields" disabled={busy}>
              <legend>请选择合并后的类别（必选）</legend>
              <div className="category-options">
                {mergeCategories.map((value) => (
                  <label key={value} className={`category-option category-${value} ${mergeCategory === value ? 'selected' : ''}`}>
                    <input type="radio" name="merge-category" checked={mergeCategory === value} onChange={() => setMergeCategory(value)} />
                    {categoryLabel(value, categories)}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="tiny">合并后保留的备注</p>
            <p className="retained-notes">{retainedNotes || '两段都没有备注'}</p>
            <button className="btn block" disabled={busy || mergeCategory === null || !mergeCategories.includes(mergeCategory)} onClick={() => {
              if (mergeCategory) void perform(() => onMerge(pair.first.id, pair.second.id, mergeCategory), '合并');
            }}>确认合并{direction === 'previous' ? '前一段' : '后一段'}</button>
          </div>
        ) : null}
      </div>
      </>}
      {error ? <p className="error" role="alert" tabIndex={-1} ref={errorMessage}>{error}</p> : null}
    </Sheet>
  );
}
