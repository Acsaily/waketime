import { PRE_SLEEP_CATEGORY } from '../../classification/index';
import type { Cycle } from './model';
import { categoryOf, repairWakeGap, sanitizeSegments } from './segments';

/** 旧数据自愈：把一天里所有段洗干净 */
export function sanitizeCycle(cycle: Cycle): Cycle {
  if (!cycle.session) return cycle;
  const segments = repairWakeGap(
    sanitizeSegments(cycle.session.segments ?? []),
    cycle.wakeAtMs,
    cycle.id,
  );
  // 数量没变也可能顺序/内容变了，这里统一返回新对象，保证调用方拿到干净数据
  return { ...cycle, session: { ...cycle.session, segments } };
}

/** 新周期开始时封口旧周期，且只给最后的未分类开放尾段标记睡前时间。 */
export function closeForNextSleep(c: Cycle, sleepAtMs: number, nowMs: number): Cycle {
  if (c.closedAtMs !== null || c.wakeAtMs >= sleepAtMs) return c;
  const source = c.session?.segments ?? [];
  const openTailId = source
    .filter((s) => s.endAtMs === 0)
    .sort((a, b) => b.startAtMs - a.startAtMs)[0]?.id;
  const segs = source.map((s) => {
    if (s.endAtMs !== 0) return { ...s };
    const endAtMs = Math.max(s.startAtMs, sleepAtMs);
    const bedtime =
      s.id === openTailId && categoryOf(s) === 'unclassified' && endAtMs > s.startAtMs;
    return { ...s, endAtMs, category: bedtime ? PRE_SLEEP_CATEGORY : s.category };
  });
  return {
    ...c,
    closedAtMs: sleepAtMs,
    session: c.session ? { ...c.session, status: 'ended' as const, segments: segs } : null,
    updatedAtMs: nowMs,
  };
}
