// 原生侧（Java）返回的数据形状
/** 稳定类别 ID；名称和停用状态保存在设置目录中。sleep / unclassified 为保留 ID。 */
export type SegmentCategory = string;
export interface TimerSegment {
  /** 旧备份缺省时按未分类读取，不根据备注猜测。 */
  category?: SegmentCategory;
  id: string;
  seq: number;
  startAtMs: number;
  /** 0 = 这一段还没结束 */
  endAtMs: number;
  note: string;
  /** 手动拆分的最初来源段，保留 source 原有的 app/notification 语义。 */
  splitFromId?: string;
  source: 'app' | 'notification';
}

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
