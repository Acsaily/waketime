import { useEffect, useRef, useState } from 'react';
import type { AppApi } from '../state/useApp';
import { isNativePlatform, WakeTimer } from '../native/wakeTimer';
import type { DeviceInfo } from '../native/contracts';
import { CategoryManager } from '../components/CategoryManager';
import { categoryConflicts, readRestoreBackup, type RestoreBackup, type CategoryResolutions } from '../data/restore';

type Message = { text: string; error: boolean } | null;

export function Settings({ api }: { api: AppApi }) {
  const { data, updateSettings } = api;
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [newWord, setNewWord] = useState('');
  const [permMsg, setPermMsg] = useState<Message>(null);
  const [dataMsg, setDataMsg] = useState<Message>(null);
  const [pendingRestore, setPendingRestore] = useState<RestoreBackup | null>(null);
  const [resolutions, setResolutions] = useState<CategoryResolutions>({});
  const conflicts = pendingRestore ? categoryConflicts(data.settings.categories, pendingRestore.categories) : [];
  const unresolved = conflicts.some((c) => !resolutions[c.id]);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const perform = async (target: 'permission' | 'data', action: () => Promise<string>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    const show = target === 'permission' ? setPermMsg : setDataMsg;
    show(null);
    try {
      show({ text: await action(), error: false });
    } catch (e) {
      show({ text: '操作失败：' + (e instanceof Error ? e.message : String(e)), error: true });
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };

  const onRestoreFile = (file: File) => void perform('data', async () => {
    setPendingRestore(null);
    const parsed: unknown = JSON.parse(await file.text());
    const backup = readRestoreBackup(parsed);
    setResolutions({});
    setPendingRestore(backup);
    return `读取到 ${backup.cycles.length} 个周期、${backup.categories.length} 个分类，请确认分类冲突并选择恢复方式`;
  });

  const applyRestore = (mode: 'overwrite' | 'merge') => {
    if (!pendingRestore || locked.current || unresolved) return;
    if (mode === 'overwrite' && !window.confirm('用备份覆盖本机记录？请确认已保存当前记录的全量备份。')) return;
    void perform('data', async () => {
      const count = pendingRestore.cycles.length;
      await api.restore(pendingRestore, mode, resolutions);
      setPendingRestore(null);
      return `已${mode === 'overwrite' ? '覆盖' : '合并'}恢复 ${count} 个周期及分类目录；本机通知与常用备注设置未改动，当前原生活动周期保留`;
    });
  };

  const onClear = () => {
    if (locked.current || !window.confirm('清空本机所有记录？建议先在「导出」页做一次全量备份。')) return;
    void perform('data', async () => {
      await api.clearAll();
      setPendingRestore(null);
      return '已清空本机记录';
    });
  };

  useEffect(() => {
    if (!isNativePlatform) return;
    let cancelled = false;
    WakeTimer.getDeviceInfo().then((info) => {
      if (!cancelled) setDevice(info);
    }).catch((e) => {
      if (!cancelled) setPermMsg({ text: '设备信息读取失败：' + String(e), error: true });
    });
    return () => { cancelled = true; };
  }, []);

  const toggleNotifications = (enabled: boolean) => void perform('permission', async () => {
    // 原生成功后再更新开关，失败时不显示为已经生效。
    if (isNativePlatform) await WakeTimer.setNotificationsEnabled({ enabled });
    await updateSettings({ notificationsEnabled: enabled });
    return enabled ? '常驻通知已开启' : '常驻通知已关闭，计时仍在 App 内正常进行';
  });

  const askPermission = () => void perform('permission', async () => {
    if (!isNativePlatform) throw new Error('通知权限需要在手机上设置');
    await WakeTimer.requestNotificationPermission();
    await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
    const result = await WakeTimer.checkNotificationPermission();
    return result.granted ? '通知权限已开启' : '通知权限还没开，请在系统设置里允许';
  });

  const openSettings = (app: boolean) => void perform('permission', async () => {
    if (!isNativePlatform) throw new Error('系统设置只能在手机上打开');
    if (app) await WakeTimer.openAppSettings();
    else await WakeTimer.openNotificationSettings();
    return '已请求打开系统设置，返回后可重新检查通知权限';
  });

  const addWord = () => {
    const w = newWord.trim();
    if (busy || !w || data.settings.quickNotes.includes(w) || data.settings.quickNotes.length >= 8) return;
    void perform('data', async () => {
      await updateSettings({ quickNotes: [...data.settings.quickNotes, w] });
      setNewWord('');
      return '常用备注已添加';
    });
  };

  return (
    <div className="page" aria-busy={busy}>
      <CategoryManager api={api} />
      <div className="section">
        <div className="section-head"><span>通知栏计时</span></div>
        <label className="switch-row">
          <span>显示常驻通知（参考剩余 + 实际清醒）</span>
          <input type="checkbox" checked={data.settings.notificationsEnabled} disabled={busy} onChange={(e) => toggleNotifications(e.target.checked)} />
        </label>
        <div className="buttons-grid">
          <button className="btn ghost" disabled={busy} onClick={askPermission}>申请通知权限</button>
          <button className="btn ghost" disabled={busy} onClick={() => openSettings(false)}>打开通知设置</button>
          <button className="btn ghost" disabled={busy} onClick={() => openSettings(true)}>打开应用设置</button>
        </div>
        <p className="hint">小米 / HyperOS 还需要在系统里允许「自启动」「后台运行」「锁定后台」，否则锁屏久了可能被杀。长按通知展开计次按钮；补觉中显示「结束补觉」。通知计次后可回到 App 补分类与备注。</p>
        {permMsg ? <p className={permMsg.error ? 'error' : 'status'} role={permMsg.error ? 'alert' : 'status'}>{permMsg.text}</p> : null}
      </div>

      <div className="section">
        <div className="section-head"><span>常用备注（最多 8 个）</span></div>
        <div className="chips">
          {data.settings.quickNotes.map((w) => <button key={w} className="chip" disabled={busy} aria-label={`删除常用备注 ${w}`} onClick={() => void perform('data', async () => { await updateSettings({ quickNotes: data.settings.quickNotes.filter((x) => x !== w) }); return '常用备注已删除'; })}>{w} ×</button>)}
        </div>
        <div className="inline-add">
          <input value={newWord} disabled={busy} aria-label="新的常用备注" placeholder="添加一个常用词，比如「写代码」" onChange={(e) => setNewWord(e.target.value)} />
          <button className="btn" disabled={busy || !newWord.trim() || data.settings.quickNotes.includes(newWord.trim()) || data.settings.quickNotes.length >= 8} onClick={addWord}>添加</button>
        </div>
        <p className="tiny">常用备注只填文字，不会自动推断工作、日常或补觉类别。</p>
      </div>

      <div className="section">
        <div className="section-head"><span>数据</span></div>
        <p className="hint">所有记录只存在这台手机里（应用私有目录），保存时会保留备份。<strong>卸载前请先到「导出」页做一次全量备份</strong>，否则数据会跟着 App 一起删除。</p>
        <div className="buttons-grid">
          <button className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>从备份恢复</button>
          <button className="btn ghost" disabled={busy} onClick={onClear}>清空本机记录</button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" disabled={busy} style={{ display: 'none' }} onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onRestoreFile(file);
        }} />
        {pendingRestore ? <div className="restore-preview">
          <p className="hint">备份：{pendingRestore.cycles.length} 个周期，{pendingRestore.categories.length} 个分类。恢复保留本机通知与常用备注设置；正在使用的原生活动周期不会被备份替换。</p>
          {conflicts.map((conflict) => <label className="field" key={conflict.id}><span>分类定义冲突：{conflict.id}</span>
            <select aria-label={`分类冲突${conflict.id}`} disabled={busy} value={resolutions[conflict.id] ?? ''} onChange={(e) => setResolutions({ ...resolutions, [conflict.id]: e.target.value as 'local' | 'backup' })}>
              <option value="">请选择（会影响这个分类的全部历史显示）</option>
              <option value="local">本机：{conflict.local.name} / {conflict.local.archived ? '已停用' : '使用中'}</option>
              <option value="backup">备份：{conflict.backup.name} / {conflict.backup.archived ? '已停用' : '使用中'}</option>
            </select>
          </label>)}
          <div className="buttons-grid restore-actions">
            <button className="btn primary" disabled={busy || unresolved || !pendingRestore.cycles.length} onClick={() => applyRestore('overwrite')}>覆盖恢复（{pendingRestore.cycles.length} 个周期）</button>
            <button className="btn" disabled={busy || unresolved} onClick={() => applyRestore('merge')}>合并恢复</button>
            <button className="btn ghost" disabled={busy} onClick={() => { setPendingRestore(null); setDataMsg({ text: '已取消，数据没有改动', error: false }); }}>取消</button>
          </div>
        </div> : null}
        {dataMsg ? <p className={dataMsg.error ? 'error' : 'status'} role={dataMsg.error ? 'alert' : 'status'}>{dataMsg.text}</p> : null}
      </div>
      {busy ? <p className="hint" role="status">正在处理，请稍候…</p> : null}
      {api.error ? <p className="error" role="alert">{api.error}</p> : null}

      <div className="section">
        <div className="section-head"><span>关于</span></div>
        <p className="tiny">清醒时光 v{data.appVersion} · 包名 com.personal.waketime{device ? ` · ${device.manufacturer} ${device.model} · Android ${device.androidRelease} (SDK ${device.sdkInt}) · WebView ${device.webViewVersion}` : ''}</p>
        <p className="tiny">参考截止 = 本周期主睡眠开始 + 24 小时，补觉不会顺延截止。总睡眠 = 主睡眠 + 补觉；实际清醒不含补觉，包含暂停空档。清醒预算 = 24 小时减总睡眠，最少为 0。倒计时只是参考，不强制作息。</p>
      </div>
    </div>
  );
}
