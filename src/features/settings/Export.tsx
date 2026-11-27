import { useState } from 'react';
import {
  periodRange,
  previewPeriod,
  type AppApi,
  type DateRange,
  type PeriodPreset,
} from '../../application/index';
import { summarizeCycle, formatHuman, formatClock } from '../../modules/time-tracking/index';
import { CycleSummary } from './CycleSummary';

const shortcuts: { preset: PeriodPreset; label: string }[] = [
  { preset: 'this-week', label: '本周' },
  { preset: 'this-month', label: '本月' },
  { preset: 'last-week', label: '上周' },
  { preset: 'last-month', label: '上月' },
  { preset: 'last-7-days', label: '最近 7 天' },
];

export function ExportPanel({
  api,
  busy,
  message,
  onChange,
  onExport,
}: {
  api: AppApi;
  busy: boolean;
  message: { text: string; error: boolean } | null;
  onChange: () => void;
  onExport: (action: () => Promise<string>) => void;
}) {
  const [range, setRange] = useState(() => periodRange('this-week', api.now));
  const [selectedId, setSelectedId] = useState('');
  let preview: ReturnType<typeof previewPeriod> | undefined;
  let invalid = '';
  try {
    preview = previewPeriod(api.data.cycles, range, api.now);
  } catch (e) {
    invalid = e instanceof Error ? e.message : String(e);
  }
  const sameDay = range.startDate === range.endDate;
  const choices = sameDay ? (preview?.cycles ?? []) : [];
  const selected = choices.length === 1 ? choices[0] : choices.find((c) => c.id === selectedId);
  const totals = selected ? summarizeCycle(selected, api.now) : null;
  const recordedDays = selected ? 1 : (preview?.recordedDays ?? 0);
  const count = selected ? 1 : (preview?.cycles.length ?? 0);
  const openCycles = selected ? Number(selected.closedAtMs === null) : (preview?.openCycles ?? 0);
  const update = (next: DateRange) => {
    setRange(next);
    setSelectedId('');
    onChange();
  };
  const disabled = busy || !count;
  return (
    <section className="section period-export" aria-label="导出与备份">
      <div className="section-head">
        <span>导出与备份</span>
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
      {choices.length > 1 ? (
        <label className="field">
          <span>选择作息周期</span>
          <select
            className="select"
            value={selected?.id ?? ''}
            disabled={busy}
            onChange={(e) => {
              setSelectedId(e.target.value);
              onChange();
            }}
          >
            <option value="">当天全部周期（{choices.length} 个）</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} · {formatClock(c.wakeAtMs)} 起床
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="period-preview" aria-label="导出预览">
        <div className="section-head">
          <span>预览</span>
          {count ? (
            <strong>
              记录 {recordedDays} 天 · {count} 个周期
            </strong>
          ) : null}
        </div>
        <div id="period-range-feedback">
          {invalid ? (
            <p className="error" role="alert">
              {invalid}
            </p>
          ) : !count ? (
            <p className="hint" role="status">
              所选日期范围内没有记录
            </p>
          ) : null}
        </div>
        {count && preview ? (
          <>
            <div className="cycle-summary">
              <div>
                <span>总睡眠</span>
                <strong>{formatHuman(totals?.totalSleepMs ?? preview.totalSleepMs)}</strong>
              </div>
              <div>
                <span>实际清醒</span>
                <strong>{formatHuman(totals?.awakeMs ?? preview.awakeMs)}</strong>
              </div>
            </div>
            {totals ? (
              <CycleSummary
                totals={totals}
                categories={api.data.settings.categories}
                className="export-summary"
              />
            ) : null}
            {openCycles ? (
              <p className="tiny">{openCycles} 个周期尚未结束，按当前已记录内容统计。</p>
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
            onClick={() =>
              onExport(() =>
                selected
                  ? api.exportRecords(kind, selected.id, api.now)
                  : api.exportPeriod(kind, range, api.now),
              )
            }
          >
            导出 {kind.toUpperCase()}
          </button>
        ))}
      </div>
      <p className="hint">TXT 适合 AI 阅读；PDF 适合存档；JSON 保留完整字段。</p>
      {message ? (
        <p className={message.error ? 'error' : 'status'} role={message.error ? 'alert' : 'status'}>
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
