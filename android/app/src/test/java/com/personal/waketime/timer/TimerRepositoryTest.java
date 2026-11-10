package com.personal.waketime.timer;

import org.junit.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public class TimerRepositoryTest {

    private static final class MemStore implements TimerRepository.KeyValueStore {
        final Map<String, String> map = new HashMap<>();
        boolean failWrites;

        @Override
        public String get(String key, String defValue) {
            return map.containsKey(key) ? map.get(key) : defValue;
        }

        @Override
        public void put(String key, String value) {
            if (failWrites) throw new IllegalStateException("模拟写入失败");
            map.put(key, value);
        }
    }

    private static final class FakeClock implements TimerRepository.Clock {
        long wall = 1_790_000_000_000L;
        long mono = 12 * 3_600_000L;
        String boot = "boot-1";

        @Override
        public long wallMs() {
            return wall;
        }

        @Override
        public long monoMs() {
            return mono;
        }

        @Override
        public String bootId() {
            return boot;
        }

        void advance(long ms) {
            wall += ms;
            mono += ms;
        }
    }

    private static long at(String hhmm) {
        // 2026-10-25 的 HH:mm（本地时区由测试进程决定，这里只做相对比较）
        String[] p = hhmm.split(":");
        return 1_790_000_000_000L + Long.parseLong(p[0]) * 3_600_000L + Long.parseLong(p[1]) * 60_000L;
    }

    @Test
    public void startCycleCreatesRunningSessionAndTarget() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        long sleep = clock.wall - 8 * 3_600_000L;
        long wake = clock.wall - 30 * 60_000L;
        TimerState s = repo.startCycle("2026-10-26", sleep, wake);

        assertEquals(TimerState.STATUS_RUNNING, s.status);
        assertEquals(sleep + TimerMath.DAY_MS, s.targetAtMs);
        assertEquals(1, s.segments.size());
        assertTrue(s.segments.get(0).isOpen());
        assertEquals(1, s.segments.get(0).seq);
        assertEquals(wake, s.segments.get(0).startAtMs);
        assertEquals(clock.mono - (clock.wall - wake), s.segments.get(0).startMonoMs);
        assertEquals(TimerState.CATEGORY_UNCLASSIFIED, s.segments.get(0).category);
    }

    @Test
    public void lapClosesCurrentSegmentAndOpensNext() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        repo.startCycle("2026-10-26", clock.wall - 8 * 3_600_000L, clock.wall);

        clock.advance(30 * 60_000L);
        TimerState s = repo.lap("写方案", "app");

        assertEquals(2, s.segments.size());
        assertFalse(s.segments.get(0).isOpen());
        assertEquals("写方案", s.segments.get(0).note);
        assertTrue(s.segments.get(1).isOpen());
        assertEquals(s.segments.get(0).endAtMs, s.segments.get(1).startAtMs);
        assertEquals(1, s.closedCount());
    }

    @Test
    public void repeatedLapAtSameInstantIsIgnored() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        repo.startCycle("2026-10-26", clock.wall - 8 * 3_600_000L, clock.wall);

        clock.advance(5_000L);
        repo.lap("", "app");
        TimerState s = repo.lap("", "app");
        assertEquals(2, s.segments.size());
        assertEquals(1, s.closedCount());
    }

    @Test
    public void setNoteUpdatesSegment() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        repo.startCycle("2026-10-26", clock.wall - 8 * 3_600_000L, clock.wall);
        clock.advance(60_000L);
        TimerState s = repo.lap("", "app");
        String id = s.segments.get(0).id;

        TimerState updated = repo.setNote(id, "改过的备注");
        assertEquals("改过的备注", updated.segments.get(0).note);
    }

    @Test
    public void stateSurvivesSerializationRoundTrip() {
        MemStore store = new MemStore();
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        repo.startCycle("2026-10-26", clock.wall - 8 * 3_600_000L, clock.wall);
        clock.advance(90 * 60_000L);
        repo.lap("写方案", "notification");

        TimerRepository reopened = new TimerRepository(store, clock);
        TimerState s = reopened.getState();
        assertEquals("2026-10-26", s.cycleId);
        assertEquals(2, s.segments.size());
        assertEquals("写方案", s.segments.get(0).note);
        assertEquals("notification", s.segments.get(0).source);
        assertEquals(2, s.segments.get(1).seq);
    }

    @Test
    public void clockAnomalyDetectedWhenWallJumpsButMonoDoesNot() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        repo.startCycle("2026-10-26", clock.wall - 8 * 3_600_000L, clock.wall);

        clock.wall += 3_600_000L; // 手改系统时间 +1h，单调钟没动
        assertTrue(repo.getState().clockAnomaly);
    }

    @Test
    public void normalTimePassingIsNotAnomaly() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        repo.startCycle("2026-10-26", clock.wall - 8 * 3_600_000L, clock.wall);
        clock.advance(3_600_000L);
        assertFalse(repo.getState().clockAnomaly);
    }

    @Test
    public void endSessionThenRestartKeepsSegments() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        repo.startCycle("2026-10-26", clock.wall - 8 * 3_600_000L, clock.wall);
        clock.advance(10 * 60_000L);
        repo.lap("a", "app");
        clock.advance(10 * 60_000L);

        TimerState ended = repo.endSession();
        assertEquals(TimerState.STATUS_ENDED, ended.status);
        assertEquals(2, ended.closedCount());

        clock.advance(60 * 60_000L);
        TimerState restarted = repo.restartSession();
        assertEquals(TimerState.STATUS_RUNNING, restarted.status);
        assertEquals(3, restarted.segments.size());
        assertTrue(restarted.segments.get(2).isOpen());
        assertEquals(2, restarted.closedCount());
    }

    @Test
    public void remainingTimeIsNegativeAfterTarget() {
        long target = at("23:30") + TimerMath.DAY_MS;
        assertEquals(-15 * 60_000L, TimerMath.remainingMs(target, target + 15 * 60_000L));
        assertTrue(TimerMath.remainingMs(target, target - 60_000L) > 0);
    }

    private static void expectFailure(Runnable action) {
        try {
            action.run();
        } catch (IllegalArgumentException | IllegalStateException expected) {
            return;
        }
        throw new AssertionError("预期操作应拒绝");
    }

    @Test
    public void legacyWakeGapIsSeparatePersistedAndIdempotent() {
        MemStore store = new MemStore();
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        long wake = clock.wall - 30 * 60_000L;
        TimerState legacy = repo.startCycle("legacy", wake - 8 * 3_600_000L, wake);
        TimerState.Segment original = legacy.segments.get(0);
        original.startAtMs = clock.wall; // 模拟旧版从保存时间开首段
        original.startMonoMs = clock.mono;
        original.note = "原有工作备注";
        original.category = TimerState.CATEGORY_WORK;
        String originalId = original.id;
        store.put("timer_state_v1", legacy.toJson());

        TimerRepository reopened = new TimerRepository(store, clock);
        TimerState repaired = reopened.getState();
        assertEquals(2, repaired.segments.size());
        TimerState.Segment gap = repaired.segments.get(0);
        assertEquals("legacy:wake-gap", gap.id);
        assertEquals(wake, gap.startAtMs);
        assertEquals(clock.wall, gap.endAtMs);
        assertEquals("起床后未记录（补齐）", gap.note);
        assertEquals("app", gap.source);
        assertEquals(TimerState.CATEGORY_UNCLASSIFIED, gap.category);
        assertEquals(originalId, repaired.segments.get(1).id);
        assertEquals("原有工作备注", repaired.segments.get(1).note);
        assertEquals(TimerState.CATEGORY_WORK, repaired.segments.get(1).category);
        assertEquals(clock.wall, repaired.segments.get(1).startAtMs);
        assertEquals(2, repaired.segments.get(1).seq);
        assertEquals(2, new TimerRepository(store, clock).getState().segments.size());
        assertEquals(2, TimerState.fromJson(store.get("timer_state_v1", "")).segments.size());
    }

    @Test
    public void missingCategoryDefaultsButCustomCategorySurvives() {
        TimerState old = TimerState.fromJson("{\"segments\":[{\"id\":\"a\",\"note\":\"午睡补觉\"},"
                + "{\"id\":\"b\",\"category\":\"other\"}]}");
        assertNotNull(old);
        assertEquals(TimerState.CATEGORY_UNCLASSIFIED, old.segments.get(0).category);
        assertEquals("other", old.segments.get(1).category);
        assertEquals(TimerState.CATEGORY_UNCLASSIFIED,
                TimerState.fromJson(old.toJson()).segments.get(0).category);
    }

    @Test
    public void detailsEditClosedAndAwakeOpenSegmentsAndPersist() {
        MemStore store = new MemStore();
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        TimerState started = repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        String first = started.openSegment().id;
        repo.setSegmentDetails(first, "开放段备注", TimerState.CATEGORY_DAILY);
        clock.advance(1_000L);
        repo.lap("", "app");
        assertEquals("开放段备注", repo.getState().segments.get(0).note);
        repo.setSegmentDetails(first, "事后补觉", TimerState.CATEGORY_SLEEP);
        TimerState reopened = new TimerRepository(store, clock).getState();
        assertEquals(TimerState.CATEGORY_SLEEP, reopened.segments.get(0).category);
        assertEquals("事后补觉", reopened.segments.get(0).note);
        assertEquals(TimerState.CATEGORY_UNCLASSIFIED, reopened.openSegment().category);
    }

    @Test
    public void detailsRejectInvalidIdsCategoriesAndOpenSleepTransitionsAtomically() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        TimerState started = repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        String openId = started.openSegment().id;
        String before = repo.getState().toJson();
        expectFailure(() -> repo.setSegmentDetails(openId, "不能写入", TimerState.CATEGORY_SLEEP));
        expectFailure(() -> repo.setSegmentDetails(openId, "不能写入", "invalid id"));
        expectFailure(() -> repo.setSegmentDetails("missing", "", TimerState.CATEGORY_DAILY));
        expectFailure(() -> repo.setNote("missing", ""));
        assertEquals(before, repo.getState().toJson());
        clock.advance(1_000L);
        TimerState nap = repo.startNap();
        String sleepId = nap.openSegment().id;
        expectFailure(() -> repo.setSegmentDetails(sleepId, "", TimerState.CATEGORY_WORK));
        repo.setSegmentDetails(sleepId, "只改备注", TimerState.CATEGORY_SLEEP);
        assertTrue(repo.getState().isNapping());
        assertEquals("只改备注", repo.getState().openSegment().note);
    }

    @Test
    public void mergeKeepsNotesExplicitCategoryBoundariesAndSequence() {
        MemStore store = new MemStore();
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        long start = clock.wall;
        clock.advance(1_000L);
        repo.lap("共同\n第一段", "app");
        clock.advance(2_000L);
        TimerState three = repo.lap("共同\n第二段", "notification");
        String firstId = three.segments.get(0).id;
        String secondId = three.segments.get(1).id;
        String openId = three.openSegment().id;
        repo.setSegmentDetails(firstId, three.segments.get(0).note, TimerState.CATEGORY_WORK);
        repo.setSegmentDetails(secondId, three.segments.get(1).note, TimerState.CATEGORY_DAILY);
        TimerState merged = repo.mergeSegments(firstId, secondId, TimerState.CATEGORY_SLEEP);
        assertEquals(2, merged.segments.size());
        assertEquals(firstId, merged.segments.get(0).id);
        assertEquals(start, merged.segments.get(0).startAtMs);
        assertEquals(clock.wall, merged.segments.get(0).endAtMs);
        assertEquals("共同\n第一段\n共同\n第二段", merged.segments.get(0).note);
        assertEquals(TimerState.CATEGORY_SLEEP, merged.segments.get(0).category);
        assertEquals(openId, merged.openSegment().id);
        assertEquals(2, merged.openSegment().seq);
        assertEquals(2, new TimerRepository(store, clock).getState().segments.size());
    }

    @Test
    public void mergeSecondOpenPreservesRunningStateAndMonotonicBoundary() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        TimerState first = repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        long start = clock.wall;
        long startMono = clock.mono;
        clock.advance(1_000L);
        TimerState two = repo.lap("第一段", "app");
        String secondId = two.openSegment().id;
        repo.setNote(secondId, "第二段");
        TimerState merged = repo.mergeSegments(first.openSegment().id, secondId, TimerState.CATEGORY_WORK);
        assertEquals(TimerState.STATUS_RUNNING, merged.status);
        assertEquals(1, merged.segments.size());
        assertTrue(merged.openSegment().isOpen());
        assertEquals(startMono, merged.openSegment().startMonoMs);
        assertEquals("第一段\n第二段", merged.openSegment().note);
        clock.advance(2_000L);
        TimerState split = repo.lap("", "app");
        assertEquals(start, split.segments.get(0).startAtMs);
        assertEquals(start + 3_000L, split.segments.get(0).endAtMs);
        assertEquals(split.segments.get(0).endAtMs, split.openSegment().startAtMs);
    }

    @Test
    public void mergeRejectsNonAdjacentReversedOpenFirstAndMissingCategory() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        clock.advance(1_000L);
        repo.lap("a", "app");
        clock.advance(1_000L);
        TimerState three = repo.lap("b", "app");
        String a = three.segments.get(0).id;
        String b = three.segments.get(1).id;
        String c = three.segments.get(2).id;
        String before = three.toJson();
        expectFailure(() -> repo.mergeSegments(a, c, TimerState.CATEGORY_WORK));
        expectFailure(() -> repo.mergeSegments(b, a, TimerState.CATEGORY_WORK));
        expectFailure(() -> repo.mergeSegments(c, c, TimerState.CATEGORY_WORK));
        expectFailure(() -> repo.mergeSegments(a, b, null));
        expectFailure(() -> repo.mergeSegments(a, "missing", TimerState.CATEGORY_WORK));
        assertEquals(before, repo.getState().toJson());
    }

    @Test
    public void mergeCannotCrossPauseGap() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        TimerState started = repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        String firstId = started.openSegment().id;
        clock.advance(1_000L);
        repo.endSession();
        clock.advance(1_000L);
        TimerState resumed = repo.restartSession();
        String secondId = resumed.openSegment().id;
        expectFailure(() -> repo.mergeSegments(firstId, secondId, TimerState.CATEGORY_DAILY));
        assertEquals(2, repo.getState().segments.size());
    }

    @Test
    public void mergeCannotReclassifyOpenAwakeOrNapAcrossSleepBoundary() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        clock.advance(1_000L);
        TimerState napping = repo.startNap();
        String awakeId = napping.segments.get(0).id;
        String sleepId = napping.openSegment().id;
        expectFailure(() -> repo.mergeSegments(awakeId, sleepId, TimerState.CATEGORY_DAILY));
        clock.advance(1_000L);
        TimerState awake = repo.endNap();
        expectFailure(() -> repo.mergeSegments(sleepId, awake.openSegment().id, TimerState.CATEGORY_SLEEP));
        assertFalse(repo.getState().isNapping());
    }

    @Test
    public void realTimeNapExcludesAwakeStopsLapAndKeepsReferenceFixed() {
        MemStore store = new MemStore();
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        TimerState initial = repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        long target = initial.targetAtMs;
        String session = initial.sessionId;
        clock.advance(5 * 60_000L);
        TimerState napping = repo.startNap();
        assertTrue(napping.isNapping());
        assertEquals(2, napping.segments.size());
        assertEquals(napping.segments.get(0).endAtMs, napping.openSegment().startAtMs);
        assertEquals(1, napping.closedCount());
        String beforeRejected = napping.toJson();
        expectFailure(() -> repo.lap("误按", "notification"));
        expectFailure(() -> repo.startNap());
        assertEquals(beforeRejected, repo.getState().toJson());
        clock.advance(10 * 60_000L);
        assertEquals(5 * 60_000L, TimerMath.awakeMs(repo.getState(), clock.wall));
        assertEquals(10 * 60_000L, TimerMath.napMs(repo.getState(), clock.wall));
        assertTrue(new TimerRepository(store, clock).getState().isNapping());
        TimerState awake = repo.endNap();
        assertEquals(TimerState.STATUS_RUNNING, awake.status);
        assertFalse(awake.isNapping());
        assertEquals(session, awake.sessionId);
        assertEquals("c", awake.cycleId);
        assertEquals(target, awake.targetAtMs);
        assertEquals(TimerState.CATEGORY_UNCLASSIFIED, awake.openSegment().category);
        assertEquals(1, awake.closedCount());
        assertEquals(8 * 3_600_000L + 10 * 60_000L, TimerMath.totalSleepMs(awake, clock.wall));
        assertEquals(16 * 3_600_000L - 10 * 60_000L,
                TimerMath.budgetMs(TimerMath.totalSleepMs(awake, clock.wall)));
        clock.advance(2 * 60_000L);
        assertEquals(7 * 60_000L, TimerMath.awakeMs(repo.getState(), clock.wall));
        assertEquals(target - clock.wall, TimerMath.remainingMs(target, clock.wall));
    }

    @Test
    public void napTransitionsRejectOutsideRunningAndWrongMode() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        expectFailure(() -> repo.startNap());
        expectFailure(() -> repo.endNap());
        expectFailure(() -> repo.lap("", "app"));
        repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        expectFailure(() -> repo.endNap());
        clock.advance(1_000L);
        repo.startNap();
        clock.advance(1_000L);
        TimerState ended = repo.endSession();
        assertFalse(ended.isNapping());
        assertNull(ended.openSegment());
        assertEquals(TimerState.CATEGORY_SLEEP, ended.segments.get(1).category);
        assertEquals(1, ended.closedCount());
        expectFailure(() -> repo.startNap());
        expectFailure(() -> repo.endNap());
        clock.advance(1_000L);
        assertEquals(TimerState.CATEGORY_UNCLASSIFIED, repo.restartSession().openSegment().category);
    }

    @Test
    public void awakeIncludesPauseGapsAndClipsSleepToWakeAndNow() {
        TimerState s = new TimerState();
        s.wakeAtMs = 10_000L;
        TimerState.Segment sleep = new TimerState.Segment();
        sleep.category = TimerState.CATEGORY_SLEEP;
        sleep.startAtMs = 5_000L;
        sleep.endAtMs = 15_000L;
        s.segments.add(sleep);
        assertEquals(5_000L, TimerMath.napMs(s, 20_000L));
        assertEquals(5_000L, TimerMath.awakeMs(s, 20_000L));
        assertEquals(0L, TimerMath.awakeMs(s, 12_000L));
        assertEquals(0L, TimerMath.awakeMs(s, 5_000L));
        assertEquals(0L, TimerMath.budgetMs(26 * 3_600_000L));
    }

    @Test
    public void backwardWallJumpKeepsSplitContinuousOnMonotonicClock() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        long start = clock.wall;
        repo.startCycle("c", start - 8 * 3_600_000L, start);
        clock.mono += 60_000L;
        clock.wall -= 3_600_000L;
        TimerState split = repo.lap("", "app");
        assertTrue(split.clockAnomaly);
        assertEquals(start + 60_000L, split.segments.get(0).endAtMs);
        assertEquals(split.segments.get(0).endAtMs, split.openSegment().startAtMs);
        assertEquals(clock.mono, split.openSegment().startMonoMs);
    }

    @Test
    public void rebootDoesNotUsePreviousBootMonotonicAnchor() {
        MemStore store = new MemStore();
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        long start = clock.wall;
        repo.startCycle("c", start - 8 * 3_600_000L, start);
        clock.wall += 60_000L;
        clock.mono = 1_000L;
        clock.boot = "boot-2";
        TimerRepository reopened = new TimerRepository(store, clock);
        TimerState split = reopened.lap("", "app");
        assertFalse(split.clockAnomaly);
        assertEquals(clock.wall, split.segments.get(0).endAtMs);
        assertEquals(clock.mono, split.openSegment().startMonoMs);
        assertEquals("boot-2", split.bootId);
    }

    @Test
    public void storageFailureDoesNotPublishHalfMutation() {
        MemStore store = new MemStore();
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        TimerState started = repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        String before = started.toJson();
        store.failWrites = true;
        clock.advance(1_000L);
        expectFailure(() -> repo.startNap());
        assertEquals(before, repo.getState().toJson());
        expectFailure(() -> repo.setSegmentDetails(started.openSegment().id, "不得半写", TimerState.CATEGORY_WORK));
        assertEquals(before, repo.getState().toJson());
        assertEquals(before, store.get("timer_state_v1", ""));
    }

    @Test
    public void invalidCycleTimesAreRejectedWithoutReplacingCurrentState() {
        FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(new MemStore(), clock);
        expectFailure(() -> repo.startCycle("", clock.wall - 1_000L, clock.wall));
        expectFailure(() -> repo.startCycle("c", clock.wall, clock.wall));
        expectFailure(() -> repo.startCycle("c", clock.wall - 1_000L, clock.wall + 1_000L));
        assertEquals(TimerState.STATUS_IDLE, repo.getState().status);
    }

    private static TimerState.Segment snapshot(TimerState.Segment s) {
        return TimerState.Segment.fromJson(jsonObject(s));
    }

    private static org.json.JSONObject jsonObject(TimerState.Segment s) {
        try { return s.toJson(); } catch (org.json.JSONException e) { throw new AssertionError(e); }
    }

    @Test
    public void customCategorySurvivesSerializationLapAndReopen() {
        MemStore store = new MemStore(); FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        TimerState s = repo.startCycle("c", clock.wall - 8 * 3_600_000L, clock.wall);
        repo.setSegmentDetails(s.openSegment().id, "学习", "cat-study");
        clock.advance(60_000L); repo.lap("", "notification");
        TimerState reopened = new TimerRepository(store, clock).getState();
        assertEquals("cat-study", reopened.segments.get(0).category);
        assertEquals("学习", reopened.segments.get(0).note);
        assertEquals(60_000L, TimerMath.awakeMs(reopened, clock.wall));
    }

    @Test
    public void closedSegmentMultiSplitPreservesExactBoundsNotesAndOrigin() {
        MemStore store = new MemStore(); FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        long start = clock.wall;
        repo.startCycle("c", start - 8 * 3_600_000L, start);
        clock.advance(180_123L); TimerState s = repo.lap("原备注", "notification");
        TimerState.Segment original = snapshot(s.segments.get(0));
        TimerState result = repo.splitSegment("c", original.id, original, new long[]{start + 60_000L, start + 120_000L},
                new String[]{"work", "daily", "cat-study"}, new String[]{"方案", "吃饭", "学习"});
        assertEquals(4, result.segments.size());
        assertEquals(start, result.segments.get(0).startAtMs);
        assertEquals(start + 180_123L, result.segments.get(2).endAtMs);
        assertEquals(original.id, result.segments.get(0).id);
        for (int i = 0; i < 3; i++) {
            assertEquals(original.id, result.segments.get(i).splitFromId);
            assertEquals("notification", result.segments.get(i).source);
            assertEquals(i + 1, result.segments.get(i).seq);
            assertEquals(result.segments.get(i).endAtMs, result.segments.get(i + 1).startAtMs);
        }
        TimerState reopened = new TimerRepository(store, clock).getState();
        assertEquals("cat-study", reopened.segments.get(2).category);
        assertEquals(original.id, reopened.segments.get(2).splitFromId);
        assertEquals(180_123L, TimerMath.awakeMs(reopened, clock.wall));
    }

    @Test
    public void openSplitKeepsTailRunningAndMonotonicAnchorAcrossWallJump() {
        FakeClock clock = new FakeClock(); TimerRepository repo = new TimerRepository(new MemStore(), clock);
        long start = clock.wall; long mono = clock.mono;
        TimerState s = repo.startCycle("c", start - 8 * 3_600_000L, start);
        TimerState.Segment expected = snapshot(s.openSegment());
        clock.advance(180_000L);
        TimerState result = repo.splitSegment("c", expected.id, expected, new long[]{start + 60_000L},
                new String[]{"daily", "cat-study"}, new String[]{"吃饭", "学习中"});
        assertEquals(TimerState.STATUS_RUNNING, result.status);
        assertEquals(mono + 60_000L, result.openSegment().startMonoMs);
        assertEquals(0L, result.openSegment().endAtMs);
        clock.mono += 60_000L; clock.wall -= 3_600_000L;
        TimerState lapped = repo.lap("", "notification");
        assertEquals(start + 240_000L, lapped.segments.get(1).endAtMs);
        assertTrue(lapped.clockAnomaly);
    }

    @Test
    public void openSplitAfterRebootReanchorsToCurrentBoot() {
        MemStore store = new MemStore(); FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock);
        long start = clock.wall; repo.startCycle("c", start - 8 * 3_600_000L, start);
        clock.wall += 180_000L; clock.mono = 100_000L; clock.boot = "boot-2";
        TimerRepository reopened = new TimerRepository(store, clock);
        TimerState.Segment expected = snapshot(reopened.getState().openSegment());
        reopened.splitSegment("c", expected.id, expected, new long[]{start + 120_000L},
                new String[]{"work", "daily"}, new String[]{"", ""});
        assertEquals(40_000L, reopened.getState().openSegment().startMonoMs);
        clock.advance(60_000L);
        assertEquals(start + 240_000L, reopened.lap("", "app").segments.get(1).endAtMs);
    }

    @Test
    public void splitRejectsStaleSnapshotNotificationLapAndCycleChange() {
        FakeClock clock = new FakeClock(); TimerRepository repo = new TimerRepository(new MemStore(), clock);
        long start = clock.wall; TimerState s = repo.startCycle("c", start - 8 * 3_600_000L, start);
        TimerState.Segment expected = snapshot(s.openSegment()); clock.advance(180_000L);
        repo.setNote(expected.id, "新备注");
        expectFailure(() -> repo.splitSegment("c", expected.id, expected, new long[]{start + 60_000L}, new String[]{"work", "daily"}, new String[]{"", ""}));
        TimerState.Segment updated = snapshot(repo.getState().openSegment());
        repo.lap("", "notification"); String before = repo.getState().toJson();
        expectFailure(() -> repo.splitSegment("c", updated.id, updated, new long[]{start + 60_000L}, new String[]{"work", "daily"}, new String[]{"", ""}));
        expectFailure(() -> repo.splitSegment("wrong-cycle", updated.id, updated, new long[]{start + 60_000L}, new String[]{"work", "daily"}, new String[]{"", ""}));
        assertEquals(before, repo.getState().toJson());
    }

    @Test
    public void splitRejectsDuplicateReversedEndpointAndFutureCutsAtomically() {
        FakeClock clock = new FakeClock(); TimerRepository repo = new TimerRepository(new MemStore(), clock);
        long start = clock.wall; TimerState s = repo.startCycle("c", start - 8 * 3_600_000L, start);
        clock.advance(180_000L); TimerState.Segment expected = snapshot(s.openSegment());
        String before = repo.getState().toJson();
        for (long[] cuts : new long[][]{{}, {start}, {start + 180_000L}, {start + 240_000L}, {start + 60_000L, start + 60_000L}, {start + 120_000L, start + 60_000L}}) {
            String[] cats = new String[cuts.length + 1]; String[] notes = new String[cats.length];
            java.util.Arrays.fill(cats, "work"); java.util.Arrays.fill(notes, "");
            expectFailure(() -> repo.splitSegment("c", expected.id, expected, cuts, cats, notes));
            assertEquals(before, repo.getState().toJson());
        }
    }

    @Test
    public void splitProtectsLiveSleepButCanBackfillCompletedNap() {
        FakeClock clock = new FakeClock(); TimerRepository repo = new TimerRepository(new MemStore(), clock);
        long start = clock.wall; repo.startCycle("c", start - 8 * 3_600_000L, start);
        clock.advance(180_000L); TimerState.Segment awake = snapshot(repo.getState().openSegment());
        expectFailure(() -> repo.splitSegment("c", awake.id, awake, new long[]{start + 60_000L}, new String[]{"work", "sleep"}, new String[]{"", ""}));
        repo.splitSegment("c", awake.id, awake, new long[]{start + 60_000L}, new String[]{"sleep", "work"}, new String[]{"补记补觉", ""});
        assertEquals(60_000L, TimerMath.napMs(repo.getState(), clock.wall));
        TimerState nap = repo.startNap(); TimerState.Segment sleeping = snapshot(nap.openSegment());
        clock.advance(60_000L);
        expectFailure(() -> repo.splitSegment("c", sleeping.id, sleeping, new long[]{sleeping.startAtMs + 30_000L}, new String[]{"sleep", "sleep"}, new String[]{"", ""}));
    }

    @Test
    public void splitStorageFailureDoesNotPublishHalfMutation() {
        MemStore store = new MemStore(); FakeClock clock = new FakeClock();
        TimerRepository repo = new TimerRepository(store, clock); long start = clock.wall;
        TimerState s = repo.startCycle("c", start - 8 * 3_600_000L, start);
        TimerState.Segment expected = snapshot(s.openSegment()); clock.advance(180_000L);
        String before = repo.getState().toJson(); store.failWrites = true;
        expectFailure(() -> repo.splitSegment("c", expected.id, expected, new long[]{start + 60_000L}, new String[]{"daily", "cat-study"}, new String[]{"", ""}));
        assertEquals(before, repo.getState().toJson()); assertEquals(before, store.get("timer_state_v1", ""));
    }

    @Test
    public void emptyStateHasNoOpenSegment() {
        TimerRepository repo = new TimerRepository(new MemStore(), new FakeClock());
        TimerState s = repo.getState();
        assertEquals(TimerState.STATUS_IDLE, s.status);
        assertNull(s.openSegment());
        assertNotNull(repo.closeCycle());
    }
}
