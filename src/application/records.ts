import type { LiveState } from './ports';
import type { AppData } from './recordCodec';
import {
  computeCycle,
  repairWakeGap,
  sanitizeSegments,
  closeForNextSleep,
  type Cycle,
} from '../modules/time-tracking/index';
import { completeCategories } from '../modules/classification/index';

/** 把原生 live 状态镜像进 data.json（原生是 live 的唯一真相来源）
 *
 * 关键：原生返回的是"当天累计的段"（restartSession 也保留旧段），所以这里永远用它
 * **整份替换**，不能再和 prev 里的段拼接——之前拼接导致每次刷新都复制一遍历史，
 * 并且把旧段用更早的时间封口，产生 end<start 的负时长段。
 */
export function applyLiveState(data: AppData, live: LiveState, nowMs: number): AppData {
  if (!live || live.status === 'idle' || !live.cycleId) return data;
  const derived = computeCycle({ sleepAtMs: live.sleepAtMs, wakeAtMs: live.wakeAtMs });
  const prev = data.cycles.find((c) => c.id === live.cycleId);
  const cycle: Cycle = {
    id: live.cycleId,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    sleepAtMs: live.sleepAtMs,
    wakeAtMs: live.wakeAtMs,
    ...derived,
    sleepMetrics: prev?.sleepMetrics ?? { score: null, reportedTotalMs: null, note: null },
    screenshotPath: prev?.screenshotPath ?? null,
    source: prev?.source ?? 'manual',
    session: {
      id: live.sessionId,
      status: live.status === 'ended' ? 'ended' : 'running',
      startedAtMs: live.sessionStartedAtMs,
      segments: repairWakeGap(
        sanitizeSegments(live.segments.map((s) => ({ ...s }))),
        live.wakeAtMs,
        live.cycleId,
      ),
    },
    closedAtMs: null,
    flags: live.clockAnomaly
      ? Array.from(new Set([...(prev?.flags ?? []), 'clock_anomaly']))
      : (prev?.flags ?? []),
    createdAtMs: prev?.createdAtMs ?? nowMs,
    updatedAtMs: nowMs,
  };

  // 新周期比旧周期晚：把旧周期关掉（结束时间 = 新周期的入睡时刻），
  // 同时封口旧会话里没结束的段，否则历史里会留下一个永远“进行中”的段。
  // 最后一次计次到睡觉的开放尾段，默认标成“睡前时间（待分配）”；不改其他未分类段。
  const cycles = data.cycles
    .filter((c) => c.id !== cycle.id)
    .map((c) => closeForNextSleep(c, live.sleepAtMs, nowMs));

  const sorted = [...cycles, cycle].sort((a, b) => b.wakeAtMs - a.wakeAtMs);
  return {
    ...data,
    settings: {
      ...data.settings,
      categories: completeCategories(
        data.settings.categories,
        sorted.flatMap((c) => c.session?.segments ?? []),
      ),
    },
    cycles: sorted,
  };
}

export function updateCycle(
  data: AppData,
  cycleId: string,
  patch: Partial<Cycle>,
  nowMs: number,
): AppData {
  return {
    ...data,
    cycles: data.cycles.map((c) => (c.id === cycleId ? { ...c, ...patch, updatedAtMs: nowMs } : c)),
  };
}

export function closeCycle(
  data: AppData,
  cycleId: string,
  closedAtMs: number,
  nowMs = Date.now(),
): AppData {
  return updateCycle(data, cycleId, { closedAtMs }, nowMs);
}
