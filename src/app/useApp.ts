import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Application, AppApi } from '../application/index';
import { application, subscribeForeground } from './runtime';

export type { AppApi, NewSleepInput } from '../application/index';

/** React renders a snapshot and owns only the display clock and lifecycle. */
export function useApp(app: Application = application, onForeground = subscribeForeground): AppApi {
  const { getSnapshot, subscribe, initialize, ...actions } = app;
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(
    () =>
      onForeground(() => {
        void app.refreshLive();
      }),
    [app, onForeground],
  );
  return { ...snapshot, ...actions, now };
}
