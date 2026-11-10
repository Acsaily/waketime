package com.personal.waketime.timer;

import java.util.UUID;

/**
 * 计时状态的唯一真相来源。通知栏动作（没有 WebView 时）也走这里。
 * 所有变更先在副本校验、同步落盘，再发布，失败不会留下半次内存变更。
 */
public class TimerRepository {

    public interface KeyValueStore {
        String get(String key, String defValue);
        void put(String key, String value);
    }

    public interface Clock {
        long wallMs();
        long monoMs();
        String bootId();
    }

    private static final String KEY_STATE = "timer_state_v1";
    private final KeyValueStore store;
    private final Clock clock;
    private TimerState state;

    public TimerRepository(KeyValueStore store, Clock clock) {
        this.store = store;
        this.clock = clock;
        TimerState loaded = TimerState.fromJson(store.get(KEY_STATE, null));
        state = loaded != null ? loaded : new TimerState();
        detectClockAnomaly();
        boolean repaired = state.repairWakeGap();
        if (!state.cycleId.isEmpty() && state.targetAtMs != TimerMath.targetAt(state.sleepAtMs)) {
            state.targetAtMs = TimerMath.targetAt(state.sleepAtMs);
            repaired = true;
        }
        if (repaired) commit(state, clock.wallMs(), clock.monoMs());
    }

    public synchronized TimerState getState() {
        detectClockAnomaly();
        return state;
    }

    public synchronized TimerState startCycle(String cycleId, long sleepAtMs, long wakeAtMs) {
        long now = clock.wallMs();
        long mono = clock.monoMs();
        if (cycleId == null || cycleId.trim().isEmpty()) throw new IllegalArgumentException("缺少 cycleId");
        if (sleepAtMs <= 0L || wakeAtMs <= sleepAtMs || wakeAtMs > now) {
            throw new IllegalArgumentException("睡眠起止时间不合法，起床时间不能晚于现在");
        }
        TimerState s = new TimerState();
        s.cycleId = cycleId;
        s.sleepAtMs = sleepAtMs;
        s.wakeAtMs = wakeAtMs;
        s.targetAtMs = TimerMath.targetAt(sleepAtMs);
        s.status = TimerState.STATUS_RUNNING;
        s.sessionId = UUID.randomUUID().toString();
        s.sessionStartedAtMs = now;
        s.sessionStartedMonoMs = mono;
        s.bootId = clock.bootId();
        s.notificationsEnabled = state.notificationsEnabled;
        // 首段从实际起床开始；早于本次开机则没有可信的单调钟起点。
        long wakeMono = mono - (now - wakeAtMs);
        s.segments.add(newSegment(wakeAtMs, Math.max(0L, wakeMono), TimerState.CATEGORY_UNCLASSIFIED));
        commit(s, now, mono);
        return state;
    }

    /** 计次的备注属于刚结束的段；补觉中必须显式结束补觉。 */
    public synchronized TimerState lap(String note, String source) {
        TimerState s = runningCopy();
        if (s.isNapping()) throw new IllegalStateException("补觉中不能计次，请先结束补觉");
        TimerState.Segment current = requireOpen(s);
        long now = clock.wallMs();
        long mono = clock.monoMs();
        long boundary = boundaryAt(s, current, now, mono);
        if (boundary == current.startAtMs) return state;
        close(current, boundary, mono);
        if (note != null && !note.isEmpty()) current.note = note;
        current.source = source == null ? "app" : source;
        s.segments.add(newSegment(boundary, mono, TimerState.CATEGORY_UNCLASSIFIED));
        s.bootId = clock.bootId();
        commit(s, now, mono);
        return state;
    }

    public synchronized TimerState setNote(String segmentId, String note) {
        TimerState s = copy();
        find(s, segmentId).note = note == null ? "" : note;
        commit(s, clock.wallMs(), clock.monoMs());
        return state;
    }

    public synchronized TimerState setSegmentDetails(String segmentId, String note, String category) {
        requireCategory(category);
        TimerState s = copy();
        TimerState.Segment segment = find(s, segmentId);
        requireOpenCategoryUnchanged(segment, category);
        segment.note = note == null ? "" : note;
        segment.category = category;
        commit(s, clock.wallMs(), clock.monoMs());
        return state;
    }

    /** 只合并有序、相邻、连续的两段；第二段可开放，结果保留其开放状态。 */
    public synchronized TimerState mergeSegments(String firstId, String secondId, String category) {
        requireCategory(category);
        TimerState s = copy();
        TimerState.Segment first = find(s, firstId);
        TimerState.Segment second = find(s, secondId);
        int index = s.segments.indexOf(first);
        if (first == second || index + 1 >= s.segments.size() || s.segments.get(index + 1) != second) {
            throw new IllegalArgumentException("只能按先后顺序合并相邻段");
        }
        if (first.isOpen() || first.endAtMs != second.startAtMs
                || first.endAtMs < first.startAtMs
                || (!second.isOpen() && second.endAtMs < second.startAtMs)) {
            throw new IllegalArgumentException("只能合并连续段，不能跨越暂停空档");
        }
        if (second.isOpen() && (!TimerState.STATUS_RUNNING.equals(s.status) || s.openSegment() != second)) {
            throw new IllegalStateException("开放段状态不合法");
        }
        requireOpenCategoryUnchanged(second, category);
        if (second.isOpen()) {
            // 开放段的计时锚点必须沿用第二段所在的开机时钟，而非第一段的旧锚点。
            long mergedMono = second.startMonoMs - (second.startAtMs - first.startAtMs);
            first.startMonoMs = second.startMonoMs > 0L ? Math.max(0L, mergedMono) : 0L;
        }
        first.endAtMs = second.endAtMs;
        first.endMonoMs = second.endMonoMs;
        first.note = mergeNotes(first.note, second.note);
        first.category = category;
        s.segments.remove(index + 1);
        commit(s, clock.wallMs(), clock.monoMs());
        return state;
    }

    /** 在副本上一次补齐多个分界点，陈旧快照和并发通知动作不得互相覆盖。 */
    public synchronized TimerState splitSegment(String cycleId, String segmentId, TimerState.Segment expected,
            long[] cuts, String[] categories, String[] notes) {
        TimerState s = copy();
        if (!s.cycleId.equals(cycleId) || TimerState.STATUS_IDLE.equals(s.status)) {
            throw new IllegalStateException("活动周期已变化，请重新打开记录");
        }
        TimerState.Segment target = find(s, segmentId);
        if (expected == null || !target.id.equals(expected.id) || target.startAtMs != expected.startAtMs
                || target.endAtMs != expected.endAtMs || !target.note.equals(expected.note)
                || !target.category.equals(expected.category)) {
            throw new IllegalStateException("这一段已发生变化，请关闭后重新打开，避免覆盖新记录");
        }
        long now = clock.wallMs();
        long mono = clock.monoMs();
        boolean open = target.isOpen();
        if (open && (!TimerState.STATUS_RUNNING.equals(s.status) || s.openSegment() != target)) {
            throw new IllegalStateException("进行中段状态不合法");
        }
        if (open && TimerState.CATEGORY_SLEEP.equals(target.category)) {
            throw new IllegalStateException("请先结束补觉，再拆分这一段");
        }
        long end = open ? boundaryAt(s, target, now, mono) : target.endAtMs;
        if (target.startAtMs < s.wakeAtMs || end <= target.startAtMs || (!open && end > now)) {
            throw new IllegalArgumentException("原段时间异常，暂时不能拆分");
        }
        for (TimerState.Segment other : s.segments) {
            long otherEnd = other.isOpen() ? boundaryAt(s, other, now, mono) : other.endAtMs;
            if (other != target && other.startAtMs < end && otherEnd > target.startAtMs) {
                throw new IllegalArgumentException("原段与其他记录重叠，请先核对时间轴");
            }
        }
        if (cuts == null || cuts.length == 0 || categories == null || notes == null
                || categories.length != cuts.length + 1 || notes.length != categories.length) {
            throw new IllegalArgumentException("请添加分界点并填写每段分类与备注");
        }
        long previous = target.startAtMs;
        for (long cut : cuts) {
            if (cut <= previous || cut >= end) throw new IllegalArgumentException("分界点必须在原段内部，递增且不能重复");
            previous = cut;
        }
        for (int i = 0; i < categories.length; i++) {
            requireCategory(categories[i]);
            if (notes[i] == null) throw new IllegalArgumentException("缺少子段备注");
        }
        if (open && TimerState.CATEGORY_SLEEP.equals(categories[categories.length - 1])) {
            throw new IllegalArgumentException("进行中尾段不能改为补觉，请使用开始补觉");
        }
        int index = s.segments.indexOf(target);
        java.util.List<TimerState.Segment> replacements = new java.util.ArrayList<>();
        // 开放尾段用当前开机的锚点重建；早于本次开机的边界使用 0（墙上时间兜底）。
        boolean closedAnchorValid = target.startMonoMs > 0L && target.endMonoMs > 0L
                && target.endMonoMs - target.startMonoMs == target.endAtMs - target.startAtMs;
        for (int i = 0; i < categories.length; i++) {
            long start = i == 0 ? target.startAtMs : cuts[i - 1];
            long stop = i < cuts.length ? cuts[i] : target.endAtMs;
            long startMono = open ? Math.max(0L, mono - (end - start))
                    : closedAnchorValid ? target.startMonoMs + (start - target.startAtMs) : 0L;
            TimerState.Segment part = newSegment(start, startMono, categories[i]);
            if (i == 0) part.id = target.id;
            part.endAtMs = stop;
            part.endMonoMs = stop == 0L ? 0L : open ? Math.max(0L, mono - (end - stop))
                    : closedAnchorValid ? target.startMonoMs + (stop - target.startAtMs) : 0L;
            part.note = notes[i];
            part.source = target.source;
            part.splitFromId = target.splitFromId.isEmpty() ? target.id : target.splitFromId;
            replacements.add(part);
        }
        s.segments.remove(index);
        s.segments.addAll(index, replacements);
        if (open) s.bootId = clock.bootId();
        commit(s, now, mono);
        return state;
    }

    public synchronized TimerState startNap() {
        TimerState s = runningCopy();
        if (s.isNapping()) throw new IllegalStateException("已经在补觉中");
        return switchCategory(s, TimerState.CATEGORY_SLEEP);
    }

    public synchronized TimerState endNap() {
        TimerState s = runningCopy();
        if (!s.isNapping()) throw new IllegalStateException("当前不在补觉中");
        return switchCategory(s, TimerState.CATEGORY_UNCLASSIFIED);
    }

    private TimerState switchCategory(TimerState s, String category) {
        long now = clock.wallMs();
        long mono = clock.monoMs();
        TimerState.Segment current = requireOpen(s);
        long boundary = boundaryAt(s, current, now, mono);
        close(current, boundary, mono);
        s.segments.add(newSegment(boundary, mono, category));
        s.bootId = clock.bootId();
        commit(s, now, mono);
        return state;
    }

    /** 结束本次计时：补觉中的开放睡眠段也正常封口。 */
    public synchronized TimerState endSession() {
        detectClockAnomaly();
        if (!TimerState.STATUS_RUNNING.equals(state.status)) return state;
        TimerState s = copy();
        long now = clock.wallMs();
        long mono = clock.monoMs();
        TimerState.Segment current = requireOpen(s);
        close(current, boundaryAt(s, current, now, mono), mono);
        s.status = TimerState.STATUS_ENDED;
        commit(s, now, mono);
        return state;
    }

    /** 当天重新开始：保留暂停空档，不默认延续补觉。 */
    public synchronized TimerState restartSession() {
        detectClockAnomaly();
        if (!TimerState.STATUS_ENDED.equals(state.status)) throw new IllegalStateException("当前计时尚未结束");
        TimerState s = copy();
        long now = clock.wallMs();
        long mono = clock.monoMs();
        if (!s.segments.isEmpty() && now < s.segments.get(s.segments.size() - 1).endAtMs) {
            throw new IllegalStateException("系统时间早于上一段结束，请校正系统时间后重试");
        }
        s.status = TimerState.STATUS_RUNNING;
        s.sessionId = UUID.randomUUID().toString();
        s.sessionStartedAtMs = now;
        s.sessionStartedMonoMs = mono;
        s.bootId = clock.bootId();
        s.segments.add(newSegment(now, mono, TimerState.CATEGORY_UNCLASSIFIED));
        commit(s, now, mono);
        return state;
    }

    /** JS 先取得 ended 状态归档，再清除原生活动周期。 */
    public synchronized TimerState closeCycle() {
        endSession();
        TimerState cleared = new TimerState();
        cleared.notificationsEnabled = state.notificationsEnabled;
        commit(cleared, clock.wallMs(), clock.monoMs());
        return state;
    }

    public synchronized TimerState setNotificationsEnabled(boolean enabled) {
        TimerState s = copy();
        s.notificationsEnabled = enabled;
        commit(s, clock.wallMs(), clock.monoMs());
        return state;
    }

    private TimerState copy() {
        detectClockAnomaly();
        return TimerState.fromJson(state.toJson());
    }

    private TimerState runningCopy() {
        TimerState s = copy();
        if (!TimerState.STATUS_RUNNING.equals(s.status)) throw new IllegalStateException("当前没有正在进行的计时");
        return s;
    }

    private static TimerState.Segment find(TimerState s, String id) {
        if (id == null || id.isEmpty()) throw new IllegalArgumentException("缺少 segmentId");
        for (TimerState.Segment segment : s.segments) if (id.equals(segment.id)) return segment;
        throw new IllegalArgumentException("找不到该计时段，请刷新后重试");
    }

    private static TimerState.Segment requireOpen(TimerState s) {
        TimerState.Segment current = s.openSegment();
        if (current == null) throw new IllegalStateException("找不到正在进行的计时段");
        return current;
    }

    private static void requireCategory(String category) {
        if (!TimerState.isCategory(category)) throw new IllegalArgumentException("无效的计时段类别");
    }

    private static void requireOpenCategoryUnchanged(TimerState.Segment segment, String category) {
        if (segment.isOpen() && (TimerState.CATEGORY_SLEEP.equals(segment.category)
                != TimerState.CATEGORY_SLEEP.equals(category))) {
            throw new IllegalArgumentException("开放段不能通过编辑切换补觉，请使用开始/结束补觉");
        }
    }

    static String mergeNotes(String first, String second) {
        String a = first == null ? "" : first;
        String b = second == null ? "" : second;
        // 仅去掉完全相同的整条备注，不能误删多行备注中有意义的重复行。
        if (a.isEmpty()) return b;
        if (b.isEmpty() || a.equals(b)) return a;
        return a + "\n" + b;
    }

    private static TimerState.Segment newSegment(long wall, long mono, String category) {
        TimerState.Segment segment = new TimerState.Segment();
        segment.id = UUID.randomUUID().toString();
        segment.startAtMs = wall;
        segment.startMonoMs = mono;
        segment.category = category;
        return segment;
    }

    private long boundaryAt(TimerState s, TimerState.Segment current, long now, long mono) {
        if (s.bootId.equals(clock.bootId()) && current.startMonoMs > 0L && mono >= current.startMonoMs) {
            return current.startAtMs + (mono - current.startMonoMs);
        }
        return Math.max(current.startAtMs, now);
    }

    private static void close(TimerState.Segment segment, long wall, long mono) {
        segment.endAtMs = wall;
        segment.endMonoMs = mono;
    }

    private void commit(TimerState s, long now, long mono) {
        s.renumberSegments();
        s.lastWallMs = now;
        s.lastMonoMs = mono;
        store.put(KEY_STATE, s.toJson());
        state = s;
    }

    private void detectClockAnomaly() {
        if (state.lastWallMs <= 0L || state.lastMonoMs <= 0L) return;
        if (!state.bootId.isEmpty() && !state.bootId.equals(clock.bootId())) {
            // 重启后 elapsedRealtime 重置，不拿不同开机的时钟作比较。
            return;
        }
        long wallDelta = clock.wallMs() - state.lastWallMs;
        long monoDelta = clock.monoMs() - state.lastMonoMs;
        if (TimerMath.detectClockAnomaly(wallDelta, monoDelta)) state.clockAnomaly = true;
    }
}
