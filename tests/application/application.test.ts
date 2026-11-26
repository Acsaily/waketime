import { describe, expect, it } from 'vitest';
import {
  createApplication,
  defaultData,
  buildDayTxt,
  buildBackupJson,
  buildPdfBlocks,
  type FilePort,
  type AppData,
  type ApplicationDeps,
  type LiveState,
  type TimerPort,
  type RecordStorePort,
} from '../../src/application/index';
import {
  cycleIdFor,
  snapshotOf,
  splitSegments,
  type Segment,
} from '../../src/modules/time-tracking/index';
import { createBrowserRecordStore } from '../../src/infrastructure/recordStore';
import { H, T, cycle, segment } from '../fixtures';

const now = T + 4 * H;
const base = cycleIdFor(T);
const clone = structuredClone;
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function live(): LiveState {
  return {
    cycleId: base,
    status: 'running',
    sleepAtMs: T - 8 * H,
    wakeAtMs: T,
    targetAtMs: T + 16 * H,
    sessionId: 's',
    sessionStartedAtMs: T,
    notificationsEnabled: true,
    clockAnomaly: false,
    segments: [segment('j', T, 0, 'unclassified', '')],
  };
}
function fixture({
  native = true,
  initial = defaultData(),
  active = live(),
  recordStore,
}: {
  native?: boolean;
  initial?: AppData;
  active?: LiveState;
  recordStore?: RecordStorePort;
} = {}) {
  let persisted = clone(initial);
  let state = clone(active);
  let time = now;
  let id = 0;
  const calls: string[] = [];
  const saves: AppData[] = [];
  const mergeInputs: Parameters<TimerPort['mergeSegments']>[0][] = [];
  const splitInputs: Parameters<TimerPort['splitSegment']>[0][] = [];
  const sharedFiles: { name: string; text: string }[] = [];
  const pdfRequests: Parameters<FilePort['exportPdf']>[0][] = [];
  const saveFaults: (() => Promise<void>)[] = [];
  let loadGate: Promise<void> | undefined;
  let loadFault: Error | undefined;
  let readFault: Error | undefined;
  let beforeStart: (() => void) | undefined;
  let afterEdit: (() => void) | undefined;
  let screenshotFault: Error | undefined;
  const store: RecordStorePort = {
    async load() {
      calls.push('load');
      await loadGate;
      if (loadFault) throw loadFault;
      return { data: clone(persisted), recoveredFrom: 'data.prev.json' };
    },
    async save(data) {
      calls.push('save');
      const copy = clone(data);
      saves.push(copy);
      await saveFaults.shift()?.();
      persisted = copy;
    },
  };
  const open = (category = 'unclassified'): Segment => ({
    ...segment(`new-${++id}`, time, 0, category, ''),
    seq: state.segments.length + 1,
  });
  function switchSegment(category: string, note = '', source: Segment['source'] = 'app') {
    const tail = state.segments.at(-1)!;
    tail.endAtMs = time;
    tail.note = note;
    tail.source = source;
    state.segments.push(open(category));
    return clone(state);
  }
  const timer: TimerPort = {
    isNativePlatform: native,
    async getState() {
      calls.push('getState');
      if (readFault) {
        const e = readFault;
        readFault = undefined;
        throw e;
      }
      return clone(state);
    },
    async startCycle(input) {
      calls.push('startCycle');
      beforeStart?.();
      state = {
        ...live(),
        ...input,
        targetAtMs: input.sleepAtMs + 24 * H,
        sessionId: `s-${++id}`,
        sessionStartedAtMs: time,
        segments: [segment(`new-${++id}`, input.wakeAtMs, 0, 'unclassified', '')],
      };
      return clone(state);
    },
    async lap({ note }) {
      calls.push('lap');
      return switchSegment('unclassified', note);
    },
    async setNote({ segmentId, note }) {
      state.segments.find((s) => s.id === segmentId)!.note = note;
      return clone(state);
    },
    async setSegmentDetails({ segmentId, ...patch }) {
      Object.assign(
        state.segments.find((s) => s.id === segmentId)!,
        patch,
      );
      afterEdit?.();
      return clone(state);
    },
    async mergeSegments(input) {
      calls.push('mergeSegments');
      mergeInputs.push(clone(input));
      const { firstId, secondId, category } = input;
      const first = state.segments.find((s) => s.id === firstId)!;
      const second = state.segments.find((s) => s.id === secondId)!;
      first.endAtMs = second.endAtMs;
      first.category = category;
      first.note = [first.note, second.note].filter(Boolean).join('\n');
      state.segments = state.segments
        .filter((s) => s !== second)
        .map((s, i) => ({ ...s, seq: i + 1 }));
      return clone(state);
    },
    async splitSegment(request) {
      calls.push('splitSegment');
      splitInputs.push(clone(request));
      const { cycleId, segmentId, ...input } = request;
      if (cycleId !== state.cycleId) throw new Error('周期变化');
      state.segments = splitSegments(state.segments, segmentId, input, time, () => `split-${++id}`);
      return clone(state);
    },
    async startNap() {
      calls.push('startNap');
      return switchSegment('sleep');
    },
    async endNap() {
      calls.push('endNap');
      return switchSegment('unclassified');
    },
    async endSession() {
      calls.push('endSession');
      const tail = state.segments.at(-1);
      if (tail && !tail.endAtMs) tail.endAtMs = time;
      state.status = 'ended';
      return clone(state);
    },
    async restartSession() {
      calls.push('restartSession');
      state.sessionId = `restart-${++id}`;
      state.status = 'running';
      state.segments.push(open());
      return clone(state);
    },
    async closeCycle() {
      calls.push('closeCycle');
      state = { ...state, status: 'idle', cycleId: '', segments: [] };
      return clone(state);
    },
  };
  const deps: ApplicationDeps = {
    store: recordStore ?? store,
    timer,
    clock: {
      now: () => time,
      async delay(ms) {
        calls.push(`delay:${ms}`);
      },
    },
    files: {
      async saveScreenshot() {
        if (screenshotFault) throw screenshotFault;
        return 'shot.jpg';
      },
      async screenshotUrl(path) {
        return `url:${path}`;
      },
      async shareTextFile(name, text) {
        calls.push(`share:${name}:${text}`);
        sharedFiles.push({ name, text });
      },
      async exportPdf(input) {
        calls.push(`pdf:${input.filename}`);
        pdfRequests.push(clone(input));
        return { path: input.filename, size: 2048 };
      },
    },
    device: {
      async setNotificationsEnabled({ enabled }) {
        calls.push('notifications');
        state.notificationsEnabled = enabled;
        return clone(state);
      },
      async requestNotificationPermission() {
        calls.push('permission');
      },
      async checkNotificationPermission() {
        return { granted: true };
      },
      async openNotificationSettings() {},
      async openAppSettings() {},
      async getDeviceInfo() {
        return {
          sdkInt: 36,
          androidRelease: '16',
          manufacturer: 'test',
          model: 'test',
          webViewVersion: '1',
          notificationsGranted: true,
        };
      },
    },
    feedback: {
      play(prefs, kind) {
        calls.push(`feedback:${kind}:${prefs.hapticsEnabled}`);
      },
    },
  };
  const app = createApplication(deps);
  return {
    app,
    calls,
    saves,
    saveFaults,
    mergeInputs,
    splitInputs,
    sharedFiles,
    pdfRequests,
    persisted: () => clone(persisted),
    nativeState: () => clone(state),
    replaceNative: (next: LiveState) => {
      state = clone(next);
    },
    holdLoad: (gate: Promise<void>) => {
      loadGate = gate;
    },
    failLoad: () => {
      loadFault = new Error('read failed');
    },
    failRead: () => {
      readFault = new Error('native read failed');
    },
    setTime: (next: number) => {
      time = next;
    },
    failScreenshot: () => {
      screenshotFault = new Error('shot failed');
    },
    notificationLap: () => switchSegment('unclassified', 'notification note', 'notification'),
    onBeforeStart: (fn: () => void) => {
      beforeStart = fn;
    },
    onAfterEdit: (fn: () => void) => {
      afterEdit = fn;
    },
  };
}
const fail = () => Promise.reject(new Error('disk failed'));
function historyData() {
  const d = defaultData();
  const a = cycle([segment('a', T, T + H), segment('b', T + H, T + 2 * H)], 'history');
  // Move the historical cycle to the prior day, so applying the active cycle does not overlap it.
  const shift = 24 * H;
  a.sleepAtMs -= shift;
  a.wakeAtMs -= shift;
  a.targetAtMs -= shift;
  a.closedAtMs! -= shift;
  a.session!.startedAtMs -= shift;
  a.session!.segments = a.session!.segments.map((s) => ({
    ...s,
    startAtMs: s.startAtMs - shift,
    endAtMs: s.endAtMs - shift,
  }));
  d.cycles = [a];
  return d;
}
function records(app: ReturnType<typeof createApplication>, id = base) {
  return app.getSnapshot().data.cycles.find((c) => c.id === id)!;
}

describe('application coordination without React', () => {
  it('initializes only once, publishes migration then native mirror and supplies stable snapshots', async () => {
    const f = fixture();
    const prev = f.app.getSnapshot();
    const snapshots: (typeof prev)[] = [];
    expect(f.app.getSnapshot()).toBe(prev);
    const off = f.app.subscribe(() => snapshots.push(f.app.getSnapshot()));
    await Promise.all([f.app.initialize(), f.app.initialize()]);
    expect(f.calls).toEqual(['load', 'save', 'getState', 'save']);
    expect(f.app.getSnapshot()).toMatchObject({
      ready: true,
      loadFailed: false,
      recoveredFrom: 'data.prev.json',
    });
    expect(records(f.app).session!.segments.map((s) => s.id)).toEqual(['j']);
    expect(snapshots.at(-1)).toBe(f.app.getSnapshot());
    off();
    const count = snapshots.length;
    await f.app.updateSettings({ quickNotes: ['changed'] });
    expect(snapshots).toHaveLength(count);
  });

  it('foreground during deferred load can read native but cannot mirror or edit before normalized save', async () => {
    const f = fixture();
    const gate = deferred();
    f.holdLoad(gate.promise);
    const init = f.app.initialize();
    await f.app.refreshLive();
    expect(f.saves).toHaveLength(0);
    expect(f.app.getSnapshot()).toMatchObject({ ready: false, live: { cycleId: base } });
    await expect(f.app.updateSettings({ quickNotes: ['no'] })).rejects.toThrow('暂停修改');
    await expect(f.app.restore({ cycles: [], categories: [] }, 'merge', {})).rejects.toThrow(
      '正在读取',
    );
    f.notificationLap();
    gate.resolve();
    await init;
    expect(f.saves).toHaveLength(2);
    expect(f.saves[0].cycles).toEqual([]);
    expect(f.persisted().cycles[0].session!.segments[0].note).toBe('notification note');
  });

  it.each(['load', 'initial save'])(
    'blocks ordinary writes after failed %s, but allows explicit restore',
    async (kind) => {
      const f = fixture();
      if (kind === 'load') f.failLoad();
      else f.saveFaults.push(fail);
      await f.app.initialize();
      expect(f.app.getSnapshot()).toMatchObject({
        ready: true,
        loadFailed: true,
        live: { cycleId: base },
        error: expect.stringContaining('暂停修改'),
      });
      const n = f.saves.length;
      await expect(f.app.lap('no')).rejects.toThrow('暂停修改');
      await expect(f.app.manageCategory({ kind: 'add', id: 'new', name: 'new' })).rejects.toThrow(
        '暂停修改',
      );
      expect(f.saves).toHaveLength(n);
      await f.app.restore({ cycles: [], categories: [] }, 'merge', {});
      expect(f.app.getSnapshot().loadFailed).toBe(false);
      await f.app.updateSettings({ quickNotes: ['recovered'] });
      expect(f.persisted().settings.quickNotes).toEqual(['recovered']);
    },
  );

  it('explicit restore cannot override a future main through the real store guard', async () => {
    const future = JSON.stringify({ ...historyData(), schemaVersion: 4 });
    let raw = future;
    let writes = 0;
    const store = createBrowserRecordStore({
      getItem: () => raw,
      setItem: (_, value) => {
        raw = value;
        writes++;
      },
    });
    const f = fixture({ recordStore: store });
    await f.app.initialize();
    expect(f.app.getSnapshot().loadFailed).toBe(true);
    await expect(f.app.restore({ cycles: [], categories: [] }, 'merge', {})).rejects.toThrow(
      '更新版本',
    );
    expect(f.app.getSnapshot().loadFailed).toBe(true);
    await expect(f.app.lap('blocked')).rejects.toThrow('暂停修改');
    expect(raw).toBe(future);
    expect(writes).toBe(0);
  });

  it('keeps native lap committed on mirror failure and refresh replaces the mirror', async () => {
    const f = fixture();
    await f.app.initialize();
    f.saveFaults.push(fail);
    await expect(f.app.lap('done')).rejects.toThrow('disk failed');
    expect(f.persisted().cycles[0].session!.segments).toHaveLength(1);
    expect(records(f.app).session!.segments.map((s) => s.note)).toEqual(['done', '']);
    expect(f.app.getSnapshot().live!.segments).toHaveLength(2);
    f.setTime(now + H);
    f.notificationLap();
    await f.app.refreshLive();
    expect(f.persisted().cycles[0].session!.segments.map((s) => s.note)).toEqual([
      'done',
      'notification note',
      '',
    ]);
    expect(f.persisted().cycles[0].session!.segments[1].source).toBe('notification');
  });

  it('refresh failure reports null while retaining latest native state but not unsaved mirror', async () => {
    const f = fixture();
    await f.app.initialize();
    f.notificationLap();
    f.saveFaults.push(fail);
    expect(await f.app.refreshLive()).toBeNull();
    expect(f.app.getSnapshot().live!.segments).toHaveLength(2);
    expect(records(f.app).session!.segments).toHaveLength(1);
    expect(f.app.getSnapshot().error).toContain('disk failed');
  });

  it.each([true, false])(
    'serializes historical edits and settings even when first save succeeds=%s',
    async (success) => {
      const f = fixture({ initial: historyData() });
      await f.app.initialize();
      f.notificationLap();
      const gate = deferred();
      const entered = deferred();
      f.saveFaults.push(() => {
        entered.resolve();
        return gate.promise;
      });
      const first = f.app.updateSegment('history', 'a', { category: 'daily', note: 'edited' });
      const settled = first.catch((e) => e);
      await entered.promise;
      const calls = f.calls.length;
      const second = f.app.updateSettings({ quickNotes: ['second'] });
      const refresh = f.app.refreshLive();
      await Promise.resolve();
      await Promise.resolve();
      expect(f.calls).toHaveLength(calls);
      expect(records(f.app, 'history').session!.segments[0].note).toBe('原备注');
      expect(records(f.app).session!.segments).toHaveLength(2);
      if (success) gate.resolve();
      else gate.reject(new Error('disk failed'));
      if (!success) expect(await settled).toEqual(new Error('disk failed'));
      else await first;
      await second;
      await refresh;
      expect(f.persisted().cycles.find((c) => c.id === 'history')!.session!.segments[0].note).toBe(
        success ? 'edited' : '原备注',
      );
      expect(f.persisted().settings.quickNotes).toEqual(['second']);
    },
  );

  it('historical split and merge use domain rules and reject missing cycles/unknown categories', async () => {
    const f = fixture({ initial: historyData() });
    await f.app.initialize();
    const old = records(f.app, 'history').session!.segments[0];
    await f.app.splitSegment('history', 'a', {
      expected: snapshotOf(old),
      cuts: [old.startAtMs + H / 2],
      parts: [
        { category: 'work', note: 'one' },
        { category: 'daily', note: 'two' },
      ],
    });
    const segs = records(f.app, 'history').session!.segments;
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ id: 'a', endAtMs: old.startAtMs + H / 2 });
    await f.app.mergeSegments('history', 'a', segs[1].id, 'work');
    expect(records(f.app, 'history').session!.segments[0]).toMatchObject({
      endAtMs: old.endAtMs,
      note: 'one\ntwo',
    });
    await expect(
      f.app.updateSegment('missing', 'a', { category: 'work', note: '' }),
    ).rejects.toThrow('找不到');
    await expect(
      f.app.updateSegment('history', 'a', { category: 'unknown', note: '' }),
    ).rejects.toThrow();
  });

  it('active merge passes exact IDs/category and replaces the entire durable mirror', async () => {
    const initialSegments = [
      { ...segment('a', T, T + H, 'work', 'first'), seq: 1 },
      { ...segment('b', T + H, T + 2 * H, 'daily', 'second'), seq: 2 },
      { ...segment('c', T + 2 * H, 0, 'unclassified', ''), seq: 3 },
    ];
    const f = fixture({ initial: historyData(), active: { ...live(), segments: initialSegments } });
    await f.app.initialize();
    const before = f.persisted();
    const start = f.calls.length;
    await f.app.mergeSegments(base, 'a', 'b', 'work');
    expect(f.calls.slice(start)).toEqual(['getState', 'mergeSegments', 'save']);
    expect(f.mergeInputs).toEqual([{ firstId: 'a', secondId: 'b', category: 'work' }]);
    const expected = [
      { ...initialSegments[0], endAtMs: T + 2 * H, note: 'first\nsecond' },
      { ...initialSegments[2], seq: 2 },
    ];
    expect(f.nativeState().segments).toEqual(expected);
    expect(f.app.getSnapshot().live).toEqual(f.nativeState());
    expect(records(f.app).session!.segments).toEqual(expected);
    expect(f.persisted()).toEqual({
      ...before,
      cycles: before.cycles.map((c) =>
        c.id === base ? { ...c, session: { ...c.session!, segments: expected } } : c,
      ),
    });
    expect(f.saves.at(-1)).toEqual(f.persisted());
  });

  it('active split forwards the snapshot, cuts and parts and mirrors all returned native segments', async () => {
    const initialSegments = [
      { ...segment('a', T, T + 2 * H, 'work', 'original'), seq: 1 },
      { ...segment('b', T + 2 * H, 0, 'unclassified', ''), seq: 2 },
    ];
    const f = fixture({ initial: historyData(), active: { ...live(), segments: initialSegments } });
    await f.app.initialize();
    const before = f.persisted();
    const input = {
      expected: snapshotOf(initialSegments[0]),
      cuts: [T + H],
      parts: [
        { category: 'work', note: 'part 1' },
        { category: 'daily', note: 'part 2' },
      ],
    };
    const start = f.calls.length;
    await f.app.splitSegment(base, 'a', input);
    expect(f.calls.slice(start)).toEqual(['getState', 'splitSegment', 'save']);
    expect(f.splitInputs).toEqual([{ cycleId: base, segmentId: 'a', ...input }]);
    const expected = [
      { ...initialSegments[0], ...input.parts[0], endAtMs: T + H, splitFromId: 'a' },
      {
        ...initialSegments[0],
        ...input.parts[1],
        id: 'split-1',
        seq: 2,
        startAtMs: T + H,
        splitFromId: 'a',
      },
      { ...initialSegments[1], seq: 3 },
    ];
    expect(f.nativeState().segments).toEqual(expected);
    expect(f.app.getSnapshot().live).toEqual(f.nativeState());
    expect(records(f.app).session!.segments).toEqual(expected);
    expect(f.persisted()).toEqual({
      ...before,
      cycles: before.cycles.map((c) =>
        c.id === base ? { ...c, session: { ...c.session!, segments: expected } } : c,
      ),
    });
    expect(f.saves.at(-1)).toEqual(f.persisted());
  });

  it.each(['wake', 'closed'] as const)(
    'rejects historical edits outside the %s boundary without saving',
    async (boundary) => {
      const initial = historyData();
      const historical = initial.cycles[0];
      // Legacy stored records can have malformed boundaries; a metadata edit must
      // not silently persist them as a newly accepted record.
      const target = historical.session!.segments[0];
      if (boundary === 'wake') target.startAtMs = historical.wakeAtMs - H;
      else historical.session!.segments[1].endAtMs = historical.closedAtMs! + H;
      const f = fixture({ initial });
      await f.app.initialize();
      const before = f.persisted();
      const n = f.saves.length;
      await expect(
        f.app.updateSegment('history', 'a', { category: 'work', note: 'changed' }),
      ).rejects.toThrow('超出周期边界');
      expect(f.saves).toHaveLength(n);
      expect(f.persisted()).toEqual(before);
      expect(records(f.app, 'history')).toEqual(historical);
    },
  );

  it('active split rejects stale expected segments after a notification lap', async () => {
    const f = fixture();
    await f.app.initialize();
    const expected = snapshotOf(f.app.getSnapshot().live!.segments[0]);
    f.notificationLap();
    await expect(
      f.app.splitSegment(base, 'j', {
        expected,
        cuts: [T + H],
        parts: [
          { category: 'work', note: 'x' },
          { category: 'daily', note: 'y' },
        ],
      }),
    ).rejects.toThrow('发生变化');
    expect(records(f.app).session!.segments.map((s) => s.note)).toEqual(['notification note', '']);
  });

  it('classification commands use references from the latest native mirror, not stale history', async () => {
    const f = fixture();
    await f.app.initialize();
    await f.app.manageCategory({ kind: 'add', id: 'custom', name: '新分类' });
    await f.app.manageCategory({ kind: 'rename', id: 'custom', name: '改名' });
    const latest = f.nativeState();
    latest.segments[0].category = 'custom';
    f.replaceNative(latest);
    await f.app.manageCategory({ kind: 'delete', id: 'custom' });
    expect(f.persisted().settings.categories.find((c) => c.id === 'custom')).toMatchObject({
      name: '改名',
      archived: true,
    });
    expect(records(f.app).session!.segments[0].category).toBe('custom');
    await f.app.updateSegment(base, 'j', { category: 'custom', note: 'retain archived' });
    expect(f.nativeState().segments[0].note).toBe('retain archived');
    f.notificationLap();
    await expect(
      f.app.updateSegment(base, 'new-1', { category: 'custom', note: '' }),
    ).rejects.toThrow('停用');
    await expect(
      f.app.updateSegment(base, 'new-1', { category: 'pre-sleep', note: '' }),
    ).rejects.toThrow('睡前时间');
  });

  it('rejects a native edit response for a different cycle before mirroring it', async () => {
    const f = fixture();
    await f.app.initialize();
    const n = f.saves.length;
    f.onAfterEdit(() => {
      f.replaceNative({ ...f.nativeState(), cycleId: 'different' });
    });
    await expect(
      f.app.updateSegment(base, 'j', { category: 'daily', note: 'edited' }),
    ).rejects.toThrow('活动周期已变化');
    expect(f.saves).toHaveLength(n);
    expect(f.app.getSnapshot().live!.cycleId).toBe(base);
    expect(records(f.app).session!.segments[0].note).toBe('');
  });

  it('active segment edit displays native commit after mirror failure', async () => {
    const f = fixture();
    await f.app.initialize();
    f.saveFaults.push(fail);
    await expect(
      f.app.updateSegment(base, 'j', { category: 'work', note: 'done' }),
    ).rejects.toThrow('disk failed');
    expect(f.nativeState().segments[0]).toMatchObject({ category: 'work', note: 'done' });
    expect(f.app.getSnapshot().live!.segments[0].note).toBe('done');
    expect(records(f.app).session!.segments[0].note).toBe('done');
    expect(f.persisted().cycles[0].session!.segments[0].note).toBe('');
    await f.app.refreshLive();
    expect(f.persisted().cycles[0].session!.segments[0].note).toBe('done');
  });

  it.each(['overwrite', 'merge'] as const)(
    'restore %s protects the current native cycle even with a same-ID backup',
    async (mode) => {
      const f = fixture({ initial: historyData() });
      await f.app.initialize();
      f.notificationLap();
      await f.app.restore({ cycles: [cycle([segment('backup')], base)], categories: [] }, mode, {});
      expect(
        f
          .persisted()
          .cycles.find((c) => c.id === base)!
          .session!.segments.map((s) => s.note),
      ).toEqual(['notification note', '']);
      expect(f.persisted().cycles.some((c) => c.id === 'history')).toBe(mode === 'merge');
    },
  );

  it.each(['overwrite', 'merge'] as const)(
    'restore %s protects an ended but still active native cycle including its latest segment',
    async (mode) => {
      const f = fixture({ initial: historyData() });
      await f.app.initialize();
      f.notificationLap();
      f.setTime(now + H);
      const ended = f.nativeState();
      ended.status = 'ended';
      ended.segments[1].endAtMs = now + H;
      ended.segments[1].note = 'native final';
      f.replaceNative(ended);
      const backupCycle = cycle([segment('backup')], base);
      await f.app.restore({ cycles: [backupCycle], categories: [] }, mode, {});
      expect(f.app.getSnapshot().live).toEqual(ended);
      expect(records(f.app)).toMatchObject({
        closedAtMs: null,
        session: { status: 'ended', id: ended.sessionId, segments: ended.segments },
      });
      expect(f.persisted()).toEqual(f.app.getSnapshot().data);
      expect(f.persisted().cycles.some((c) => c.id === 'history')).toBe(mode === 'merge');
    },
  );

  it('readRestoreFile uses the injected clock for legacy timestamps and rejects malformed or unsupported content without mutation', async () => {
    const f = fixture();
    await f.app.initialize();
    const before = f.app.getSnapshot();
    const n = f.calls.length;
    f.setTime(now + H);
    const legacy = {
      schemaVersion: 1,
      cycles: [{ id: 'old', sleepAtMs: T - 8 * H, wakeAtMs: T, createdAtMs: T }],
    };
    const result = await f.app.readRestoreFile({
      async text() {
        return JSON.stringify(legacy);
      },
    });
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]).toMatchObject({
      id: 'old',
      sleepAtMs: T - 8 * H,
      wakeAtMs: T,
      createdAtMs: T,
      updatedAtMs: now + H,
    });
    expect(result.categories.some((c) => c.id === 'unclassified')).toBe(true);
    await expect(
      f.app.readRestoreFile({
        async text() {
          return '{invalid';
        },
      }),
    ).rejects.toBeInstanceOf(SyntaxError);
    await expect(
      f.app.readRestoreFile({
        async text() {
          return JSON.stringify({ ...legacy, schemaVersion: 4 });
        },
      }),
    ).rejects.toThrow('不兼容');
    expect(f.app.getSnapshot()).toBe(before);
    expect(f.calls).toHaveLength(n);
  });

  it('begins a same-day cycle with next unused ID and closes the prior open tail as pre-sleep', async () => {
    const d = defaultData();
    d.cycles = [cycle([], `${base}-2`), cycle([], `${base}-4`)];
    const f = fixture({ initial: d });
    await f.app.initialize();
    await f.app.updateSleepMetrics(base, {
      screenshotPath: 'keep.jpg',
      sleepMetrics: { score: 80, note: 'keep', reportedTotalMs: null },
    });
    const newWake = T + H; // T is midnight or 16:00 depending on zone, both remain same local date here.
    await f.app.beginNextCycle({ wakeAtMs: newWake, sleepDurationMs: H / 2 });
    expect(f.app.getSnapshot().live!.cycleId).toBe(`${base}-3`);
    expect(records(f.app)).toMatchObject({
      closedAtMs: T + H / 2,
      screenshotPath: 'keep.jpg',
      sleepMetrics: { score: 80 },
      session: {
        status: 'ended',
        segments: [{ id: 'j', endAtMs: T + H / 2, category: 'pre-sleep' }],
      },
    });
  });

  it('known baseline limitation: next cycle can proceed after failed refresh', async () => {
    const f = fixture();
    await f.app.initialize();
    f.failRead();
    await f.app.beginNextCycle({ wakeAtMs: T + 12 * H, sleepDurationMs: 8 * H });
    expect(f.calls).toContain('startCycle');
    expect(f.app.getSnapshot().error).toContain('native read failed');
  });

  it('known baseline limitation: lap between refresh and native start is absent from old history', async () => {
    const f = fixture();
    await f.app.initialize();
    f.onBeforeStart(f.notificationLap);
    await f.app.beginNextCycle({ wakeAtMs: T + 12 * H, sleepDurationMs: 8 * H });
    expect(records(f.app).session!.segments.map((s) => s.id)).toEqual(['j']);
    expect(records(f.app).session!.segments[0].note).toBe('');
  });

  it.each(['startNap', 'endNap'] as const)(
    '%s retains the committed native segments on mirror failure and refresh persists them',
    async (action) => {
      const ending = action === 'endNap';
      const oldSegments = ending
        ? [
            segment('a', T, T + H, 'work', 'prior'),
            { ...segment('nap', T + H, 0, 'sleep', ''), seq: 2 },
          ]
        : live().segments;
      const f = fixture({ initial: historyData(), active: { ...live(), segments: oldSegments } });
      await f.app.initialize();
      const before = f.persisted();
      const oldTail = oldSegments.at(-1)!;
      const expectedSegments = [
        ...oldSegments.slice(0, -1),
        { ...oldTail, endAtMs: now, note: '', source: 'app' },
        {
          ...segment('new-1', now, 0, ending ? 'unclassified' : 'sleep', ''),
          seq: oldSegments.length + 1,
        },
      ];
      const start = f.calls.length;
      f.saveFaults.push(fail);
      await expect(f.app[action]()).rejects.toThrow('disk failed');
      expect(f.calls.slice(start)).toEqual([action, 'save']);
      expect(f.nativeState().segments).toEqual(expectedSegments);
      expect(f.app.getSnapshot().live).toEqual(f.nativeState());
      expect(records(f.app).session!.segments).toEqual(expectedSegments);
      expect(f.persisted()).toEqual(before);
      expect(f.saves.at(-1)).toEqual(f.app.getSnapshot().data);
      await f.app.refreshLive();
      expect(f.calls.slice(start)).toEqual([action, 'save', 'getState', 'save']);
      expect(f.persisted()).toEqual(f.app.getSnapshot().data);
      expect(f.persisted().cycles.find((c) => c.id === base)!.session!.segments).toEqual(
        expectedSegments,
      );
      expect(f.persisted().cycles.find((c) => c.id === 'history')).toEqual(
        before.cycles.find((c) => c.id === 'history'),
      );
    },
  );

  it('end and restart keep one cycle with cumulative segments; close saves ended before clearing native', async () => {
    const f = fixture();
    await f.app.initialize();
    await f.app.endSession();
    expect(records(f.app).closedAtMs).toBeNull();
    f.setTime(now + H);
    await f.app.restartSession();
    expect(records(f.app).session!.segments.map((s) => s.id)).toEqual(['j', 'new-2']);
    f.setTime(now + H + H / 2);
    await f.app.startNap();
    f.setTime(now + 2 * H);
    await f.app.endNap();
    f.setTime(now + 3 * H);
    const start = f.calls.length;
    await f.app.closeCycle();
    expect(f.calls.slice(start)).toEqual(['getState', 'endSession', 'save', 'closeCycle', 'save']);
    expect(f.saves.at(-2)!.cycles[0]).toMatchObject({
      closedAtMs: null,
      session: { status: 'ended' },
    });
    expect(f.app.getSnapshot().live).toBeNull();
    expect(f.persisted().cycles[0].closedAtMs).toBe(now + 3 * H);
  });

  it('close first-save failure leaves ended native intact', async () => {
    const f = fixture();
    await f.app.initialize();
    f.saveFaults.push(fail);
    await expect(f.app.closeCycle()).rejects.toThrow('disk failed');
    expect(f.nativeState().status).toBe('ended');
    expect(f.calls).not.toContain('closeCycle');
    await f.app.closeCycle();
    expect(f.persisted().cycles[0].closedAtMs).toBe(now);
  });

  it('known baseline limitation: close second-save failure keeps ended history but retry does not close it', async () => {
    const f = fixture();
    await f.app.initialize();
    f.saveFaults.push(async () => {}, fail);
    await expect(f.app.closeCycle()).rejects.toThrow('disk failed');
    expect(f.nativeState().status).toBe('idle');
    expect(f.app.getSnapshot().live).toBeNull();
    expect(f.persisted().cycles[0]).toMatchObject({
      closedAtMs: null,
      session: { status: 'ended' },
    });
    const n = f.saves.length;
    await f.app.closeCycle();
    expect(f.saves).toHaveLength(n);
  });

  it('start survives screenshot failure but not mirror failure', async () => {
    const f = fixture({ active: { ...live(), status: 'idle', cycleId: '', segments: [] } });
    await f.app.initialize();
    f.failScreenshot();
    f.saveFaults.push(fail);
    await expect(
      f.app.startCycle({
        wakeAtMs: T,
        sleepDurationMs: 8 * H,
        score: 99,
        screenshot: {
          type: 'image/jpeg',
          async arrayBuffer() {
            return new ArrayBuffer(0);
          },
        },
      }),
    ).rejects.toThrow('disk failed');
    expect(f.app.getSnapshot().error).toContain('截图保存失败');
    expect(records(f.app).sleepMetrics.score).toBe(99);
    expect(f.nativeState().cycleId).toBe(base);
  });

  it('device preference writes native first, then persists settings', async () => {
    const f = fixture();
    await f.app.initialize();
    f.saveFaults.push(fail);
    const i = f.calls.length;
    await expect(f.app.setNotificationsEnabled(false)).rejects.toThrow('disk failed');
    expect(f.calls.slice(i)).toEqual(['notifications', 'save']);
    expect(f.nativeState().notificationsEnabled).toBe(false);
    expect(f.app.getSnapshot().data.settings.notificationsEnabled).toBe(true);
    expect(await f.app.requestNotificationPermission()).toEqual({ granted: true });
    expect(f.calls.slice(-2)).toEqual(['permission', 'delay:800']);
  });

  it('known baseline limitation: notification preference commits natively after load failure, but local setting rejects without overwriting history', async () => {
    const initial = historyData();
    const f = fixture({ initial });
    f.failLoad();
    await f.app.initialize();
    const priorCalls = f.calls.length;
    const priorData = f.app.getSnapshot().data;
    await expect(f.app.setNotificationsEnabled(false)).rejects.toThrow('暂停修改');
    expect(f.calls.slice(priorCalls)).toEqual(['notifications']);
    expect(f.nativeState().notificationsEnabled).toBe(false);
    expect(f.persisted()).toEqual(initial);
    expect(f.app.getSnapshot().data).toBe(priorData);
    expect(f.app.getSnapshot().data.settings.notificationsEnabled).toBe(true);
    expect(f.app.getSnapshot()).toMatchObject({
      loadFailed: true,
      error: expect.stringContaining('暂停修改'),
    });
  });

  it('web initializes without timer activity and cannot open a new native cycle', async () => {
    const f = fixture({ native: false });
    await f.app.initialize();
    await f.app.startCycle({ wakeAtMs: T, sleepDurationMs: H });
    await f.app.setNotificationsEnabled(false);
    expect(f.calls).toEqual(['load', 'save', 'save']);
    expect(f.app.getSnapshot().live).toBeNull();
    await expect(f.app.requestNotificationPermission()).rejects.toThrow('手机');
  });

  it('clearing records commits native first; disk failure retains prior durable and visible history', async () => {
    const f = fixture();
    await f.app.initialize();
    f.saveFaults.push(fail);
    await expect(f.app.clearAll()).rejects.toThrow('disk failed');
    expect(f.nativeState().status).toBe('idle');
    expect(f.app.getSnapshot().live).toBeNull();
    expect(f.persisted().cycles).toHaveLength(1);
    expect(f.app.getSnapshot().data.cycles).toHaveLength(1);
    await f.app.clearAll();
    expect(f.persisted().cycles).toEqual([]);
  });

  it('queues notification preference and refresh behind an unfinished historical save', async () => {
    const f = fixture({ initial: historyData() });
    await f.app.initialize();
    const gate = deferred();
    const entered = deferred();
    f.saveFaults.push(() => {
      entered.resolve();
      return gate.promise;
    });
    const edit = f.app.updateSegment('history', 'a', { category: 'daily', note: 'saved history' });
    await entered.promise;
    const start = f.calls.length;
    const preference = f.app.setNotificationsEnabled(false);
    const refresh = f.app.refreshLive();
    // Simulate a notification lap after the historical save has captured its
    // data, so only a later authoritative refresh can bring this segment in.
    f.notificationLap();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.calls).toHaveLength(start);
    expect(f.nativeState().notificationsEnabled).toBe(true);
    expect(f.persisted().settings.notificationsEnabled).toBe(true);
    gate.resolve();
    await Promise.all([edit, preference, refresh]);
    expect(f.calls.slice(start)).toEqual(['notifications', 'save', 'getState', 'save']);
    const [historySave, settingsSave, refreshedSave] = f.saves.slice(-3);
    expect(historySave.settings.notificationsEnabled).toBe(true);
    expect(settingsSave.settings.notificationsEnabled).toBe(false);
    expect(settingsSave.cycles.find((c) => c.id === base)!.session!.segments).toHaveLength(1);
    expect(f.nativeState().notificationsEnabled).toBe(false);
    expect(f.app.getSnapshot().live).toEqual(f.nativeState());
    expect(f.persisted()).toEqual(refreshedSave);
    expect(f.persisted()).toEqual(f.app.getSnapshot().data);
    expect(f.persisted().settings.notificationsEnabled).toBe(false);
    expect(
      f.persisted().cycles.find((c) => c.id === 'history')!.session!.segments[0],
    ).toMatchObject({ category: 'daily', note: 'saved history' });
    expect(f.persisted().cycles.find((c) => c.id === base)!.session!.segments).toEqual(
      f.nativeState().segments,
    );
    expect(records(f.app).session!.segments[0]).toMatchObject({
      source: 'notification',
      note: 'notification note',
      endAtMs: now,
    });
  });

  it('exports exact TXT, single-day JSON, full JSON and PDF payloads from the selected snapshot and clock', async () => {
    const f = fixture({ initial: historyData() });
    await f.app.initialize();
    await f.app.lap('exported note');
    f.setTime(now + H);
    const before = f.app.getSnapshot();
    const data = before.data;
    const selected = records(f.app);
    const exportClock = () => now + H;
    const start = f.calls.length;
    await f.app.exportRecords('txt', base);
    await f.app.exportRecords('json', base);
    await f.app.exportRecords('backup');
    await f.app.exportRecords('pdf', base);
    expect(f.sharedFiles).toEqual([
      {
        name: `waketime-${base}.txt`,
        text: buildDayTxt(selected, data.cycles, data.settings.categories, exportClock),
      },
      {
        name: `waketime-${base}.json`,
        text: buildBackupJson([selected], data.settings, exportClock),
      },
      {
        name: `waketime-backup-${new Date(exportClock()).toISOString().slice(0, 10)}.json`,
        text: buildBackupJson(data.cycles, data.settings, exportClock),
      },
    ]);
    expect(f.sharedFiles[0].text).toContain('exported note');
    expect(f.sharedFiles[0].text).toContain('实际清醒：5h');
    const single = JSON.parse(f.sharedFiles[1].text);
    const backup = JSON.parse(f.sharedFiles[2].text);
    expect(single).toMatchObject({
      schemaVersion: 3,
      exportedAtMs: exportClock(),
      cycles: [selected],
      cycleSummaries: [{ cycleId: base, awakeMs: 5 * H }],
    });
    expect(backup).toMatchObject({
      schemaVersion: 3,
      exportedAtMs: exportClock(),
      cycles: data.cycles,
    });
    expect(backup.cycleSummaries).toHaveLength(2);
    expect(f.pdfRequests).toEqual([
      {
        filename: `waketime-${base}.pdf`,
        blocks: buildPdfBlocks(selected, data.cycles, data.settings.categories, exportClock),
        share: true,
      },
    ]);
    expect(f.pdfRequests[0].blocks).toContainEqual({
      kind: 'row',
      text: expect.stringContaining('exported note'),
      right: '4h',
    });
    expect(f.calls.slice(start)).toEqual([
      ...f.sharedFiles.map(({ name, text }) => `share:${name}:${text}`),
      `pdf:waketime-${base}.pdf`,
    ]);
    expect(f.app.getSnapshot()).toBe(before);
  });

  it('exports through injected file capability without refreshing or writing records', async () => {
    const f = fixture();
    await f.app.initialize();
    const n = f.saves.length;
    expect(await f.app.exportRecords('pdf', base)).toContain('2 KB');
    await f.app.exportRecords('json', base);
    expect(f.calls.find((c) => c.startsWith(`share:waketime-${base}.json:`))).toContain(
      '"schemaVersion": 3',
    );
    expect(f.saves).toHaveLength(n);
  });
});
