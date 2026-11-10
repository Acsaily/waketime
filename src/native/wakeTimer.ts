import { Capacitor, registerPlugin } from '@capacitor/core';
import type { DeviceInfo, LiveState, SegmentCategory } from './contracts';
import type { SplitInput } from '../core/splitSegments';

export interface WakeTimerPlugin {
  getState(): Promise<LiveState>;
  startCycle(options: { cycleId: string; sleepAtMs: number; wakeAtMs: number }): Promise<LiveState>;
  lap(options: { note?: string }): Promise<LiveState>;
  restartSession(): Promise<LiveState>;
  setNote(options: { segmentId: string; note: string }): Promise<LiveState>;
  setSegmentDetails(options: { segmentId: string; note: string; category: SegmentCategory }): Promise<LiveState>;
  mergeSegments(options: { firstId: string; secondId: string; category: SegmentCategory }): Promise<LiveState>;
  splitSegment(options: SplitInput & { cycleId: string; segmentId: string }): Promise<LiveState>;
  startNap(): Promise<LiveState>;
  endNap(): Promise<LiveState>;
  endSession(): Promise<LiveState>;
  closeCycle(): Promise<LiveState>;
  setNotificationsEnabled(options: { enabled: boolean }): Promise<LiveState>;
  requestNotificationPermission(): Promise<void>;
  checkNotificationPermission(): Promise<{ granted: boolean }>;
  openNotificationSettings(): Promise<void>;
  openAppSettings(): Promise<void>;
  getDeviceInfo(): Promise<DeviceInfo>;
}

const WakeTimer = registerPlugin<WakeTimerPlugin>('WakeTimer');

export const isNativePlatform = Capacitor.isNativePlatform();

export { WakeTimer };
