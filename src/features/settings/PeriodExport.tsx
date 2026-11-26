import { useState } from 'react';
import {
  periodRange,
  previewPeriod,
  type AppApi,
  type DateRange,
  type PeriodExportKind,
  type PeriodPreset,
} from '../../application/index';
import { formatHuman } from '../../modules/time-tracking/index';

const shortcuts: { preset: PeriodPreset; label: string }[] = [
  { preset: 'this-week', label: '本周' },
  { preset: 'this-month', label: '本月' },
  { preset: 'last-week', label: '上周' },
  { preset: 'last-month', label: '上月' },
  { preset: 'last-7-days', label: '最近 7 天' },
];

export function PeriodExport({
  api,
  busy,
  onChange,
  onExport,
}: {
  api: AppApi;
  busy: boolean;
  onChange: () => void;
  onExport: (kind: PeriodExportKind, range: DateRange, nowMs: number) => void;
}) {
  const [range, setRange] = useState(() => periodRange('this-week', api.now));
  let preview: ReturnType<typeof previewPeriod> | undefined;
  let invalid = '';
  try {
    preview = previewPeriod(api.data.cycles, range, api.now);
  } catch (e) {
    invalid = e instanceof Error ? e.message : String(e);
  }
  const update = (next: DateRange) => {
    setRange(next);
    onChange();
  };
  const disabled = busy || !preview?.cycles.length;
  return (
    <section className="section period-export" aria-label="周期导出">
      <div className="section-head">
        <span>周期导出</span>
        <span className="small muted">按起床日</span>
      </div>
      <div className="chips" aria-label="日期快捷选择">
        {shortcuts.map(({ preset, label }) => (
          <button
            type="button"
            key={preset}
            className="chip"
            disabled={busy}
            onClick={() => update(periodRange(preset, api.now))}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="period-date-fields">
        <label className="field">
          <span>开始日期</span>
          <input
            type="date"
            value={range.startDate}
            disabled={busy}
            aria-invalid={!!invalid}
            aria-describedby="period-range-feedback"
            onChange={(e) => update({ ...range, startDate: e.target.value })}
          />
        </label>
        <label className="field">
          <span>结束日期</span>
          <input
            type="date"
            value={range.endDate}
            disabled={busy}
            aria-invalid={!!invalid}
            aria-describedby="period-range-feedback"
            onChange={(e) => update({ ...range, endDate: e.target.value })}
          />
        </label>
      </div>
      <p className="tiny">含首尾日期；跨午夜的作息周期完整导出。</p>
      <div className="period-preview" aria-label="周期预览">
        <div className="section-head">
          <span>预览</span>
          {preview?.cycles.length ? (
            <strong>
              记录 {preview.recordedDays} 天 · {preview.cycles.length} 个周期
            </strong>
          ) : null}
        </div>
        <div id="period-range-feedback">
          {invalid ? (
            <p className="error" role="alert">
              {invalid}
            </p>
          ) : !preview?.cycles.length ? (
            <p className="hint" role="status">
              所选日期范围内没有记录
            </p>
          ) : null}
        </div>
        {preview?.cycles.length ? (
          <>
            <div className="cycle-summary">
              <div>
                <span>总睡眠</span>
                <strong>{formatHuman(preview.totalSleepMs)}</strong>
              </div>
              <div>
                <span>实际清醒</span>
                <strong>{formatHuman(preview.awakeMs)}</strong>
              </div>
            </div>
            {preview.openCycles > 0 ? (
              <p className="tiny">{preview.openCycles} 个周期尚未结束，按当前已记录内容统计。</p>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="buttons-grid period-export-buttons">
        {(['txt', 'pdf', 'json'] as const).map((kind) => (
          <button
            key={kind}
            className={`btn${kind === 'txt' ? ' primary' : ''}`}
            disabled={disabled}
            onClick={() => onExport(kind, range, api.now)}
          >
            周期 {kind.toUpperCase()}
          </button>
        ))}
      </div>
    </section>
  );
}
