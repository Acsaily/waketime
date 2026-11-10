// 调试用：造一个"昨晚 23:30 睡、今天 07:00 醒"的周期
export function buildDemoCycle(now: Date): { cycleId: string; sleepAtMs: number; wakeAtMs: number } {
  const wake = new Date(now);
  wake.setHours(7, 0, 0, 0);
  if (wake.getTime() > now.getTime()) {
    wake.setDate(wake.getDate() - 1);
  }
  const sleep = new Date(wake);
  sleep.setDate(sleep.getDate() - 1);
  sleep.setHours(23, 30, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  const cycleId = `${wake.getFullYear()}-${pad(wake.getMonth() + 1)}-${pad(wake.getDate())}`;
  return { cycleId, sleepAtMs: sleep.getTime(), wakeAtMs: wake.getTime() };
}
