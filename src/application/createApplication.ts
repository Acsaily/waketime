import {
  cycleIdFor,
  uniqueCycleId,
  editSegment,
  mergeAdjacentSegments,
  categoryOf,
  splitSegments,
  type SegmentPatch,
  type SplitInput,
  type Segment,
} from '../modules/time-tracking/index';
import {
  changeCategories,
  requireSelectableCategory,
  type CategoryAction,
} from '../modules/classification/index';
import { defaultData, type AppData } from './recordCodec';
import { applyLiveState, closeCycle as closeCycleData, updateCycle } from './records';
import {
  buildRestoredData,
  readRestoreBackup,
  type RestoreBackup,
  type RestoreMode,
  type CategoryResolutions,
} from './restore';
import type {
  ApplicationDeps,
  LiveState,
  SegmentCategory,
  ScreenshotInput,
  RestoreFileInput,
  FeedbackKind,
  FeedbackPrefs,
} from './ports';
import { buildBackupJson, buildDayTxt, dayFileName } from './exportFormat';
import { buildPdfBlocks } from './pdfDoc';

export interface NewSleepInput {
  wakeAtMs: number;
  sleepDurationMs: number;
  score?: number | null;
  reportedTotalMs?: number | null;
  note?: string | null;
  screenshot?: ScreenshotInput | null;
}
export interface AppSnapshot {
  data: AppData;
  live: LiveState | null;
  ready: boolean;
  error: string | null;
  loadFailed: boolean;
  recoveredFrom: string | null;
}
export type ExportKind = 'txt' | 'json' | 'pdf' | 'backup';

/** 唯一业务状态与写入协调器；不依赖渲染或平台。 */
export function createApplication({
  store,
  timer,
  clock,
  files,
  device,
  feedback: feedbackPort,
}: ApplicationDeps) {
  const isNativePlatform = timer.isNativePlatform;
  let snapshot: AppSnapshot = {
    data: defaultData(),
    live: null,
    ready: false,
    error: null,
    loadFailed: false,
    recoveredFrom: null,
  };
  const listeners = new Set<() => void>();
  const getSnapshot = () => snapshot;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const publish = (patch: Partial<AppSnapshot>) => {
    if (
      Object.entries(patch).every(([key, value]) =>
        Object.is(snapshot[key as keyof AppSnapshot], value),
      )
    )
      return;
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const writeData = (data: AppData) => publish({ data });
  let editQueue: Promise<void> = Promise.resolve();
  let safeToWrite = false;
  let initialization: Promise<void> | undefined;
  const queueEdit = <T>(action: () => Promise<T>): Promise<T> => {
    const result = editQueue.then(action);
    editQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const requireWritable = () => {
    if (!safeToWrite) throw new Error('本地数据尚未安全读取，已暂停修改');
  };
  const requireReadyAndWritable = () => {
    if (!snapshot.ready) throw new Error('本地数据尚未安全读取，已暂停修改');
    requireWritable();
  };

  const refreshLive = () =>
    queueEdit(async () => {
      if (!isNativePlatform) return null;
      try {
        const state = await timer.getState();
        publish({ live: state });
        if (state.status !== 'idle' && safeToWrite) {
          const next = applyLiveState(snapshot.data, state, clock.now());
          await store.save(next);
          writeData(next);
        }
        return state;
      } catch (e) {
        publish({ error: String(e) });
        return null;
      }
    });

  // Foreground reads can occur during load, but cannot mirror until the
  // normalized initial data has been saved successfully (v0.9.0 lifecycle).
  const initialize = (): Promise<void> =>
    (initialization ??= (async () => {
      try {
        const result = await store.load();
        writeData(result.data);
        if (result.recoveredFrom) publish({ recoveredFrom: result.recoveredFrom });
        await store.save(result.data);
        safeToWrite = true;
      } catch (e) {
        safeToWrite = false;
        publish({
          loadFailed: true,
          error: '本地记录读取或保存失败，已暂停修改以免覆盖数据：' + String(e),
        });
      }
      await refreshLive();
      publish({ ready: true });
    })());

  const startCycle = (input: NewSleepInput) =>
    queueEdit(async () => {
      requireWritable();
      if (!isNativePlatform) return;
      const sleepAtMs = input.wakeAtMs - input.sleepDurationMs;
      const requestedId =
        (input as NewSleepInput & { cycleId?: string }).cycleId ?? cycleIdFor(input.wakeAtMs);
      const cycleId = uniqueCycleId(requestedId, snapshot.data.cycles);
      const state = await timer.startCycle({ cycleId, sleepAtMs, wakeAtMs: input.wakeAtMs });
      let screenshotPath: string | null = null;
      if (input.screenshot) {
        try {
          screenshotPath = await files.saveScreenshot(input.screenshot, cycleId);
        } catch (e) {
          publish({ error: '截图保存失败：' + String(e) });
        }
      }
      publish({ live: state });
      const next = applyLiveState(snapshot.data, state, clock.now());
      writeData({
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
            : c,
        ),
      });
      await store.save(snapshot.data);
    });

  // Baseline deliberately retains two queued operations. Refresh failure may
  // still permit start; a notification lap interleaved before native start is
  // not atomic with this read. A future change requires a separate contract.
  const beginNextCycle = async (input: NewSleepInput) => {
    if (!isNativePlatform) return;
    await refreshLive();
    const base = cycleIdFor(input.wakeAtMs);
    const cycleId = uniqueCycleId(base, snapshot.data.cycles);
    await startCycle({ ...input, cycleId } as NewSleepInput & { cycleId: string });
  };
  const runNative = (operation: () => Promise<LiveState>) =>
    queueEdit(async () => {
      requireWritable();
      const state = await operation();
      publish({ live: state });
      const next = applyLiveState(snapshot.data, state, clock.now());
      // 原生已持久化，先反映实时状态；镜像保存失败仍明确报错。
      writeData(next);
      await store.save(next);
      return state;
    });
  const lap = (note: string) => runNative(() => timer.lap({ note }));
  const setSegmentNote = (segmentId: string, note: string) =>
    runNative(() => timer.setNote({ segmentId, note }));
  const endSession = () => runNative(() => timer.endSession());
  const restartSession = () => runNative(() => timer.restartSession());

  const closeCycle = () =>
    queueEdit(async () => {
      requireWritable();
      const current = await timer.getState();
      if (!current.cycleId || current.status === 'idle') return;
      const final = await timer.endSession();
      const ended = applyLiveState(snapshot.data, final, clock.now());
      await store.save(ended); // 先落盘结束态，再清原生，不丢最后一段。
      writeData(ended);
      await timer.closeCycle();
      publish({ live: null });
      // If this save fails, native is already idle; the ended history survives,
      // but repeating close cannot add closedAt (baseline limitation).
      const closed = closeCycleData(snapshot.data, current.cycleId, clock.now(), clock.now());
      await store.save(closed);
      writeData(closed);
    });
  const updateSleepMetrics = (cycleId: string, patch: Parameters<typeof updateCycle>[2]) =>
    queueEdit(async () => {
      requireWritable();
      const next = updateCycle(snapshot.data, cycleId, patch, clock.now());
      await store.save(next);
      writeData(next);
    });
  const persistSettings = async (patch: Partial<AppData['settings']>) => {
    requireWritable();
    const data = snapshot.data;
    const next = { ...data, settings: { ...data.settings, ...patch } };
    await store.save(next);
    writeData(next);
  };
  const updateSettings = (patch: Partial<AppData['settings']>) =>
    queueEdit(() => persistSettings(patch));

  const clearAll = () =>
    queueEdit(async () => {
      requireWritable();
      if (isNativePlatform) await timer.closeCycle();
      publish({ live: null });
      const next = { ...snapshot.data, cycles: [] };
      await store.save(next);
      writeData(next);
    });

  // Pull the authoritative native snapshot before reference-sensitive commands.
  // The caller decides when to publish the refreshed data: historical edits
  // display the live mirror immediately; restore/catalog publish after save.
  const latestData = async () => {
    const current = isNativePlatform ? await timer.getState() : null;
    let latest = snapshot.data;
    if (current && current.status !== 'idle') {
      publish({ live: current });
      latest = applyLiveState(latest, current, clock.now());
    }
    return { current, latest };
  };
  const manageCategory = (action: CategoryAction) =>
    queueEdit(async () => {
      requireReadyAndWritable();
      const { latest } = await latestData();
      const references = new Set(
        latest.cycles.flatMap((c) => c.session?.segments ?? []).map(categoryOf),
      );
      const categories = changeCategories(latest.settings.categories, action, references);
      const next = { ...latest, settings: { ...latest.settings, categories } };
      await store.save(next);
      writeData(next);
    });
  const restore = (backup: RestoreBackup, mode: RestoreMode, resolutions: CategoryResolutions) =>
    queueEdit(async () => {
      if (!snapshot.ready) throw new Error('数据正在读取，请稍候');
      const { current, latest } = await latestData();
      const next = buildRestoredData(
        latest,
        backup,
        mode,
        resolutions,
        current && current.status !== 'idle' ? current.cycleId : undefined,
      );
      await store.save(next);
      writeData(next);
      safeToWrite = true;
      publish({ loadFailed: false });
    });
  const editCycleSegments = (
    cycleId: string,
    historical: (segments: Segment[]) => Segment[],
    native: () => Promise<LiveState>,
  ) =>
    queueEdit(async () => {
      requireReadyAndWritable();
      const { current, latest } = await latestData();
      writeData(latest);
      if (current?.cycleId === cycleId && current.status !== 'idle') {
        const state = await native();
        if (state.cycleId !== cycleId) throw new Error('活动周期已变化，请重新打开这条记录');
        publish({ live: state });
        writeData(applyLiveState(snapshot.data, state, clock.now()));
        await store.save(snapshot.data);
      } else {
        const data = snapshot.data;
        const cycle = data.cycles.find((c) => c.id === cycleId);
        if (!cycle?.session) throw new Error('找不到这条周期记录');
        const segments = historical(cycle.session.segments);
        if (
          segments.some(
            (s) =>
              s.startAtMs < cycle.wakeAtMs ||
              (cycle.closedAtMs !== null && (s.endAtMs === 0 || s.endAtMs > cycle.closedAtMs)),
          )
        ) {
          throw new Error('记录超出周期边界，请先核对周期时间');
        }
        const next = updateCycle(
          data,
          cycleId,
          { session: { ...cycle.session, segments } },
          clock.now(),
        );
        await store.save(next); // 历史编辑失败时不发布半次修改。
        writeData(next);
      }
    });
  const checkCategory = (category: string, original?: string) =>
    requireSelectableCategory(category, original, snapshot.data.settings.categories);
  const updateSegment = (cycleId: string, segmentId: string, patch: SegmentPatch) =>
    editCycleSegments(
      cycleId,
      (segments) => {
        checkCategory(patch.category, categoryOf(segments.find((s) => s.id === segmentId) ?? {}));
        return editSegment(segments, segmentId, patch);
      },
      async () => {
        const state = await timer.getState();
        checkCategory(
          patch.category,
          categoryOf(state.segments.find((s) => s.id === segmentId) ?? {}),
        );
        return timer.setSegmentDetails({ segmentId, ...patch });
      },
    );
  const mergeSegments = (
    cycleId: string,
    firstId: string,
    secondId: string,
    category: SegmentCategory,
  ) =>
    editCycleSegments(
      cycleId,
      (segments) => {
        checkCategory(category);
        return mergeAdjacentSegments(segments, firstId, secondId, category);
      },
      () => {
        checkCategory(category);
        return timer.mergeSegments({ firstId, secondId, category });
      },
    );
  const splitSegment = (cycleId: string, segmentId: string, input: SplitInput) => {
    const validateParts = () =>
      input.parts.forEach((part) => checkCategory(part.category, input.expected.category));
    return editCycleSegments(
      cycleId,
      (segments) => {
        validateParts();
        return splitSegments(segments, segmentId, input, clock.now());
      },
      () => {
        validateParts();
        return timer.splitSegment({ cycleId, segmentId, ...input });
      },
    );
  };
  const changeNap = (start: boolean) =>
    queueEdit(async () => {
      requireReadyAndWritable();
      const state = await (start ? timer.startNap() : timer.endNap());
      publish({ live: state });
      writeData(applyLiveState(snapshot.data, state, clock.now()));
      await store.save(snapshot.data);
    });
  const startNap = () => changeNap(true);
  const endNap = () => changeNap(false);

  // Keep the native-first preference behavior, including failure semantics.
  // Even when loadFailed, the native preference may commit before the guarded
  // local setting rejects. This does not authorize overwriting record history.
  const setNotificationsEnabled = (enabled: boolean) =>
    queueEdit(async () => {
      if (isNativePlatform) await device.setNotificationsEnabled({ enabled });
      await persistSettings({ notificationsEnabled: enabled });
    });
  const getDeviceInfo = () => device.getDeviceInfo();
  const requestNotificationPermission = async () => {
    if (!isNativePlatform) throw new Error('通知权限需要在手机上设置');
    await device.requestNotificationPermission();
    await clock.delay(800);
    return device.checkNotificationPermission();
  };
  const openNotificationSettings = async () => {
    if (!isNativePlatform) throw new Error('系统设置只能在手机上打开');
    await device.openNotificationSettings();
  };
  const openAppSettings = async () => {
    if (!isNativePlatform) throw new Error('系统设置只能在手机上打开');
    await device.openAppSettings();
  };
  const exportRecords = async (kind: ExportKind, cycleId?: string): Promise<string> => {
    const { data } = snapshot;
    if (kind === 'backup') {
      const text = buildBackupJson(data.cycles, data.settings, () => clock.now());
      await files.shareTextFile(
        `waketime-backup-${new Date(clock.now()).toISOString().slice(0, 10)}.json`,
        text,
      );
      return '已生成全量备份，选择保存位置或发给文件传输助手';
    }
    const cycle = data.cycles.find((c) => c.id === cycleId);
    if (!cycle) throw new Error('请重新选择要导出的周期');
    if (kind === 'txt') {
      await files.shareTextFile(
        dayFileName(cycle.id, 'txt'),
        buildDayTxt(cycle, data.cycles, data.settings.categories, () => clock.now()),
      );
      return `已生成 ${cycle.id} 的 TXT`;
    }
    if (kind === 'json') {
      await files.shareTextFile(
        dayFileName(cycle.id, 'json'),
        buildBackupJson([cycle], data.settings, () => clock.now()),
      );
      return `已生成 ${cycle.id} 的 JSON`;
    }
    if (!isNativePlatform) throw new Error('PDF 只能在手机上生成（浏览器里没有原生渲染）');
    const res = await files.exportPdf({
      filename: dayFileName(cycle.id, 'pdf'),
      blocks: buildPdfBlocks(cycle, data.cycles, data.settings.categories, () => clock.now()),
      share: true,
    });
    return `已生成 PDF（${Math.round(res.size / 1024)} KB），正在打开分享面板…`;
  };
  const readRestoreFile = async (file: RestoreFileInput) =>
    readRestoreBackup(JSON.parse(await file.text()), () => clock.now());
  const screenshotUrl = (path: string) => files.screenshotUrl(path);
  const feedback = (prefs: FeedbackPrefs, kind: FeedbackKind) => feedbackPort.play(prefs, kind);

  return {
    getSnapshot,
    subscribe,
    initialize,
    isNativePlatform,
    refreshLive,
    startCycle,
    beginNextCycle,
    lap,
    setSegmentNote,
    endSession,
    restartSession,
    closeCycle,
    updateSleepMetrics,
    updateSettings,
    clearAll,
    manageCategory,
    restore,
    updateSegment,
    mergeSegments,
    splitSegment,
    startNap,
    endNap,
    setNotificationsEnabled,
    getDeviceInfo,
    requestNotificationPermission,
    openNotificationSettings,
    openAppSettings,
    exportRecords,
    readRestoreFile,
    screenshotUrl,
    feedback,
  };
}

export type Application = ReturnType<typeof createApplication>;
export type AppActions = Omit<Application, 'getSnapshot' | 'subscribe' | 'initialize'>;
export type AppApi = AppSnapshot & AppActions & { now: number };
