package com.personal.waketime.timer;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** 原生侧持有的"当前周期 + 段"状态，可 JSON 序列化后存 SharedPreferences。 */
public final class TimerState {
    public static final String STATUS_IDLE = "idle";
    public static final String STATUS_RUNNING = "running";
    public static final String STATUS_ENDED = "ended";
    public static final String CATEGORY_WORK = "work";
    public static final String CATEGORY_DAILY = "daily";
    public static final String CATEGORY_SLEEP = "sleep";
    public static final String CATEGORY_UNCLASSIFIED = "unclassified";

    public static boolean isCategory(String category) {
        // 动态类别只保存稳定 ID；名称/停用状态由 JS 的持久化目录维护。
        return category != null && category.matches("[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}");
    }

    public static String categoryOrDefault(String category) {
        return isCategory(category) ? category : CATEGORY_UNCLASSIFIED;
    }

    public static final class Segment {
        public String id = "";
        public int seq;
        public long startAtMs;
        public long startMonoMs;
        public long endAtMs;      // 0 表示还没结束
        public long endMonoMs;
        public String note = "";
        public String category = CATEGORY_UNCLASSIFIED;
        public String source = "app";
        public String splitFromId = "";

        public boolean isOpen() {
            return endAtMs == 0L;
        }

        public JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("id", id);
            o.put("seq", seq);
            o.put("startAtMs", startAtMs);
            o.put("startMonoMs", startMonoMs);
            o.put("endAtMs", endAtMs);
            o.put("endMonoMs", endMonoMs);
            o.put("note", note);
            o.put("category", categoryOrDefault(category));
            o.put("source", source);
            if (!splitFromId.isEmpty()) o.put("splitFromId", splitFromId);
            return o;
        }

        public static Segment fromJson(JSONObject o) {
            Segment s = new Segment();
            s.id = o.optString("id", "");
            s.seq = o.optInt("seq", 0);
            s.startAtMs = o.optLong("startAtMs", 0L);
            s.startMonoMs = o.optLong("startMonoMs", 0L);
            s.endAtMs = o.optLong("endAtMs", 0L);
            s.endMonoMs = o.optLong("endMonoMs", 0L);
            s.note = o.optString("note", "");
            s.category = categoryOrDefault(o.optString("category", CATEGORY_UNCLASSIFIED));
            s.source = o.optString("source", "app");
            s.splitFromId = o.optString("splitFromId", "");
            return s;
        }
    }

    public String cycleId = "";
    public long sleepAtMs;
    public long wakeAtMs;
    public long targetAtMs;
    public String status = STATUS_IDLE;
    public String sessionId = "";
    public long sessionStartedAtMs;
    public long sessionStartedMonoMs;
    public String bootId = "";
    public boolean notificationsEnabled = true;
    public boolean clockAnomaly = false;
    public long lastWallMs;
    public long lastMonoMs;
    public final List<Segment> segments = new ArrayList<>();

    public Segment openSegment() {
        for (int i = segments.size() - 1; i >= 0; i--) {
            if (segments.get(i).isOpen()) return segments.get(i);
        }
        return null;
    }

    public boolean isNapping() {
        Segment open = openSegment();
        return STATUS_RUNNING.equals(status) && open != null && CATEGORY_SLEEP.equals(open.category);
    }

    /** 补觉是睡眠，不作为清醒计次。 */
    public int closedCount() {
        int n = 0;
        for (Segment s : segments) {
            if (!s.isOpen() && !CATEGORY_SLEEP.equals(s.category)) n++;
        }
        return n;
    }

    public void renumberSegments() {
        for (int i = 0; i < segments.size(); i++) segments.get(i).seq = i + 1;
    }

    /** 旧版漏掉的起床空档单独补齐，绝不挪用首段备注/类别。 */
    public boolean repairWakeGap() {
        if (cycleId.isEmpty() || wakeAtMs <= 0L || segments.isEmpty()) return false;
        String gapId = cycleId + ":wake-gap";
        Segment earliest = segments.get(0);
        int earliestIndex = 0;
        for (int i = 0; i < segments.size(); i++) {
            Segment segment = segments.get(i);
            if (gapId.equals(segment.id)) return false;
            if (segment.startAtMs < earliest.startAtMs) {
                earliest = segment;
                earliestIndex = i;
            }
        }
        if (earliest.startAtMs <= wakeAtMs) return false;
        Segment gap = new Segment();
        gap.id = gapId;
        gap.startAtMs = wakeAtMs;
        gap.endAtMs = earliest.startAtMs;
        // 旧空档可能早于本次开机；0 表示没有可信的单调钟起点。
        gap.endMonoMs = earliest.startMonoMs;
        gap.note = "起床后未记录（补齐）";
        segments.add(earliestIndex, gap);
        renumberSegments();
        return true;
    }

    public String toJson() {
        try {
            JSONObject o = new JSONObject();
            o.put("cycleId", cycleId);
            o.put("sleepAtMs", sleepAtMs);
            o.put("wakeAtMs", wakeAtMs);
            o.put("targetAtMs", targetAtMs);
            o.put("status", status);
            o.put("sessionId", sessionId);
            o.put("sessionStartedAtMs", sessionStartedAtMs);
            o.put("sessionStartedMonoMs", sessionStartedMonoMs);
            o.put("bootId", bootId);
            o.put("notificationsEnabled", notificationsEnabled);
            o.put("clockAnomaly", clockAnomaly);
            o.put("lastWallMs", lastWallMs);
            o.put("lastMonoMs", lastMonoMs);
            JSONArray arr = new JSONArray();
            for (Segment s : segments) arr.put(s.toJson());
            o.put("segments", arr);
            return o.toString();
        } catch (JSONException e) {
            throw new RuntimeException("TimerState 序列化失败", e);
        }
    }

    public static TimerState fromJson(String json) {
        if (json == null || json.trim().isEmpty()) return null;
        try {
            JSONObject o = new JSONObject(json);
            TimerState s = new TimerState();
            s.cycleId = o.optString("cycleId", "");
            s.sleepAtMs = o.optLong("sleepAtMs", 0L);
            s.wakeAtMs = o.optLong("wakeAtMs", 0L);
            s.targetAtMs = o.optLong("targetAtMs", 0L);
            s.status = o.optString("status", STATUS_IDLE);
            s.sessionId = o.optString("sessionId", "");
            s.sessionStartedAtMs = o.optLong("sessionStartedAtMs", 0L);
            s.sessionStartedMonoMs = o.optLong("sessionStartedMonoMs", 0L);
            s.bootId = o.optString("bootId", "");
            s.notificationsEnabled = o.optBoolean("notificationsEnabled", true);
            s.clockAnomaly = o.optBoolean("clockAnomaly", false);
            s.lastWallMs = o.optLong("lastWallMs", 0L);
            s.lastMonoMs = o.optLong("lastMonoMs", 0L);
            JSONArray arr = o.optJSONArray("segments");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject so = arr.optJSONObject(i);
                    if (so != null) s.segments.add(Segment.fromJson(so));
                }
            }
            return s;
        } catch (JSONException e) {
            return null;
        }
    }
}
