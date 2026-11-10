import { useState } from 'react';
import { useApp } from './state/useApp';
import { Today } from './pages/Today';
import { History } from './pages/History';
import { Export } from './pages/Export';
import { Settings } from './pages/Settings';
import { SleepDialog, type SleepFormValue } from './components/SleepDialog';

type Tab = 'today' | 'history' | 'export' | 'settings';

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'today', label: '今日', icon: '◷' },
  { key: 'history', label: '历史', icon: '▤' },
  { key: 'export', label: '导出', icon: '⇪' },
  { key: 'settings', label: '设置', icon: '⚙' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('today');
  const [nextOpen, setNextOpen] = useState(false);
  const [nextWake, setNextWake] = useState(Date.now());
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const api = useApp();

  const activeCycle = api.live !== null && api.live.status !== 'idle' && api.live.cycleId !== '';
  const lastCycle = api.data.cycles[0];

  const openNextDay = () => {
    setNextWake(Date.now()); // 打开那一刻固定起床默认值，避免渲染时反复重置
    setNextOpen(true);
  };

  const saveNextDay = async (value: SleepFormValue) => {
    await api.beginNextCycle(value);
    setNextOpen(false);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>清醒时光</h1>
          <p className="subtitle">
            {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
            {activeCycle ? ' · 当前周期进行中' : ''}
          </p>
        </div>
        {activeCycle ? (
          <button className="header-action" onClick={openNextDay}>
            开启第二天
          </button>
        ) : (
          <div className="header-badge">{api.live?.status === 'running' ? '计时中' : api.ready ? '就绪' : '加载中'}</div>
        )}
      </header>

      <main className="app-main">
        {api.recoveredFrom && !recoveryDismissed ? (
          <div className="recovery-banner">
            <b>已从 {api.recoveredFrom} 恢复 {api.data.cycles.length} 天记录</b>
            <p>
              主数据文件上次没写完（可能是在保存时被系统杀掉），已自动改用备份。当前计时和今天的记录不受影响，可以继续记；建议现在到「导出」做一次全量备份。
            </p>
            <button className="btn ghost" onClick={() => setRecoveryDismissed(true)}>
              知道了
            </button>
          </div>
        ) : null}
        {!api.ready ? (
          <p className="hint">正在读取本地记录…</p>
        ) : tab === 'today' ? (
          <Today api={api} />
        ) : tab === 'history' ? (
          <History api={api} />
        ) : tab === 'export' ? (
          <Export api={api} />
        ) : (
          <Settings api={api} />
        )}
      </main>

      <SleepDialog
        open={nextOpen}
        onClose={() => setNextOpen(false)}
        onSave={saveNextDay}
        initialWake={nextWake}
        initialDurationMs={lastCycle?.sleepDurationMs ?? 7.5 * 3600_000}
      />

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span className="tab-icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
