import { App as CapApp } from '@capacitor/app';
import { createApplication, type ApplicationDeps } from '../application/index';
import { createPlatformRecordStore } from '../infrastructure/platformStore';
import { timerPort, devicePort } from '../infrastructure/wakeTimer';
import { filePort } from '../infrastructure/files';
import { feedbackPort } from '../infrastructure/feedback';

export const recordStore = createPlatformRecordStore();
const clock: ApplicationDeps['clock'] = {
  now: Date.now,
  delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
export const application = createApplication({
  store: recordStore,
  timer: timerPort,
  device: devicePort,
  files: filePort,
  feedback: feedbackPort,
  clock,
});

export function subscribeForeground(listener: () => void): () => void {
  if (!timerPort.isNativePlatform) return () => {};
  const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) listener();
  });
  return () => {
    void sub.then((handle) => handle.remove());
  };
}
