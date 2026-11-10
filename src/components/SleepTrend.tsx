import type { Cycle } from '../data/store';
import { formatHuman } from '../core/time';

/** 最近 N 天的睡眠时长柱状图 + 入睡/起床散点（缺失日留空，不补零） */
export function SleepTrend({ cycles, days = 7 }: { cycles: Cycle[]; days?: number }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const slots: Array<{ label: string; cycle?: Cycle }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    slots.push({ label: String(d.getDate()), cycle: cycles.find((c) => c.id === id) });
  }

  const known = slots.filter((s) => s.cycle).map((s) => s.cycle!);
  if (known.length === 0) return null;

  const maxDur = Math.max(...known.map((c) => c.sleepDurationMs), 8 * 3600_000);
  const minDur = Math.min(...known.map((c) => c.sleepDurationMs), 4 * 3600_000);
  const span = Math.max(1, maxDur - minDur);

  const width = 320;
  const height = 90;
  const barW = 22;
  const gap = (width - barW * days) / (days - 1);

  return (
    <div className="section">
      <div className="section-head">
        <span>最近 {days} 天睡眠</span>
        <span className="muted small">已录 {known.length} 天</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height + 18}`} className="trend-svg" role="img" aria-label="睡眠时长趋势">
        {slots.map((slot, i) => {
          const x = i * (barW + gap);
          if (!slot.cycle) {
            return (
              <g key={slot.label + i}>
                <rect x={x} y={height - 4} width={barW} height={4} rx={2} fill="#2a3140" />
                <text x={x + barW / 2} y={height + 13} textAnchor="middle" fontSize="9" fill="#6c7688">
                  {slot.label}
                </text>
              </g>
            );
          }
          const h = 12 + ((slot.cycle.sleepDurationMs - minDur) / span) * (height - 24);
          return (
            <g key={slot.cycle.id}>
              <rect x={x} y={height - h} width={barW} height={h} rx={4} fill="url(#barGrad)" />
              <text x={x + barW / 2} y={height - h - 4} textAnchor="middle" fontSize="8" fill="#8fb4ff">
                {formatHuman(slot.cycle.sleepDurationMs)}
              </text>
              <text x={x + barW / 2} y={height + 13} textAnchor="middle" fontSize="9" fill="#6c7688">
                {slot.label}
              </text>
            </g>
          );
        })}
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4c8dff" />
            <stop offset="100%" stopColor="#2a4f9e" />
          </linearGradient>
        </defs>
      </svg>
      <p className="tiny">柱子越高睡得越久；空白表示那天没有记录。完整时间轴在下面点开看。</p>
    </div>
  );
}
