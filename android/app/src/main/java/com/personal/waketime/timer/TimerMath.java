package com.personal.waketime.timer;

/**
 * 纯时间计算，不依赖 Android，方便 JVM 单测。
 * 约定：targetAt = 入睡时刻 + 24h（等价于醒来时刻 + 清醒预算）。
 */
public final class TimerMath {
    public static final long DAY_MS = 86_400_000L;

    private TimerMath() {}

    public static long targetAt(long sleepAtMs) {
        return sleepAtMs + DAY_MS;
    }

    public static long budgetMs(long sleepDurationMs) {
        return Math.max(0L, DAY_MS - Math.max(0L, sleepDurationMs));
    }

    /** 正数=剩余，负数=已超出。 */
    public static long remainingMs(long targetAtMs, long nowMs) {
        return targetAtMs - nowMs;
    }

    /** 在 wake..now 范围内累计补觉，旧备注从不参与分类推断。 */
    public static long napMs(TimerState state, long nowMs) {
        long total = 0L;
        for (TimerState.Segment segment : state.segments) {
            if (!TimerState.CATEGORY_SLEEP.equals(segment.category)) continue;
            long start = Math.max(state.wakeAtMs, segment.startAtMs);
            long end = Math.min(nowMs, segment.isOpen() ? nowMs : segment.endAtMs);
            total += Math.max(0L, end - start);
        }
        return Math.min(Math.max(0L, nowMs - state.wakeAtMs), total);
    }

    /** 实际清醒包含暂停空档，但排除补觉；补觉不会挪动 targetAt。 */
    public static long awakeMs(TimerState state, long nowMs) {
        return Math.max(0L, nowMs - state.wakeAtMs - napMs(state, nowMs));
    }

    public static long totalSleepMs(TimerState state, long nowMs) {
        return Math.max(0L, state.wakeAtMs - state.sleepAtMs) + napMs(state, nowMs);
    }

    /** 墙钟走了 60 分钟、单调钟只走了 0 分钟 → 系统时间被改过。 */
    public static boolean detectClockAnomaly(long wallDeltaMs, long monoDeltaMs) {
        return Math.abs(wallDeltaMs - monoDeltaMs) > 5_000L;
    }
}
