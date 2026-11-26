import { Capacitor, registerPlugin } from '@capacitor/core';
import type { TimerPort, DevicePort } from '../application/index';

export type WakeTimerPlugin = Omit<TimerPort, 'isNativePlatform'> & DevicePort;
export const WakeTimer = registerPlugin<WakeTimerPlugin>('WakeTimer');
export const isNativePlatform = Capacitor.isNativePlatform();

export const timerPort: TimerPort = {
  isNativePlatform,
  getState: () => WakeTimer.getState(),
  startCycle: (options) => WakeTimer.startCycle(options),
  lap: (options) => WakeTimer.lap(options),
  restartSession: () => WakeTimer.restartSession(),
  setNote: (options) => WakeTimer.setNote(options),
  setSegmentDetails: (options) => WakeTimer.setSegmentDetails(options),
  mergeSegments: (options) => WakeTimer.mergeSegments(options),
  splitSegment: (options) => WakeTimer.splitSegment(options),
  startNap: () => WakeTimer.startNap(),
  endNap: () => WakeTimer.endNap(),
  endSession: () => WakeTimer.endSession(),
  closeCycle: () => WakeTimer.closeCycle(),
};
export const devicePort: DevicePort = {
  setNotificationsEnabled: (options) => WakeTimer.setNotificationsEnabled(options),
  requestNotificationPermission: () => WakeTimer.requestNotificationPermission(),
  checkNotificationPermission: () => WakeTimer.checkNotificationPermission(),
  openNotificationSettings: () => WakeTimer.openNotificationSettings(),
  openAppSettings: () => WakeTimer.openAppSettings(),
  getDeviceInfo: () => WakeTimer.getDeviceInfo(),
};
