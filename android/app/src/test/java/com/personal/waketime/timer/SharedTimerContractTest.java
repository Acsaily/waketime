package com.personal.waketime.timer;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/**
 * Java side of contracts/timer-cases.json.
 *
 * <p>The same synthetic fixture is executed by the TS contract test. This test
 * never copies the fixture: it locates the single repo-root file and runs the
 * real TimerRepository + TimerMath implementation with a seeded MemStore and a
 * fake wall/monotonic clock. Segment ids beginning with {@code @} are generated
 * ids: Java binds them to the actual UUID on first use and asserts they are
 * non-empty, unique and never reuse a literal fixture id.</p>
 */
public class SharedTimerContractTest {

    private static final String KEY = "timer_state_v1";

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
        long wall;
        long mono;
        String boot;

        FakeClock(long wall, long mono, String boot) {
            this.wall = wall;
            this.mono = mono;
            this.boot = boot;
        }

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
    }

    private static final class Ctx {
        final Map<String, String> symbols = new HashMap<>();
        final Set<String> literals;
        final long t;
        final long mono0;
        String lastSessionId = "";

        Ctx(Set<String> literals, long t, long mono0) {
            this.literals = literals;
            this.t = t;
            this.mono0 = mono0;
        }
    }

    private static final class Summary {
        final long mainSleepMs;
        final long napMs;
        final long totalSleepMs;
        final long awakeMs;
        final long targetAtMs;

        Summary(TimerState state, long nowMs) {
            mainSleepMs = Math.max(0L, state.wakeAtMs - state.sleepAtMs);
            napMs = TimerMath.napMs(state, nowMs);
            totalSleepMs = TimerMath.totalSleepMs(state, nowMs);
            awakeMs = TimerMath.awakeMs(state, nowMs);
            targetAtMs = state.targetAtMs;
        }
    }

    @Test
    public void sharedContractCases() throws Exception {
        JSONObject root = new JSONObject(readFile(findContract()));
        JSONObject meta = root.getJSONObject("meta");
        JSONArray cases = root.getJSONArray("cases");
        List<String> failures = new ArrayList<>();
        int executed = 0;
        for (int i = 0; i < cases.length(); i++) {
            JSONObject c = cases.getJSONObject(i);
            if ("ts-only".equals(c.getString("scope"))) continue;
            executed++;
            try {
                runCase(c, meta);
            } catch (Throwable failure) {
                failures.add(c.getString("id") + ": " + failure);
            }
        }
        assertTrue("the fixture must execute at least one Java case", executed > 0);
        if (!failures.isEmpty()) fail(String.join("\n\n", failures));
    }

    private static void runCase(JSONObject c, JSONObject meta) throws Exception {
        long t = meta.getLong("t");
        long mono0 = meta.getLong("mono0");
        String boot = meta.getString("bootId");
        MemStore store = new MemStore();
        JSONObject seed = c.optJSONObject("seed");
        if (seed != null) store.map.put(KEY, seed.toString());

        FakeClock clock = new FakeClock(t, mono0, boot);
        TimerRepository repo = new TimerRepository(store, clock);
        Ctx ctx = new Ctx(collectLiterals(c), t, mono0);
        ctx.lastSessionId = repo.getState().sessionId;

        JSONArray steps = c.getJSONArray("steps");
        for (int i = 0; i < steps.length(); i++) {
            runStep(c.getString("id"), i, steps.getJSONObject(i), repo, store, clock, ctx);
        }
    }

    private static void runStep(String caseId, int index, JSONObject step, TimerRepository repo,
            MemStore store, FakeClock clock, Ctx ctx) throws Exception {
        String label = caseId + "/" + index + ":" + step.getString("op");
        long atMs = step.getLong("atMs");
        clock.wall = atMs;
        clock.mono = step.has("monoMs") ? step.getLong("monoMs") : ctx.mono0 + (atMs - ctx.t);
        clock.boot = step.optString("bootId", "b1");

        JSONObject expect = mergeExpect(step.getJSONObject("expect"), "java");
        boolean wantReject = expect.optBoolean("reject", false);
        String storeBefore = store.get(KEY, null);
        // 完整状态快照（不只是段的 bridge 投影）：拒绝路径必须逐字段保持不变，
        // 覆盖 cycle/session、单调钟/开机锚点、通知开关与持久化字段。
        JSONObject stateBefore = new JSONObject(repo.getState().toJson());

        Summary summary = null;
        Exception thrown = null;
        try {
            summary = apply(step, repo, store, clock, ctx, index, label);
        } catch (Exception failure) {
            thrown = failure;
        }

        TimerState state = repo.getState();

        if (wantReject) {
            assertNotNull(label + ": expected rejection, got success", thrown);
            assertEquals(label + ": store must not change on rejection", storeBefore, store.get(KEY, null));
            assertJsonEquals(label + ": state must not change on rejection", stateBefore,
                    new JSONObject(state.toJson()));
            if (expect.has("status")) assertEquals(label + ": status after rejection",
                    expect.getString("status"), state.status);
            if (expect.has("segments")) assertSegments(bridge(state), expect.getJSONArray("segments"),
                    ctx.symbols, ctx.literals, label + " after rejection");
            return;
        }

        if (thrown != null) throw new AssertionError(label + ": unexpected rejection: " + thrown, thrown);

        if (expect.has("status")) assertEquals(label + ": status", expect.getString("status"), state.status);
        if (expect.has("segments")) assertSegments(bridge(state), expect.getJSONArray("segments"),
                ctx.symbols, ctx.literals, label);

        if (expect.has("totals")) {
            Summary measured = summary != null ? summary : new Summary(state, atMs);
            JSONObject totals = expect.getJSONObject("totals");
            for (String key : keys(totals)) {
                long expected = totals.getLong(key);
                long actual;
                if ("mainSleepMs".equals(key)) actual = measured.mainSleepMs;
                else if ("napMs".equals(key)) actual = measured.napMs;
                else if ("totalSleepMs".equals(key)) actual = measured.totalSleepMs;
                else if ("awakeMs".equals(key)) actual = measured.awakeMs;
                else if ("targetAtMs".equals(key)) actual = measured.targetAtMs;
                else if ("budgetMs".equals(key)) actual = TimerMath.budgetMs(measured.totalSleepMs);
                else if ("remainingMs".equals(key)) actual = TimerMath.remainingMs(measured.targetAtMs, atMs);
                else throw new AssertionError(label + ": unknown totals key " + key);
                assertEquals(label + ": totals." + key, expected, actual);
            }
        }

        assertJavaExtras(label, expect, state, atMs, ctx);

        if (expect.optBoolean("persisted", false)) {
            String raw = store.get(KEY, null);
            assertNotNull(label + ": committed state must exist in the store", raw);
            TimerRepository reopened = new TimerRepository(store, clock);
            TimerState reloaded = reopened.getState();
            // 稳定时钟下重载必须与内存状态逐字段一致（完整 TimerState.toJson()），
            // 覆盖 cycle/session、单调钟/开机锚点、通知开关、持久化锚点与所有段，
            // 而不只是段的 bridge 投影。异常钟步骤若确有合法差异，
            // 必须在 fixture 的 expect.reopen.allowDiff 中显式列出允许变化的顶层字段。
            assertReopenEquals(label, state, reloaded, expect);
            assertEquals(label + ": reopened status", state.status, reloaded.status);
        }

        ctx.lastSessionId = state.sessionId;
    }

    private static Summary apply(JSONObject step, TimerRepository repo, MemStore store, FakeClock clock,
            Ctx ctx, int index, String label) throws Exception {
        String op = step.getString("op");
        JSONObject args = step.optJSONObject("args");
        if ("edit".equals(op)) {
            String note = args.has("note") && !args.isNull("note") ? args.getString("note") : null;
            String category = args.has("category") && !args.isNull("category") ? args.getString("category") : null;
            repo.setSegmentDetails(resolve(args.getString("id"), ctx.symbols), note, category);
            return null;
        }
        if ("split".equals(op)) {
            String cycleId = args.has("cycleId") ? args.getString("cycleId") : repo.getState().cycleId;
            String segmentId = resolve(args.getString("segmentId"), ctx.symbols);
            JSONObject expectedJson = args.getJSONObject("expected");
            TimerState.Segment expected = new TimerState.Segment();
            expected.id = resolve(expectedJson.getString("id"), ctx.symbols);
            expected.startAtMs = expectedJson.getLong("startAtMs");
            expected.endAtMs = expectedJson.getLong("endAtMs");
            expected.note = expectedJson.getString("note");
            expected.category = expectedJson.getString("category");
            JSONArray cutsJson = args.getJSONArray("cuts");
            long[] cuts = new long[cutsJson.length()];
            for (int i = 0; i < cuts.length; i++) cuts[i] = cutsJson.getLong(i);
            JSONArray parts = args.getJSONArray("parts");
            String[] categories = new String[parts.length()];
            String[] notes = new String[parts.length()];
            for (int i = 0; i < parts.length(); i++) {
                JSONObject part = parts.getJSONObject(i);
                categories[i] = part.getString("category");
                notes[i] = part.isNull("note") ? null : part.getString("note");
            }
            repo.splitSegment(cycleId, segmentId, expected, cuts, categories, notes);
            return null;
        }
        if ("merge".equals(op)) {
            String category = args.has("category") && !args.isNull("category") ? args.getString("category") : null;
            repo.mergeSegments(resolve(args.getString("firstId"), ctx.symbols),
                    resolve(args.getString("secondId"), ctx.symbols), category);
            return null;
        }
        if ("lap".equals(op)) {
            String note = args.has("note") && !args.isNull("note") ? args.getString("note") : null;
            String source = args.has("source") && !args.isNull("source") ? args.getString("source") : null;
            repo.lap(note, source);
            return null;
        }
        if ("startCycle".equals(op)) {
            repo.startCycle(args.getString("cycleId"), args.getLong("sleepAtMs"), args.getLong("wakeAtMs"));
            return null;
        }
        if ("startNap".equals(op)) {
            repo.startNap();
            return null;
        }
        if ("endNap".equals(op)) {
            repo.endNap();
            return null;
        }
        if ("endSession".equals(op)) {
            repo.endSession();
            return null;
        }
        if ("restartSession".equals(op)) {
            repo.restartSession();
            return null;
        }
        if ("closeCycle".equals(op)) {
            repo.closeCycle();
            return null;
        }
        if ("setNotificationsEnabled".equals(op)) {
            repo.setNotificationsEnabled(args.getBoolean("enabled"));
            return null;
        }
        if ("summarize".equals(op)) {
            return new Summary(repo.getState(), step.getLong("atMs"));
        }
        if ("getState".equals(op)) {
            repo.getState();
            return null;
        }
        if ("reopenCheck".equals(op)) {
            TimerRepository reopened = new TimerRepository(store, clock);
            assertJsonEquals(label + ": reopenCheck bridge", bridge(repo.getState()), bridge(reopened.getState()));
            assertEquals(label + ": reopenCheck status", repo.getState().status, reopened.getState().status);
            return null;
        }
        if ("setFailWrites".equals(op)) {
            store.failWrites = args.getBoolean("enabled");
            return null;
        }
        throw new AssertionError(label + ": Java runner does not implement op " + op);
    }

    private static void assertJavaExtras(String label, JSONObject expect, TimerState state, long nowMs, Ctx ctx) throws Exception {
        if (expect.has("notificationsEnabled")) {
            assertEquals(label + ": notificationsEnabled",
                    expect.getBoolean("notificationsEnabled"), state.notificationsEnabled);
        }
        if (expect.has("closedCount")) {
            assertEquals(label + ": closedCount", expect.getInt("closedCount"), state.closedCount());
        }
        if (expect.has("cycleId")) assertEquals(label + ": cycleId", expect.getString("cycleId"), state.cycleId);
        if (expect.has("targetAtMs")) assertEquals(label + ": targetAtMs", expect.getLong("targetAtMs"), state.targetAtMs);
        if (expect.has("napMs")) assertEquals(label + ": napMs", expect.getLong("napMs"), TimerMath.napMs(state, nowMs));
        if (expect.has("awakeMs")) assertEquals(label + ": awakeMs", expect.getLong("awakeMs"), TimerMath.awakeMs(state, nowMs));
        if (expect.has("totalSleepMs")) {
            assertEquals(label + ": totalSleepMs", expect.getLong("totalSleepMs"), TimerMath.totalSleepMs(state, nowMs));
        }
        if (expect.has("budgetMs")) {
            assertEquals(label + ": budgetMs", expect.getLong("budgetMs"),
                    TimerMath.budgetMs(TimerMath.totalSleepMs(state, nowMs)));
        }
        if (expect.has("remainingMs")) {
            assertEquals(label + ": remainingMs", expect.getLong("remainingMs"),
                    TimerMath.remainingMs(state.targetAtMs, nowMs));
        }
        if (expect.has("clockAnomaly")) {
            assertEquals(label + ": clockAnomaly", expect.getBoolean("clockAnomaly"), state.clockAnomaly);
        }
        if (expect.has("bootId")) assertEquals(label + ": bootId", expect.getString("bootId"), state.bootId);
        if (expect.has("openStartMonoMs")) {
            assertNotNull(label + ": open segment", state.openSegment());
            assertEquals(label + ": openStartMonoMs", expect.getLong("openStartMonoMs"),
                    state.openSegment().startMonoMs);
        }
        if (expect.has("firstSegmentEndMonoMs")) {
            assertFalse(label + ": first segment", state.segments.isEmpty());
            assertEquals(label + ": firstSegmentEndMonoMs", expect.getLong("firstSegmentEndMonoMs"),
                    state.segments.get(0).endMonoMs);
        }
        if (expect.optBoolean("sessionIdNonEmpty", false)) {
            assertFalse(label + ": sessionId must be non-empty", state.sessionId.isEmpty());
        }
        if (expect.optBoolean("sessionIdChanged", false)) {
            assertFalse(label + ": new sessionId must be non-empty", state.sessionId.isEmpty());
            assertFalse(label + ": sessionId must change", state.sessionId.equals(ctx.lastSessionId));
        }
        if (expect.optBoolean("sessionIdUnchanged", false)) {
            assertEquals(label + ": sessionId must stay unchanged", ctx.lastSessionId, state.sessionId);
        }
    }

    private static JSONObject mergeExpect(JSONObject expect, String language) throws Exception {
        JSONObject merged = new JSONObject(expect.toString());
        JSONObject override = expect.optJSONObject(language);
        if (override != null) {
            for (String key : keys(override)) merged.put(key, override.get(key));
        }
        return merged;
    }

    /**
     * 比较重载后的完整状态。默认逐字段严格相等；异常钟步骤可以在
     * expect.reopen.allowDiff 中显式列出重载后允许变化的顶层字段
     * （例如墙钟被改过时的 clockAnomaly），除此之外任何差异都算失败。
     */
    private static void assertReopenEquals(String label, TimerState live, TimerState reloaded,
            JSONObject expect) throws Exception {
        JSONObject left = new JSONObject(live.toJson());
        JSONObject right = new JSONObject(reloaded.toJson());
        Set<String> allowed = new HashSet<>();
        JSONObject reopen = expect.optJSONObject("reopen");
        if (reopen != null) {
            JSONArray diff = reopen.optJSONArray("allowDiff");
            if (diff != null) {
                for (int i = 0; i < diff.length(); i++) allowed.add(diff.getString(i));
            }
        }
        Set<String> leftKeys = new TreeSet<>(keys(left));
        Set<String> rightKeys = new TreeSet<>(keys(right));
        leftKeys.removeAll(allowed);
        rightKeys.removeAll(allowed);
        assertEquals(label + ": reopened keys", leftKeys, rightKeys);
        for (String key : leftKeys) {
            assertJsonEquals(label + ": reopened." + key, left.get(key), right.get(key));
        }
    }

    private static Set<String> collectLiterals(JSONObject c) throws Exception {
        Set<String> literals = new HashSet<>();
        JSONObject seed = c.optJSONObject("seed");
        if (seed != null) collectSegmentLiterals(seed.optJSONArray("segments"), literals);
        JSONArray steps = c.getJSONArray("steps");
        for (int i = 0; i < steps.length(); i++) {
            JSONObject expect = steps.getJSONObject(i).getJSONObject("expect");
            collectSegmentLiterals(expect.optJSONArray("segments"), literals);
            JSONObject ts = expect.optJSONObject("ts");
            if (ts != null) collectSegmentLiterals(ts.optJSONArray("segments"), literals);
            JSONObject java = expect.optJSONObject("java");
            if (java != null) collectSegmentLiterals(java.optJSONArray("segments"), literals);
        }
        return literals;
    }

    private static void collectSegmentLiterals(JSONArray segments, Set<String> literals) throws Exception {
        if (segments == null) return;
        for (int i = 0; i < segments.length(); i++) {
            JSONObject s = segments.getJSONObject(i);
            addLiteral(s.optString("id", ""), literals);
            addLiteral(s.optString("splitFromId", ""), literals);
        }
    }

    private static void addLiteral(String id, Set<String> literals) {
        if (!id.isEmpty() && !id.startsWith("@")) literals.add(id);
    }

    private static String resolve(String value, Map<String, String> symbols) {
        if (value == null || !value.startsWith("@")) return value;
        String bound = symbols.get(value);
        if (bound == null) throw new AssertionError("unbound generated-id symbol " + value);
        return bound;
    }

    private static List<String> keys(JSONObject object) throws Exception {
        List<String> keys = new ArrayList<>();
        JSONArray names = object.names();
        if (names != null) {
            for (int i = 0; i < names.length(); i++) keys.add(names.optString(i));
        }
        return keys;
    }

    private static void assertSegments(JSONArray actual, JSONArray expected, Map<String, String> symbols,
            Set<String> literals, String label) throws Exception {
        assertEquals(label + ": segment count", expected.length(), actual.length());
        Set<String> ids = new HashSet<>();
        for (int i = 0; i < expected.length(); i++) {
            JSONObject want = expected.getJSONObject(i);
            JSONObject got = actual.getJSONObject(i);
            String actualId = got.getString("id");
            assertFalse(label + ": segment " + i + " id must be non-empty", actualId.isEmpty());
            assertTrue(label + ": duplicate segment id " + actualId, ids.add(actualId));

            String expectedId = want.getString("id");
            if (expectedId.startsWith("@")) {
                String bound = symbols.get(expectedId);
                if (bound == null) {
                    assertFalse(label + ": generated id reused literal " + actualId, literals.contains(actualId));
                    assertFalse(label + ": generated id bound twice " + actualId, symbols.containsValue(actualId));
                    symbols.put(expectedId, actualId);
                } else {
                    assertEquals(label + ": symbol " + expectedId, bound, actualId);
                }
            } else {
                assertEquals(label + ": segment " + i + " id", expectedId, actualId);
            }

            assertEquals(label + ": segment " + i + " fields",
                    new TreeSet<>(keys(want)), new TreeSet<>(keys(got)));
            for (String key : keys(want)) {
                if ("id".equals(key)) continue;
                Object expectedValue = want.get(key);
                Object actualValue = got.get(key);
                if ("splitFromId".equals(key) && expectedValue instanceof String
                        && ((String) expectedValue).startsWith("@")) {
                    String bound = symbols.get(expectedValue);
                    assertNotNull(label + ": unbound splitFromId " + expectedValue, bound);
                    assertEquals(label + ": segment " + i + " splitFromId", bound, actualValue);
                } else if ("seq".equals(key)) {
                    assertEquals(label + ": segment " + i + " seq",
                            ((Number) expectedValue).intValue(), ((Number) actualValue).intValue());
                } else {
                    assertScalarEquals(label + ": segment " + i + "." + key, expectedValue, actualValue);
                }
            }
        }
    }

    private static void assertJsonEquals(String label, Object expected, Object actual) throws Exception {
        if (expected instanceof JSONArray && actual instanceof JSONArray) {
            JSONArray left = (JSONArray) expected;
            JSONArray right = (JSONArray) actual;
            assertEquals(label + ": array length", left.length(), right.length());
            for (int i = 0; i < left.length(); i++) assertJsonEquals(label + "[" + i + "]", left.get(i), right.get(i));
            return;
        }
        if (expected instanceof JSONObject && actual instanceof JSONObject) {
            JSONObject left = (JSONObject) expected;
            JSONObject right = (JSONObject) actual;
            assertEquals(label + ": object keys", new TreeSet<>(keys(left)), new TreeSet<>(keys(right)));
            for (String key : keys(left)) assertJsonEquals(label + "." + key, left.get(key), right.get(key));
            return;
        }
        assertScalarEquals(label, expected, actual);
    }

    private static void assertScalarEquals(String label, Object expected, Object actual) {
        if (expected instanceof Number && actual instanceof Number) {
            assertEquals(label, ((Number) expected).longValue(), ((Number) actual).longValue());
        } else {
            assertEquals(label, expected, actual);
        }
    }

    private static JSONArray bridge(TimerState state) throws Exception {
        JSONArray array = new JSONArray();
        for (TimerState.Segment segment : state.segments) {
            JSONObject o = new JSONObject();
            o.put("id", segment.id);
            o.put("seq", segment.seq);
            o.put("startAtMs", segment.startAtMs);
            o.put("endAtMs", segment.endAtMs);
            o.put("note", segment.note);
            o.put("category", segment.category);
            o.put("source", segment.source);
            if (!segment.splitFromId.isEmpty()) o.put("splitFromId", segment.splitFromId);
            array.put(o);
        }
        return array;
    }

    private static Path findContract() {
        String override = System.getProperty("waketime.contracts");
        if (override != null && !override.isEmpty()) return Paths.get(override);
        Path dir = Paths.get(System.getProperty("user.dir")).toAbsolutePath();
        for (int i = 0; i < 10 && dir != null; i++) {
            Path candidate = dir.resolve("contracts").resolve("timer-cases.json");
            if (Files.isRegularFile(candidate)) return candidate;
            dir = dir.getParent();
        }
        throw new IllegalStateException("cannot find contracts/timer-cases.json from " + System.getProperty("user.dir"));
    }

    private static String readFile(Path path) throws Exception {
        return new String(Files.readAllBytes(path), StandardCharsets.UTF_8);
    }
}
