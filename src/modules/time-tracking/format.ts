import { formatDate } from './domain/time';

/** 07:30:05 / -00:12:03 */
export function formatDuration(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const total = Math.floor(Math.abs(ms) / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${sign}${h}:${m}:${s}`;
}

/** 7h30m / 45m */
export function formatHuman(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 60000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatDateTime(ms: number): string {
  return `${formatDate(ms)} ${formatClock(ms)}`;
}

export function parseLocalInput(value: string): number {
  // <input type="datetime-local"> 的值形如 2026-10-26T07:00
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export function toLocalInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
