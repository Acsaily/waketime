// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppApi, LiveState } from '../../src/application/index';
import { defaultData } from '../../src/application/index';
import { Today } from '../../src/features/today/Today';
import { Settings } from '../../src/features/settings/Settings';
import { cycle, H, segment, T } from '../fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fakeApi() {
  const ended = segment('ended', T, T + H, 'work', '合成备注');
  const open = { ...segment('open', T + H, 0, 'unclassified', ''), seq: 2 };
  const active: LiveState = {
    cycleId: 'synthetic',
    status: 'running',
    sessionId: 'session',
    sessionStartedAtMs: T,
    sleepAtMs: T - 8 * H,
    wakeAtMs: T,
    targetAtMs: T + 16 * H,
    notificationsEnabled: true,
    clockAnomaly: false,
    segments: [ended, open],
  };
  const data = defaultData();
  data.cycles = [cycle(active.segments, active.cycleId)];
  data.cycles[0].closedAtMs = null;
  const next = {
    ...active,
    segments: [
      ended,
      { ...open, endAtMs: T + 2 * H },
      { ...open, id: 'new', seq: 3, startAtMs: T + 2 * H },
    ],
  };
  const noop = () => vi.fn(async (): Promise<void> => undefined);
  const api = {
    data,
    live: active,
    now: T + 2 * H,
    ready: true,
    error: null,
    loadFailed: false,
    recoveredFrom: null,
    isNativePlatform: true,
    refreshLive: vi.fn(async () => active),
    startCycle: noop(),
    beginNextCycle: noop(),
    lap: vi.fn(async () => next),
    setSegmentNote: vi.fn(async () => active),
    endSession: vi.fn(async () => active),
    restartSession: vi.fn(async () => active),
    closeCycle: noop(),
    updateSleepMetrics: noop(),
    updateSettings: vi.fn(async () => undefined),
    clearAll: noop(),
    manageCategory: noop(),
    restore: noop(),
    updateSegment: vi.fn(async (): Promise<void> => undefined),
    mergeSegments: noop(),
    splitSegment: noop(),
    startNap: noop(),
    endNap: noop(),
    setNotificationsEnabled: vi.fn(async () => undefined),
    getDeviceInfo: vi.fn(async () => ({
      manufacturer: 'synthetic',
      model: 'test',
      sdkInt: 36,
      androidRelease: '16',
      webViewVersion: 'test',
      notificationsGranted: true,
    })),
    requestNotificationPermission: vi.fn(async () => ({ granted: true })),
    openNotificationSettings: noop(),
    openAppSettings: noop(),
    exportRecords: vi.fn(async () => '合成导出成功'),
    exportPeriod: vi.fn(async () => '合成周期导出成功'),
    readRestoreFile: vi.fn(async () => ({ cycles: [], categories: [] })),
    screenshotUrl: vi.fn(async () => null),
    feedback: vi.fn(),
  } satisfies AppApi;
  return { api, active, next };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('feature UI and application boundary', () => {
  it('lap is locked until completion, then opens editor with the ended segment; failed edit retains input', async () => {
    const { api, next } = fakeApi();
    const lap = deferred<LiveState>();
    api.lap.mockReturnValueOnce(lap.promise);
    const editing = deferred<void>();
    api.updateSegment.mockReturnValueOnce(editing.promise);
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    const node = render(<Today api={api} />);
    const button = screen.getByRole('button', { name: '计次' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('正在处理');
    fireEvent.click(button);
    expect(api.lap).toHaveBeenCalledTimes(1);
    await act(async () => {
      lap.resolve(next);
    });
    node.rerender(<Today api={{ ...api, live: next }} />);
    const dialog = screen.getByRole('dialog', { name: '刚结束的这一段' });
    expect(api.feedback).toHaveBeenCalledWith(api.data.settings, 'lap');
    const note = within(dialog).getByLabelText('备注（可留空）');
    fireEvent.change(note, { target: { value: '待保存备注' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存分类与备注' }));
    expect(within(dialog).getByRole('button', { name: '关闭' })).toBeDisabled();
    await act(async () => {
      editing.reject(new Error('合成写入失败'));
    });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '保存失败：合成写入失败。修改仍保留，可重试。',
    );
    expect(note).toHaveValue('待保存备注');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存分类与备注' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.updateSegment).toHaveBeenLastCalledWith('synthetic', 'open', {
      note: '待保存备注',
      category: 'unclassified',
    });
    expect(api.feedback).toHaveBeenLastCalledWith(api.data.settings, 'tick');
  });

  it('nap controls and cycle confirmation dispatch only intended actions', async () => {
    const { api, active } = fakeApi();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <Today
        api={{
          ...api,
          live: {
            ...active,
            segments: [active.segments[0], { ...active.segments[1], category: 'sleep' }],
          },
        }}
      />,
    );
    expect(screen.getByText('补觉中 · 秒表暂停')).toBeVisible();
    expect(screen.queryByRole('button', { name: '计次' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '结束补觉' }));
    await waitFor(() => expect(api.endNap).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: '结束本周期' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '结束本周期' }));
    expect(confirm).toHaveBeenCalled();
    // no other invocation after cancellation
    expect(api.closeCycle).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: '结束本周期' }));
    await waitFor(() => expect(api.closeCycle).toHaveBeenCalledTimes(1));
  });

  it('today category summary drills into a parent and returns by clicking the summary', () => {
    const { api, active } = fakeApi();
    api.data.settings.categories.push({
      id: 'cat-study',
      name: '合成学习',
      parentId: 'work',
      archived: false,
      color: '#123456',
    });
    const child = { ...active.segments[0], category: 'cat-study' };
    render(<Today api={{ ...api, live: { ...active, segments: [child, active.segments[1]] } }} />);
    const group = screen.getByRole('button', { name: '查看工作的细分' });
    expect(group).toHaveTextContent('1h');
    fireEvent.click(group);
    const drill = screen.getByRole('button', { name: '工作的细分时间，点任意处返回大类汇总' });
    expect(within(drill).getByText('合成学习')).toBeVisible();
    fireEvent.click(drill);
    expect(screen.getByRole('button', { name: '查看工作的细分' })).toBeVisible();
  });

  it('sleep recording retains form data on failure and retries without duplicate submission', async () => {
    const { api } = fakeApi();
    const pending = deferred<void>();
    api.startCycle.mockReturnValueOnce(pending.promise);
    render(<Today api={{ ...api, live: null }} />);
    fireEvent.click(screen.getByRole('button', { name: '录入昨晚的睡眠' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '8h' }));
    fireEvent.change(within(dialog).getByPlaceholderText('睡得怎么样'), {
      target: { value: '合成睡眠备注' },
    });
    const submit = within(dialog).getByRole('button', { name: '保存并开始计时' });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(api.startCycle).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(new Error('合成计时失败'));
    });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      '保存失败：合成计时失败。输入已保留，请重试。',
    );
    expect(within(dialog).getByLabelText('小时')).toHaveValue('8');
    expect(within(dialog).getByPlaceholderText('睡得怎么样')).toHaveValue('合成睡眠备注');
    fireEvent.click(within(dialog).getByRole('button', { name: '保存并开始计时' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.startCycle).toHaveBeenLastCalledWith(
      expect.objectContaining({ sleepDurationMs: 8 * H, note: '合成睡眠备注' }),
    );
  });

  it('fills editable period dates, previews records and shares the export lock', async () => {
    const { api } = fakeApi();
    const pending = deferred<string>();
    api.exportRecords.mockReturnValueOnce(pending.promise);
    render(<Settings api={api} />);
    expect(screen.getAllByRole('button', { name: '导出 JSON' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '周期 JSON' })).toBeNull();
    const panel = screen.getByRole('region', { name: '导出与备份' });
    expect(within(panel).queryByRole('button', { name: '全量备份 JSON' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '最近 7 天' }));
    const start = screen.getByLabelText('开始日期');
    const end = screen.getByLabelText('结束日期');
    const day = new Date(T).getDate();
    const key = `2026-11-${String(day).padStart(2, '0')}`;
    fireEvent.change(start, { target: { value: key } });
    fireEvent.change(end, { target: { value: key } });
    expect(screen.getByText('记录 1 天 · 1 个周期')).toBeVisible();
    expect(screen.getByText(/1 个周期尚未结束/)).toBeVisible();
    const button = screen.getByRole('button', { name: '导出 JSON' });
    fireEvent.click(button);
    expect(api.exportRecords).toHaveBeenCalledWith('json', 'synthetic', api.now);
    expect(screen.getByRole('button', { name: '全量备份 JSON' })).toBeDisabled();
    expect(start).toBeDisabled();
    await act(async () => pending.resolve('周期成功'));
    expect(screen.getByText('周期成功')).toBeVisible();
    fireEvent.change(start, { target: { value: '2026-12-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('开始日期不能晚于结束日期');
    expect(start).toHaveAttribute('aria-invalid', 'true');
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: '全量备份 JSON' })).toBeEnabled();
  });

  it('keeps full backup available without recorded cycles and independent of an invalid range', async () => {
    const { api } = fakeApi();
    api.data.cycles = [];
    render(<Settings api={api} />);
    const backup = within(screen.getByRole('region', { name: '数据' })).getByRole('button', {
      name: '全量备份 JSON',
    });
    expect(screen.getByRole('button', { name: '导出 JSON' })).toBeDisabled();
    expect(backup).toBeEnabled();
    fireEvent.click(backup);
    await waitFor(() => expect(api.exportRecords).toHaveBeenCalledWith('backup'));
    await waitFor(() => expect(backup).toBeEnabled());
  });

  it('settings use application-owned permission and export operations with retry feedback', async () => {
    const { api } = fakeApi();
    const request = deferred<{ granted: boolean }>();
    api.requestNotificationPermission.mockReturnValueOnce(request.promise);
    const exported = deferred<string>();
    api.exportRecords.mockReturnValueOnce(exported.promise);
    render(<Settings api={api} />);
    fireEvent.click(screen.getByRole('button', { name: '申请通知权限' }));
    expect(screen.getByRole('button', { name: '打开通知设置' })).toBeDisabled();
    expect(api.requestNotificationPermission).toHaveBeenCalledTimes(1);
    await act(async () => {
      request.resolve({ granted: true });
    });
    expect(screen.getByText('通知权限已开启')).toBeVisible();
    fireEvent.click(screen.getByLabelText('显示常驻通知（参考剩余 + 实际清醒）'));
    await waitFor(() => expect(api.setNotificationsEnabled).toHaveBeenCalledWith(false));
    expect(api.updateSettings).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/常驻通知已关闭/)).toBeVisible());
    const key = `2026-11-${String(new Date(T).getDate()).padStart(2, '0')}`;
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: key } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: key } });
    fireEvent.click(screen.getByRole('button', { name: '导出 TXT' }));
    expect(api.exportRecords).toHaveBeenCalledWith('txt', 'synthetic', api.now);
    expect(screen.getByRole('button', { name: '导出 PDF' })).toBeDisabled();
    await act(async () => {
      exported.reject(new Error('合成导出失败'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('导出失败：合成导出失败');
    fireEvent.click(screen.getByRole('button', { name: '导出 TXT' }));
    await waitFor(() => expect(screen.getByText('合成导出成功')).toBeVisible());
  });
});
