// 原生侧（Java）返回的数据形状
import type { CategoryId } from '../modules/classification/index';
import type { Segment } from '../modules/time-tracking/index';

/** 原生桥沿用领域分类与活动段的序列化字段。 */
export type SegmentCategory = CategoryId;
export type TimerSegment = Segment;

export interface LiveState {
  cycleId: string;
  sleepAtMs: number;
  wakeAtMs: number;
  targetAtMs: number;
  status: 'idle' | 'running' | 'ended';
  sessionId: string;
  sessionStartedAtMs: number;
  notificationsEnabled: boolean;
  clockAnomaly: boolean;
  segments: TimerSegment[];
}

export interface DeviceInfo {
  sdkInt: number;
  androidRelease: string;
  model: string;
  manufacturer: string;
  webViewVersion: string;
  notificationsGranted: boolean;
}

import type { SplitInput } from '../modules/time-tracking/index';
import type { AppData, LoadResult } from './recordCodec';

export interface TimerPort {
  readonly isNativePlatform: boolean;
  getState(): Promise<LiveState>;
  startCycle(options: { cycleId: string; sleepAtMs: number; wakeAtMs: number }): Promise<LiveState>;
  lap(options: { note?: string }): Promise<LiveState>;
  restartSession(): Promise<LiveState>;
  setNote(options: { segmentId: string; note: string }): Promise<LiveState>;
  setSegmentDetails(options: {
    segmentId: string;
    note: string;
    category: SegmentCategory;
  }): Promise<LiveState>;
  mergeSegments(options: {
    firstId: string;
    secondId: string;
    category: SegmentCategory;
  }): Promise<LiveState>;
  splitSegment(options: SplitInput & { cycleId: string; segmentId: string }): Promise<LiveState>;
  startNap(): Promise<LiveState>;
  endNap(): Promise<LiveState>;
  endSession(): Promise<LiveState>;
  closeCycle(): Promise<LiveState>;
}

export interface DevicePort {
  setNotificationsEnabled(options: { enabled: boolean }): Promise<LiveState>;
  requestNotificationPermission(): Promise<void>;
  checkNotificationPermission(): Promise<{ granted: boolean }>;
  openNotificationSettings(): Promise<void>;
  openAppSettings(): Promise<void>;
  getDeviceInfo(): Promise<DeviceInfo>;
}

export interface PdfBlock {
  kind: 'title' | 'h2' | 'row' | 'para';
  text?: string;
  right?: string;
}

export interface RecordStorePort {
  load(): Promise<LoadResult>;
  save(data: AppData): Promise<void>;
}

export interface ClockPort {
  now(): number;
  delay(ms: number): Promise<void>;
}

// Structural inputs keep browser File/Blob out of the application boundary.
export interface ScreenshotInput {
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface RestoreFileInput {
  text(): Promise<string>;
}
export interface FilePort {
  saveScreenshot(file: ScreenshotInput, cycleId: string): Promise<string>;
  screenshotUrl(path: string): Promise<string | null>;
  shareTextFile(filename: string, text: string): Promise<void>;
  exportPdf(options: {
    filename: string;
    blocks: PdfBlock[];
    share?: boolean;
  }): Promise<{ path: string; size: number }>;
}
export type FeedbackKind = 'tick' | 'detent' | 'lap' | 'merge' | 'split';
export interface FeedbackPrefs {
  hapticsEnabled: boolean;
  soundEnabled: boolean;
}
export interface FeedbackPort {
  play(prefs: FeedbackPrefs, kind: FeedbackKind): void;
}
export interface ApplicationDeps {
  store: RecordStorePort;
  timer: TimerPort;
  device: DevicePort;
  clock: ClockPort;
  files: FilePort;
  feedback: FeedbackPort;
}
