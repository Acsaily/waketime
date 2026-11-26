import type { CategoryId } from '../../classification/index';

export interface Segment {
  /** 旧备份缺省时按未分类读取，不根据备注猜测。 */
  category?: CategoryId;
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

export interface TimerSession {
  id: string;
  status: 'running' | 'ended';
  startedAtMs: number;
  segments: Segment[];
}

export interface SleepMetrics {
  score: number | null;
  reportedTotalMs: number | null;
  note: string | null;
}

export interface Cycle {
  id: string;
  timeZone: string;
  sleepAtMs: number;
  wakeAtMs: number;
  sleepDurationMs: number;
  awakeBudgetMs: number;
  targetAtMs: number;
  sleepMetrics: SleepMetrics;
  screenshotPath: string | null;
  source: 'manual' | 'ocr' | 'backfill';
  session: TimerSession | null;
  closedAtMs: number | null;
  flags: string[];
  createdAtMs: number;
  updatedAtMs: number;
}
