import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppApi } from '../state/useApp';
import { buildBackupJson, buildDayTxt, dayFileName, shareTextFile } from '../export/format';
import { buildPdfBlocks } from '../export/pdfDoc';
import { PdfExport } from '../native/pdfExport';
import { isNativePlatform } from '../native/wakeTimer';
import { summarizeCycle } from '../core/segments';
import { formatHuman } from '../core/time';
import { CycleSummary } from '../components/CycleSummary';

type ExportKind = 'txt' | 'json' | 'pdf' | 'backup';

export function Export({ api }: { api: AppApi }) {
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
      if (kind === 'backup') {
        const text = buildBackupJson(data.cycles, data.settings);
        await shareTextFile(`waketime-backup-${new Date().toISOString().slice(0, 10)}.json`, text);
        setStatus('已生成全量备份，选择保存位置或发给文件传输助手');
        return;
      }
      if (!cycle) throw new Error('请重新选择要导出的周期');
      if (kind === 'txt') {
        await shareTextFile(dayFileName(cycle.id, 'txt'), buildDayTxt(cycle, data.cycles, data.settings.categories));
        setStatus(`已生成 ${cycle.id} 的 TXT`);
      } else if (kind === 'json') {
        await shareTextFile(dayFileName(cycle.id, 'json'), buildBackupJson([cycle], data.settings));
        setStatus(`已生成 ${cycle.id} 的 JSON`);
      } else {
        if (!isNativePlatform) {
          throw new Error('PDF 只能在手机上生成（浏览器里没有原生渲染）');
        }
        const res = await PdfExport.export({
          filename: dayFileName(cycle.id, 'pdf'),
          blocks: buildPdfBlocks(cycle, data.cycles, data.settings.categories),
          share: true,
        });
        setStatus(`已生成 PDF（${Math.round(res.size / 1024)} KB），正在打开分享面板…`);
      }
    } catch (e) {
      setError('导出失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  if (data.cycles.length === 0) {
    return (
      <div className="page">
        <div className="hero-card empty">
          <div className="hero-title">还没有可导出的记录</div>
          <p className="hint">先记录几天，这里可以把当天记录导出成 TXT / PDF / JSON 交给电脑上的 AI。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page" aria-busy={busy}>
      <div className="section">
        <div className="section-head">
          <label htmlFor="export-cycle">选择周期</label>
        </div>
        <select id="export-cycle" className="select" value={selected} disabled={busy} onChange={(e) => { setSelected(e.target.value); setStatus(null); setError(null); }}>
          {data.cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}（总睡眠 {formatHuman(summarizeCycle(c, api.now).totalSleepMs)}）
            </option>
          ))}
        </select>
        {totals ? <CycleSummary totals={totals} categories={data.settings.categories} sleep className="export-summary" /> : null}
        {cycle?.closedAtMs === null ? <p className="tiny">本周期还未结束，导出的是当前已记录的内容。</p> : null}
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
        TXT 适合直接丢给 AI 读；PDF 适合存档/打印；JSON 保留完整字段，适合让 AI 精确计算。导出后会弹系统分享面板，可以发到微信文件传输助手，再到电脑上打开。
      </p>
      {busy ? <p className="hint" role="status">正在生成，请勿重复点击…</p> : null}
      {status ? <p className="status" role="status">{status}</p> : null}
      {error || api.error ? <p className="error" role="alert">{error || api.error}</p> : null}
    </div>
  );
}
