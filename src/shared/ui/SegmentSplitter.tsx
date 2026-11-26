import { useState } from 'react';
import type { Segment } from '../../modules/time-tracking/index';
import type { CategoryDefinition } from '../../modules/classification/index';
import { categoryName, selectableCategories } from '../../modules/classification/index';
import { categoryOf } from '../../modules/time-tracking/index';
import {
  matchesSnapshot,
  snapshotOf,
  splitSegments,
  type SplitInput,
} from '../../modules/time-tracking/index';
import { formatHuman } from '../../modules/time-tracking/index';
import { SplitWheel } from './SplitWheel';
import type { FeedbackKind } from '../../application/index';

export function localDateTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export function exactTime(ms: number): string {
  return localDateTime(ms).replace('T', ' ');
}

function midpoint(from: number, to: number): number {
  return from + Math.max(0, Math.floor((to - from) / 2 / 60_000)) * 60_000;
}

export function SegmentSplitter({
  segment,
  segments,
  now,
  categories,
  busy,
  onFeedback,
  onCancel,
  onSave,
}: {
  segment: Segment;
  segments: Segment[];
  now: number;
  categories: CategoryDefinition[];
  busy: boolean;
  onFeedback: (kind: FeedbackKind) => void;
  onCancel: () => void;
  onSave: (input: SplitInput) => Promise<void>;
}) {
  const [expected] = useState(() => snapshotOf(segment));
  const [openedAt] = useState(now);
  const [cuts, setCuts] = useState<number[]>([]);
  const [parts, setParts] = useState(() => [{ category: categoryOf(segment), note: segment.note }]);
  const [cutMs, setCutMs] = useState(() =>
    midpoint(segment.startAtMs, segment.endAtMs || openedAt),
  );
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const current = segments.find((s) => s.id === segment.id);
  const stale = !current || !matchesSnapshot(current, expected);
  // 进行中的段在打开拆分器时冻结尾端，避免每 500ms 重排刻度、把用户拨动的位置顶回去。
  const end = segment.endAtMs || openedAt;
  const wheelStart = cuts.at(-1) ?? segment.startAtMs;
  const draft: SplitInput = { expected, cuts, parts };
  let validation = '';
  if (cuts.length) {
    try {
      splitSegments(
        segments,
        segment.id,
        draft,
        now,
        (() => {
          let n = 0;
          return () => `preview-${segment.id}-${++n}`;
        })(),
      );
    } catch (e) {
      validation = e instanceof Error ? e.message : String(e);
    }
  }
  const addCut = () => {
    const last = cuts.at(-1) ?? segment.startAtMs;
    if (!Number.isSafeInteger(cutMs) || cutMs <= last || cutMs >= end) {
      setError('请拨到原段内部的整分钟分界点，不能重复或越界。');
      return;
    }
    setCuts([...cuts, cutMs]);
    setParts([...parts, { ...parts[parts.length - 1] }]);
    setCutMs(midpoint(cutMs, end));
    setError(null);
  };
  const removeCut = (index: number) => {
    const a = parts[index],
      b = parts[index + 1];
    const merged = {
      category: a.category,
      note: [...new Set([a.note, b.note].filter((n) => n.trim()))].join('\n'),
    };
    setCuts(cuts.filter((_, i) => i !== index));
    setParts([...parts.slice(0, index), merged, ...parts.slice(index + 2)]);
    setCutMs(midpoint(index === 0 ? segment.startAtMs : cuts[index - 1], end));
    setError(null);
  };
  return (
    <section className="split-editor" aria-label="补分段编辑器">
      <h3>拆分这一段</h3>
      <p className="hint">
        {exactTime(segment.startAtMs)} 至{' '}
        {segment.endAtMs ? exactTime(segment.endAtMs) : '现在（继续计时）'}
      </p>
      <p className="tiny">
        只补分界点，不改原段外侧起止。原备注已复制到各段，可分别修改；跨午夜请核对日期。最后的进行中段会继续计时。
      </p>
      {stale ? (
        <p className="error" role="alert">
          这一段已被其他操作修改，请关闭后重新打开。
        </p>
      ) : null}
      <fieldset className="editor-fields" disabled={busy || stale}>
        {!preview ? (
          <>
            <SplitWheel
              key={`${segment.id}:${cuts.join('-')}`}
              startMs={wheelStart}
              endMs={end}
              initialMs={cutMs}
              disabled={busy || stale}
              onFeedback={onFeedback}
              onChange={setCutMs}
            />
            <button
              className="btn block"
              disabled={busy || stale || cutMs <= wheelStart || cutMs >= end}
              onClick={addCut}
            >
              在 {exactTime(cutMs)} 添加分界点
            </button>
            {cuts.length ? (
              <div className="split-cut-list">
                {cuts.map((cut, i) => (
                  <div key={cut}>
                    <span>{exactTime(cut)}</span>
                    <button
                      type="button"
                      className="chip"
                      aria-label={`删除第${i + 1}个分界点`}
                      onClick={() => removeCut(i)}
                    >
                      删除分界
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">
                向上或向下拨动刻度，找到要补的那一分钟，再添加分界点。可以一次添加多个。
              </p>
            )}
          </>
        ) : null}
        {cuts.length ? (
          <div className="split-parts">
            {parts.map((part, i) => {
              const start = i === 0 ? segment.startAtMs : cuts[i - 1];
              const stop = cuts[i] ?? end;
              const open = !segment.endAtMs && i === parts.length - 1;
              return (
                <div className="split-part" key={i}>
                  <h4>
                    第 {i + 1} 段{' '}
                    <span className="muted">
                      {formatHuman(Math.max(0, stop - start))}
                      {open ? ' · 进行中' : ''}
                    </span>
                  </h4>
                  <p className="tiny mono">
                    {exactTime(start)} 至 {open ? '现在' : exactTime(stop)}
                  </p>
                  {preview ? (
                    <>
                      <p>{categoryName(part.category, categories)}</p>
                      <p className="retained-notes">{part.note || '没有备注'}</p>
                    </>
                  ) : (
                    <>
                      <label className="field">
                        <span>第 {i + 1} 段分类</span>
                        <select
                          aria-label={`第${i + 1}段分类`}
                          value={part.category}
                          onChange={(e) =>
                            setParts(
                              parts.map((p, n) =>
                                n === i ? { ...p, category: e.target.value } : p,
                              ),
                            )
                          }
                        >
                          {selectableCategories(categories, expected.category, !open).map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                              {c.archived ? '（已停用，仅保留原类别）' : ''}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span>第 {i + 1} 段备注</span>
                        <textarea
                          aria-label={`第${i + 1}段备注`}
                          rows={2}
                          value={part.note}
                          onChange={(e) =>
                            setParts(
                              parts.map((p, n) => (n === i ? { ...p, note: e.target.value } : p)),
                            )
                          }
                        />
                      </label>
                    </>
                  )}
                </div>
              );
            })}
            <p className="hint">
              合计 {formatHuman(Math.max(0, end - segment.startAtMs))}，原段覆盖范围不变。
              {!segment.endAtMs ? '尾段时长随计时继续增加。' : ''}
            </p>
          </div>
        ) : null}
      </fieldset>
      {validation || error ? (
        <p className="error" role="alert">
          {validation || error}
        </p>
      ) : null}
      <div className="sheet-actions split-actions">
        <button
          className="btn ghost"
          disabled={busy}
          onClick={preview ? () => setPreview(false) : onCancel}
        >
          {preview ? '返回修改' : '取消拆分'}
        </button>
        <button
          className="btn primary"
          disabled={busy || stale || !cuts.length || !!validation}
          onClick={() => {
            if (!preview) {
              setPreview(true);
              return;
            }
            void onSave(draft);
          }}
        >
          {busy ? '正在保存…' : preview ? '确认拆分并保存' : '预览拆分结果'}
        </button>
      </div>
    </section>
  );
}
