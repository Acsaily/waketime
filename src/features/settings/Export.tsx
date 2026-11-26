import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppApi, ExportKind } from '../../application/index';
import { summarizeCycle } from '../../modules/time-tracking/index';
import { formatHuman } from '../../modules/time-tracking/index';
import { CycleSummary } from './CycleSummary';

export function ExportPanel({ api }: { api: AppApi }) {
  const { data } = api;
  const [selected, setSelected] = useState<string>(data.cycles[0]?.id ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  useEffect(() => {
    if (!data.cycles.some((c) => c.id === selected)) setSelected(data.cycles[0]?.id ?? '');
  }, [data.cycles, selected]);
  const cycle = useMemo(() => data.cycles.find((c) => c.id === selected), [data.cycles, selected]);
  const totals = cycle ? summarizeCycle(cycle, api.now) : null;

  const doExport = async (kind: ExportKind) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setStatus(null);
    setError(null);
    try {
      setStatus(await api.exportRecords(kind, kind === 'backup' ? undefined : cycle?.id));
    } catch (e) {
      setError('导出失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  if (data.cycles.length === 0) {
    return (
      <div className="section">
        <div className="section-head">
          <span>导出与备份</span>
        </div>
        <div className="hero-card empty">
          <div className="hero-title">还没有可导出的记录</div>
          <p className="hint">
            先记录几天，这里可以把当天记录导出成 TXT / PDF / JSON 交给电脑上的 AI。
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="section">
        <div className="section-head">
          <span>导出与备份</span>
          <span className="small muted">发给电脑上的 AI</span>
        </div>
        <label className="field">
          <span>选择周期</span>
          <select
            id="export-cycle"
            className="select"
            value={selected}
            disabled={busy}
            onChange={(e) => {
              setSelected(e.target.value);
              setStatus(null);
              setError(null);
            }}
          >
            {data.cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}（总睡眠 {formatHuman(summarizeCycle(c, api.now).totalSleepMs)}）
              </option>
            ))}
          </select>
        </label>
        {totals ? (
          <CycleSummary
            totals={totals}
            categories={data.settings.categories}
            sleep
            className="export-summary"
          />
        ) : null}
        {cycle?.closedAtMs === null ? (
          <p className="tiny">本周期还未结束，导出的是当前已记录的内容。</p>
        ) : null}
      </div>

      <div className="buttons-grid">
        <button className="btn primary" disabled={busy || !cycle} onClick={() => doExport('txt')}>
          导出 TXT
        </button>
        <button className="btn primary" disabled={busy || !cycle} onClick={() => doExport('pdf')}>
          导出 PDF
        </button>
        <button className="btn" disabled={busy || !cycle} onClick={() => doExport('json')}>
          导出 JSON
        </button>
        <button className="btn" disabled={busy} onClick={() => doExport('backup')}>
          全量备份 JSON
        </button>
      </div>
      <p className="hint">
        TXT 适合直接丢给 AI 读；PDF 适合存档/打印；JSON 保留完整字段，适合让 AI
        精确计算。导出后会弹系统分享面板，可以发到微信文件传输助手，再到电脑上打开。
      </p>
      {busy ? (
        <p className="hint" role="status">
          正在生成，请勿重复点击…
        </p>
      ) : null}
      {status ? (
        <p className="status" role="status">
          {status}
        </p>
      ) : null}
      {error || api.error ? (
        <p className="error" role="alert">
          {error || api.error}
        </p>
      ) : null}
    </>
  );
}
