import { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { isNativePlatform, WakeTimer } from '../native/wakeTimer';
import type { LiveState } from '../native/contracts';
import type { AppData } from '../data/store';
import { applyLiveState, closeCycle as closeCycleData, defaultData, loadData, saveData, updateCycle } from '../data/store';
import { saveScreenshot } from '../data/files';
import { cycleIdFor } from '../core/time';
import { editSegment, mergeAdjacentSegments, type SegmentPatch } from '../core/segments';
import type { SegmentCategory } from '../native/contracts';
import { changeCategories, requireSelectableCategory, type CategoryAction } from '../core/categories';
import { categoryOf } from '../core/segments';
import { splitSegments, type SplitInput } from '../core/splitSegments';
import { buildRestoredData, type RestoreBackup, type RestoreMode, type CategoryResolutions } from '../data/restore';


/** 同一天第二次开启时不能覆盖已有周期：日期 id 加了后缀 */
function uniqueCycleId(base: string, existing: Array<{ id: string }>): string {
  const ids = new Set(existing.map((c) => c.id));
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

export interface NewSleepInput {
  /** 醒来时刻（通常就是"现在"） */
  wakeAtMs: number;
  /** 昨晚睡了多久，入睡时刻 = 醒来 − 时长 */
  sleepDurationMs: number;
  score?: number | null;
  reportedTotalMs?: number | null;
  note?: string | null;
  screenshot?: File | null;
}

export function useApp() {
  const [data, setData] = useState<AppData>(defaultData);
  const [live, setLive] = useState<LiveState | null>(null);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [recoveredFrom, setRecoveredFrom] = useState<string | null>(null);
  const dataRef = useRef<AppData>(defaultData());

  const writeData = useCallback((update: AppData | ((prev: AppData) => AppData)) => {
    const next = typeof update === 'function' ? update(dataRef.current) : update;
    dataRef.current = next;
    setData(next);
  }, []);
  const editQueue = useRef<Promise<void>>(Promise.resolve());
  const safeToWrite = useRef(false);
  const loadingStarted = useRef(false);
  const queueEdit = useCallback(<T,>(action: () => Promise<T>): Promise<T> => {
    const result = editQueue.current.catch(() => undefined).then(action);
    editQueue.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);
  const requireWritable = useCallback(() => {
    if (!safeToWrite.current) throw new Error('本地数据尚未安全读取，已暂停修改');
  }, []);

  const refreshLive = useCallback(() => queueEdit(async () => {
    if (!isNativePlatform) return null;
    try {
      const state = await WakeTimer.getState();
      setLive(state);
      if (state.status !== 'idle' && safeToWrite.current) {
        const next = applyLiveState(dataRef.current, state, Date.now());
        await saveData(next);
        writeData(next);
      }
      return state;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }), [queueEdit, writeData]);

  useEffect(() => {
    if (loadingStarted.current) return;
    loadingStarted.current = true;
    (async () => {
      try {
        const result = await loadData();
        writeData(result.data);
        if (result.recoveredFrom) setRecoveredFrom(result.recoveredFrom);
        // schema 1 的规范化结果也必须安全落盘；不会先清空主文件。
        await saveData(result.data);
        safeToWrite.current = true;
      } catch (e) {
        safeToWrite.current = false;
        setLoadFailed(true);
        setError('本地记录读取或保存失败，已暂停修改以免覆盖数据：' + String(e));
      }
      await refreshLive();
      setReady(true);
    })();
  }, [refreshLive, writeData]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isNativePlatform) return;
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refreshLive();
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [refreshLive]);

  const startCycle = useCallback(
    async (input: NewSleepInput) => queueEdit(async () => {
      requireWritable();
      if (!isNativePlatform) return;
      const sleepAtMs = input.wakeAtMs - input.sleepDurationMs;
      const cycleId = (input as NewSleepInput & { cycleId?: string }).cycleId ?? cycleIdFor(input.wakeAtMs);
      const state = await WakeTimer.startCycle({ cycleId, sleepAtMs, wakeAtMs: input.wakeAtMs });
      let screenshotPath: string | null = null;
      if (input.screenshot) {
        try {
          screenshotPath = await saveScreenshot(input.screenshot, cycleId);
        } catch (e) {
          setError('截图保存失败：' + String(e));
        }
      }
      setLive(state);
      writeData((prev) => {
        const next = applyLiveState(prev === undefined ? defaultData() : prev, state, Date.now());
        const withMetrics = {
          ...next,
          cycles: next.cycles.map((c) =>
            c.id === state.cycleId
              ? {
                  ...c,
                  screenshotPath: screenshotPath ?? c.screenshotPath,
                  sleepMetrics: {
                    score: input.score ?? null,
                    reportedTotalMs: input.reportedTotalMs ?? null,
                    note: input.note ?? null,
                  },
                }
              : c
          ),
        };
        return withMetrics;
      });
      await saveData(dataRef.current);
    }),
    [queueEdit, requireWritable, writeData]
  );


  /** 右上角"开启第二天"：把当前周期收口后，用新的睡眠时长/起床时间开启新周期 */
  const beginNextCycle = useCallback(
    async (input: NewSleepInput) => {
      if (!isNativePlatform) return;
      await refreshLive(); // 先把通知栏刚产生的段镜像进来
      const base = cycleIdFor(input.wakeAtMs);
      const cycleId = uniqueCycleId(base, dataRef.current.cycles);
      await startCycle({ ...input, cycleId } as NewSleepInput & { cycleId: string });
    },
    [refreshLive, startCycle]
  );
  const runNative = useCallback((operation: () => Promise<LiveState>) => queueEdit(async () => {
    requireWritable();
    const state = await operation();
    setLive(state);
    const next = applyLiveState(dataRef.current, state, Date.now());
    // 原生已持久化，先反映实时状态；镜像保存失败仍明确报错，不宣称全部成功。
    writeData(next);
    await saveData(next);
    return state;
  }), [queueEdit, requireWritable, writeData]);
  const lap = useCallback((note: string) => runNative(() => WakeTimer.lap({ note })), [runNative]);
  const setSegmentNote = useCallback((segmentId: string, note: string) => runNative(() => WakeTimer.setNote({ segmentId, note })), [runNative]);
  const endSession = useCallback(() => runNative(() => WakeTimer.endSession()), [runNative]);
  const restartSession = useCallback(() => runNative(() => WakeTimer.restartSession()), [runNative]);

  const closeCycle = useCallback(() => queueEdit(async () => {
    requireWritable();
    const current = await WakeTimer.getState();
    if (!current.cycleId || current.status === 'idle') return;
    const final = await WakeTimer.endSession();
    const snapshot = applyLiveState(dataRef.current, final, Date.now());
    await saveData(snapshot); // 先落盘结束态，再清原生，不丢最后一段。
    writeData(snapshot);
    await WakeTimer.closeCycle();
    setLive(null);
    const closed = closeCycleData(dataRef.current, current.cycleId, Date.now());
    await saveData(closed); writeData(closed);
  }), [queueEdit, requireWritable, writeData]);

  const updateSleepMetrics = useCallback((cycleId: string, patch: Parameters<typeof updateCycle>[2]) => queueEdit(async () => {
    requireWritable();
    const next = updateCycle(dataRef.current, cycleId, patch, Date.now());
    await saveData(next); writeData(next);
  }), [queueEdit, requireWritable, writeData]);

  const updateSettings = useCallback((patch: Partial<AppData['settings']>) => queueEdit(async () => {
    requireWritable();
    const next = { ...dataRef.current, settings: { ...dataRef.current.settings, ...patch } };
    await saveData(next); writeData(next);
  }), [queueEdit, requireWritable, writeData]);


  /** 清空所有记录（同时清原生 live 状态，避免又被镜像回来） */
  const clearAll = useCallback(() => queueEdit(async () => {
    requireWritable();
    if (isNativePlatform) await WakeTimer.closeCycle();
    setLive(null);
    const next = { ...dataRef.current, cycles: [] };
    await saveData(next); writeData(next);
  }), [queueEdit, requireWritable, writeData]);


  const manageCategory = useCallback((action: CategoryAction) => queueEdit(async () => {
    if (loadFailed || !ready) throw new Error('本地数据尚未安全读取，已暂停修改');
    const current = isNativePlatform ? await WakeTimer.getState() : null;
    let latest = dataRef.current;
    if (current && current.status !== 'idle') {
      setLive(current);
      latest = applyLiveState(latest, current, Date.now());
    }
    const references = new Set(latest.cycles.flatMap((c) => c.session?.segments ?? []).map(categoryOf));
    const categories = changeCategories(latest.settings.categories, action, references);
    const next = { ...latest, settings: { ...latest.settings, categories } };
    await saveData(next);
    writeData(next);
  }), [queueEdit, loadFailed, ready, writeData]);

  const restore = useCallback((backup: RestoreBackup, mode: RestoreMode, resolutions: CategoryResolutions) => queueEdit(async () => {
    if (!ready) throw new Error('数据正在读取，请稍候');
    const current = isNativePlatform ? await WakeTimer.getState() : null;
    let latest = dataRef.current;
    if (current && current.status !== 'idle') {
      setLive(current);
      latest = applyLiveState(latest, current, Date.now());
    }
    const next = buildRestoredData(latest, backup, mode, resolutions,
      current && current.status !== 'idle' ? current.cycleId : undefined);
    await saveData(next);
    writeData(next);
    setLoadFailed(false);
    safeToWrite.current = true;
  }), [queueEdit, ready, writeData]);

  const editCycleSegments = useCallback((cycleId: string, historical: (segments: NonNullable<AppData['cycles'][number]['session']>['segments']) => NonNullable<AppData['cycles'][number]['session']>['segments'], native: () => Promise<LiveState>) => queueEdit(async () => {
    if (loadFailed || !ready) throw new Error('本地数据尚未安全读取，已暂停修改');
    // Native is the live source of truth; never write a stale full segment list over notification actions.
    const current = isNativePlatform ? await WakeTimer.getState() : null;
    if (current && current.status !== 'idle') {
      setLive(current);
      writeData((prev) => applyLiveState(prev, current, Date.now()));
    }
    if (current?.cycleId === cycleId && current.status !== 'idle') {
      const next = await native();
      if (next.cycleId !== cycleId) throw new Error('活动周期已变化，请重新打开这条记录');
      setLive(next);
      writeData((prev) => applyLiveState(prev, next, Date.now()));
    } else {
      const data = dataRef.current;
      const cycle = data.cycles.find((c) => c.id === cycleId);
      if (!cycle?.session) throw new Error('找不到这条周期记录');
      const segments = historical(cycle.session.segments);
      if (segments.some((s) => s.startAtMs < cycle.wakeAtMs || (cycle.closedAtMs !== null && (s.endAtMs === 0 || s.endAtMs > cycle.closedAtMs)))) {
        throw new Error('记录超出周期边界，请先核对周期时间');
      }
      const next = updateCycle(data, cycleId, { session: { ...cycle.session, segments } }, Date.now());
      await saveData(next); // 历史编辑失败时不发布半次修改。
      writeData(next);
      return;
    }
    await saveData(dataRef.current);
  }), [queueEdit, loadFailed, ready, writeData]);

  const checkCategory = useCallback((category: string, original?: string) => {
    requireSelectableCategory(category, original, dataRef.current.settings.categories);
  }, []);
  const updateSegment = useCallback((cycleId: string, segmentId: string, patch: SegmentPatch) =>
    editCycleSegments(cycleId, (segments) => {
      checkCategory(patch.category, categoryOf(segments.find((s) => s.id === segmentId) ?? {}));
      return editSegment(segments, segmentId, patch);
    }, async () => {
      const state = await WakeTimer.getState();
      checkCategory(patch.category, categoryOf(state.segments.find((s) => s.id === segmentId) ?? {}));
      return WakeTimer.setSegmentDetails({ segmentId, ...patch });
    }), [editCycleSegments, checkCategory]);
  const mergeSegments = useCallback((cycleId: string, firstId: string, secondId: string, category: SegmentCategory) =>
    editCycleSegments(cycleId, (segments) => {
      checkCategory(category);
      return mergeAdjacentSegments(segments, firstId, secondId, category);
    }, () => {
      checkCategory(category);
      return WakeTimer.mergeSegments({ firstId, secondId, category });
    }), [editCycleSegments, checkCategory]);
  const splitSegment = useCallback((cycleId: string, segmentId: string, input: SplitInput) => {
    const validateParts = () => input.parts.forEach((part) => checkCategory(part.category, input.expected.category));
    return editCycleSegments(cycleId, (segments) => {
      validateParts();
      return splitSegments(segments, segmentId, input, Date.now());
    }, () => {
      validateParts();
      return WakeTimer.splitSegment({ cycleId, segmentId, ...input });
    });
  }, [editCycleSegments, checkCategory]);

  const changeNap = useCallback((start: boolean) => queueEdit(async () => {
    if (loadFailed || !ready) throw new Error('本地数据尚未安全读取，已暂停修改');
    const state = await (start ? WakeTimer.startNap() : WakeTimer.endNap());
    setLive(state);
    writeData((prev) => applyLiveState(prev, state, Date.now()));
    await saveData(dataRef.current);
  }), [queueEdit, loadFailed, ready, writeData]);
  const startNap = useCallback(() => changeNap(true), [changeNap]);
  const endNap = useCallback(() => changeNap(false), [changeNap]);

  return {
    updateSegment, mergeSegments, splitSegment, manageCategory, startNap, endNap,
    data,
    live,
    now,
    ready,
    error,
    loadFailed,
    recoveredFrom,
    refreshLive,
    startCycle,
    lap,
    setSegmentNote,
    endSession,
    restartSession,
    closeCycle,
    updateSleepMetrics,
    updateSettings,
    beginNextCycle,
    restore,
    clearAll,
  };
}

export type AppApi = ReturnType<typeof useApp>;
