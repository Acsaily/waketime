import type { Cycle } from '../data/store';
import { buildTrend, formatSigned, summarizeTrend, trendWindow } from '../core/trends';
import { summarizeCycle } from '../core/segments';
import { formatClock, formatHuman } from '../core/time';

const W = 350;
const SIDE = 8;

/** 柱顶留白；时刻文字独立成行，不再画在散点或彼此上方。 */
export function TrendCharts({ cycles, days = 7, nowMs }: { cycles: Cycle[]; days?: number; nowMs: number }) {
  const slots = trendWindow(cycles, days, nowMs);
  const filled = slots.filter((s): s is NonNullable<typeof s> => s !== null);
  const summary = summarizeTrend(buildTrend(cycles));
  const totalsById = new Map(cycles.map((c) => [c.id, summarizeCycle(c, nowMs)]));
  if (filled.length === 0) return null;

  const durationOf = (id: string) => totalsById.get(id)?.totalSleepMs ?? 0;
  const durationMax = Math.max(9 * 3600_000, ...filled.map((d) => durationOf(d.id)));
  const driftMax = Math.max(2 * 3600_000, ...filled.map((d) => Math.abs(d.driftMs ?? 0)));
  const averageSleep = cycles.length ? cycles.reduce((sum, c) => sum + durationOf(c.id), 0) / cycles.length : 0;
  const colW = (W - SIDE * 2) / days;
  const barW = Math.min(22, colW - 8);
  const barHeight = 78;
  const baseline = 100;
  const driftAxis = 50;
  const xOf = (i: number) => SIDE + i * colW + colW / 2;

  return (
    <div className="section">
      <div className="section-head"><span>最近 {days} 天趋势</span><span className="muted small">已录 {filled.length} 天</span></div>
      <div className="trend-summary">
        <span>平均总睡眠 {formatHuman(averageSleep)}</span>
        {summary.overrunStreak > 0 ? <span className="warn-text">连续超时 {summary.overrunStreak} 天</span> : null}
        {summary.shrinkStreak > 0 ? <span className="ok-text">连续提前 {summary.shrinkStreak} 天</span> : null}
        <span>累计超时 {formatSigned(summary.totalOverrunMs)}</span>
        <span>累计提前 {formatSigned(summary.totalShrinkMs)}</span>
      </div>
      <p className="tiny">按起床日期排列；窄屏可左右滑动图表。总睡眠包含补觉。</p>
      <div className="trend-label">总睡眠时长</div>
      <div className="trend-scroll" tabIndex={0} role="region" aria-label="可横向滚动的总睡眠趋势">
        <svg viewBox={`0 0 ${W} 122`} className="trend-svg" role="img" aria-label="最近各天的总睡眠时长">
          {slots.map((slot, i) => {
            const x = xOf(i) - barW / 2;
            const duration = slot ? durationOf(slot.id) : 0;
            const h = slot ? Math.max(3, (duration / durationMax) * barHeight) : 3;
            return <g key={slot?.id ?? `empty-${i}`}>
              <title>{dateLabel(nowMs, days, i)}：{slot ? `总睡眠 ${formatHuman(duration)}` : '无记录'}</title>
              <rect x={x} y={baseline - h} width={barW} height={h} rx={3} fill={slot ? '#3f7dff' : '#2a3140'} />
              {slot ? <text x={xOf(i)} y={baseline - h - 6} textAnchor="middle" fontSize="10" fill="#9dbcff">{formatHuman(duration)}</text> : null}
              <text x={xOf(i)} y={baseline + 16} textAnchor="middle" fontSize="10" fill="#8b94a5">{dateLabel(nowMs, days, i)}</text>
            </g>;
          })}
        </svg>
      </div>

      <div className="trend-label">主睡眠入睡（橙）与起床（蓝）时刻</div>
      <div className="trend-scroll" tabIndex={0} role="region" aria-label="可横向滚动的入睡起床时刻表">
        <table className="clock-trend-table" style={{ minWidth: W }}>
          <caption className="sr-only">入睡和起床时刻分行显示，日期按起床日</caption>
          <thead><tr>{slots.map((_, i) => <th scope="col" key={i}>{dateLabel(nowMs, days, i)}</th>)}</tr></thead>
          <tbody>
            <tr className="bedtime-row">{slots.map((slot, i) => <td key={i}>{slot ? <><span className="sr-only">入睡 </span>{formatClock(slot.sleepAtMs)}</> : '—'}</td>)}</tr>
            <tr className="waketime-row">{slots.map((slot, i) => <td key={i}>{slot ? <><span className="sr-only">起床 </span>{formatClock(slot.wakeAtMs)}</> : '—'}</td>)}</tr>
          </tbody>
        </table>
      </div>

      <div className="trend-label">相对参考截止：超时（红↑） / 提前（绿↓）</div>
      <div className="trend-scroll" tabIndex={0} role="region" aria-label="可横向滚动的超时提前趋势">
        <svg viewBox={`0 0 ${W} 100`} className="trend-svg" role="img" aria-label="超时或提前入睡时长">
          <line x1={SIDE} y1={driftAxis} x2={W - SIDE} y2={driftAxis} stroke="#2a3140" />
          {slots.map((slot, i) => {
            if (!slot || slot.driftMs === null) return <text key={`empty-${i}`} x={xOf(i)} y={driftAxis + 4} textAnchor="middle" fontSize="10" fill="#8b94a5">—</text>;
            const h = Math.max(2, Math.abs(slot.driftMs) / driftMax * 28);
            const over = slot.driftMs > 0;
            const y = over ? driftAxis - h : driftAxis;
            return <g key={slot.id}>
              <title>{dateLabel(nowMs, days, i)}：{formatSigned(slot.driftMs)}</title>
              <rect x={xOf(i) - barW / 2} y={y} width={barW} height={h} rx={2} fill={over ? '#ff6b57' : '#3ddc97'} />
              <text x={xOf(i)} y={over ? y - 6 : y + h + 14} textAnchor="middle" fontSize="9.5" fill={over ? '#ff8b7a' : '#7fe3ba'}>{formatSigned(slot.driftMs)}</text>
            </g>;
          })}
        </svg>
      </div>
      <p className="tiny">超时 / 提前 = 下一次主睡眠的入睡时刻相对本次固定参考截止的差值。「—」表示没有记录或尚无下一周期可比较。平均与累计统计涵盖全部已录周期。</p>
    </div>
  );
}

function dateLabel(nowMs: number, days: number, index: number): string {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1 - index));
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
