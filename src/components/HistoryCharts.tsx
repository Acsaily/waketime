import { useId } from 'react';
import type { DayMetric, WeekMetric } from '../core/history';
import { addLocalDaysMs, formatClockMinutes, formatDateShort, formatSignedShort, formatSleepShort } from '../core/history';
import { formatHuman } from '../core/time';

const W = 320;
const COL = W / 7;

function slotDate(week: WeekMetric, index: number): number {
  return addLocalDaysMs(week.startMs, index);
}

function dayTitle(day: DayMetric | null): string {
  if (!day) return '无记录';
  return `总睡眠 ${formatHuman(day.totalSleepMs)}，入睡 ${formatClockMinutes(day.bedMinutes)}，起床 ${formatClockMinutes(day.wakeMinutes)}`;
}

export function DurationChart({ week, avgSleepMs }: { week: WeekMetric; avgSleepMs: number }) {
  const gradientId = `hist-bars-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const H = 126, base = 98, plotH = 64;
  const minutes = week.days.map((d) => (d ? d.totalSleepMs / 60_000 : 0));
  const maxMinutes = Math.max(9 * 60, Math.ceil(Math.max(...minutes) / 60) * 60);
  const avgY = base - (avgSleepMs / 60_000 / maxMinutes) * plotH;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="history-svg" role="img" aria-label="本周每天总睡眠时长">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7bd0ff" />
          <stop offset="1" stopColor="#3f7dff" />
        </linearGradient>
      </defs>
      <line x1="6" y1={avgY} x2={W - 6} y2={avgY} stroke="#7bd0ff" strokeWidth="1" strokeDasharray="3 4" opacity=".6" />
      {week.days.map((day, i) => {
        const x = i * COL + COL / 2;
        const date = slotDate(week, i);
        return (
          <g key={day?.dateKey ?? `empty-${i}`}>
            <title>{`${formatDateShort(date)}：${dayTitle(day)}`}</title>
            {day ? (
              <>
                <rect x={x - 10} y={base - Math.max(3, (day.totalSleepMs / 60_000 / maxMinutes) * plotH)}
                  width="20" height={Math.max(3, (day.totalSleepMs / 60_000 / maxMinutes) * plotH)}
                  rx="4" fill={`url(#${gradientId})`} />
                <text x={x} y={base - Math.max(3, (day.totalSleepMs / 60_000 / maxMinutes) * plotH) - 5}
                  fontSize="8.6" fill="#b8d4ff" textAnchor="middle">{formatSleepShort(day.totalSleepMs)}</text>
              </>
            ) : (
              <>
                <rect x={x - 9} y={base - 4} width="18" height="4" rx="2" fill="#2a3140" />
                <text x={x} y={base + 15} fontSize="9" fill="#8b94a5" textAnchor="middle">—</text>
              </>
            )}
            <text x={x} y={base + 27} fontSize="9" fill="#8b94a5" textAnchor="middle">{formatDateShort(date)}</text>
          </g>
        );
      })}
    </svg>
  );
}

const AXIS_START = 20 * 60;
const AXIS_END = 38 * 60;

export function IntervalChart({ week }: { week: WeekMetric }) {
  const gradientId = `hist-sleep-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const labelW = 46;
  const plotW = W - labelW - 3;
  const rowH = 23;
  const top = 18;
  const H = top + 7 * rowH + 21;
  const recorded = week.days.filter((d): d is DayMetric => d !== null);
  const axisStart = Math.min(AXIS_START, ...recorded.map((d) => Math.floor(d.bedMinutes / 60) * 60));
  const axisEnd = Math.max(AXIS_END, ...recorded.map((d) => Math.ceil(d.wakeMinutes / 60) * 60));
  const xOf = (axis: number) => labelW + ((axis - axisStart) / (axisEnd - axisStart)) * plotW;
  const clampX = (x: number) => Math.max(labelW, Math.min(W - 3, x));
  const ticks: number[] = [];
  for (let tick = Math.ceil(axisStart / 360) * 360; tick <= axisEnd; tick += 360) ticks.push(tick);
  if (!ticks.length || ticks[0] - axisStart >= 180) ticks.unshift(axisStart);
  if (axisEnd - ticks[ticks.length - 1] >= 180) ticks.push(axisEnd);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="history-svg" role="img" aria-label="本周每天入睡到起床的区间">
      <defs>
        <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={labelW} y1="0" x2={W} y2="0">
          <stop offset="0" stopColor="#3f7dff" />
          <stop offset="1" stopColor="#7bd0ff" />
        </linearGradient>
      </defs>
      {ticks.map((tick) => {
        const tx = xOf(tick);
        return (
          <g key={tick}>
            <line x1={tx} y1={top - 2} x2={tx} y2={H - 20} stroke="#232a35" strokeWidth="1" />
            <text x={tx} y={H - 7} fontSize="8.3" fill="#6f7888" textAnchor="middle">
              {formatClockMinutes(tick)}
            </text>
          </g>
        );
      })}
      {week.days.map((day, i) => {
        const y = top + i * rowH + rowH / 2;
        const date = slotDate(week, i);
        return (
          <g key={day?.dateKey ?? `empty-${i}`}>
            <title>{`${formatDateShort(date)}：${dayTitle(day)}`}</title>
            <text x="0" y={y + 3} fontSize="9.2" fill="#8b94a5">
              {`周${['日', '一', '二', '三', '四', '五', '六'][new Date(date).getDay()]} ${new Date(date).getDate()}`}
            </text>
            {day ? (
              (() => {
                const x1 = clampX(xOf(day.bedMinutes));
                const x2 = clampX(xOf(day.wakeMinutes));
                const left = Math.min(x1, x2);
                const width = Math.abs(x2 - x1);
                return (
                  <>
                    <line x1={left} y1={y} x2={left + Math.max(2, width)} y2={y}
                      stroke={`url(#${gradientId})`} strokeWidth="8" strokeLinecap="round" />
                    {width > 74 ? (
                      <text x={left + width / 2} y={y + 3} fontSize="8.5" fill="#06121f" textAnchor="middle" fontWeight="600">
                        {formatHuman(day.totalSleepMs)}
                      </text>
                    ) : null}
                  </>
                );
              })()
            ) : (
              <text x={labelW + plotW / 2} y={y + 3} fontSize="8.5" fill="#596273" textAnchor="middle">—</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function DriftChart({ week }: { week: WeekMetric }) {
  const H = 132, zeroY = 65, plotH = 33;
  const values = week.days.map((d) => (d?.driftMs === null || d?.driftMs === undefined ? null : d.driftMs / 60_000));
  const filled = values.filter((v): v is number => v !== null);
  const range = Math.max(60, Math.ceil(Math.max(...filled.map(Math.abs), 60) / 30) * 30);
  const y = (value: number) => zeroY - (value / range) * plotH;
  const min = filled.length ? Math.min(...filled) : 0;
  const max = filled.length ? Math.max(...filled) : 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="history-svg" role="img" aria-label="本周每晚相对参考截止的偏移">
      {filled.length > 1 && max > min ? (
        <rect x="4" y={y(max)} width={W - 8} height={Math.max(2, y(min) - y(max))} rx="4"
          fill="rgba(123,208,255,.07)" stroke="rgba(123,208,255,.16)" strokeDasharray="2 4" />
      ) : null}
      <line x1="4" y1={zeroY} x2={W - 4} y2={zeroY} stroke="#39414f" strokeWidth="1" />
      <text x={W - 4} y="9" fontSize="8.2" fill="#8b94a5" textAnchor="end">虚线 = 参考截止</text>
      {filled.length === 0 ? (
        <text x={W / 2} y={zeroY - 12} fontSize="9.5" fill="#6f7888" textAnchor="middle">还没有可比较的相邻两晚</text>
      ) : null}
      {week.days.map((day, i) => {
        const cx = i * COL + COL / 2;
        const date = slotDate(week, i);
        const value = values[i];
        return (
          <g key={day?.dateKey ?? `empty-${i}`}>
            <title>{`${formatDateShort(date)}：${day && day.driftMs !== null ? formatSignedShort(day.driftMs) : '无法比较'}`}</title>
            {value === null ? (
              <text x={cx} y={zeroY + 4} fontSize="9" fill="#5c6575" textAnchor="middle">—</text>
            ) : (
              (() => {
                const dy = y(value);
                const late = value > 0;
                return (
                  <>
                    <line x1={cx} y1={zeroY} x2={cx} y2={dy} stroke={late ? 'rgba(255,128,102,.55)' : 'rgba(61,220,151,.5)'} strokeWidth="2" strokeLinecap="round" />
                    <circle cx={cx} cy={dy} r="4" fill={late ? '#ff8066' : '#3ddc97'} stroke="#171b22" strokeWidth="2" />
                    <text x={cx} y={late ? dy - 7 : dy + 12} fontSize="8.2" fill={late ? '#ffab97' : '#7fe3ba'} textAnchor="middle">
                      {formatSignedShort(value * 60_000)}
                    </text>
                  </>
                );
              })()
            )}
            <text x={cx} y={H - 5} fontSize="8.8" fill="#8b94a5" textAnchor="middle">{formatDateShort(date)}</text>
          </g>
        );
      })}
    </svg>
  );
}
