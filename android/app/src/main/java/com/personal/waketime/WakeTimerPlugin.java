package com.personal.waketime;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.personal.waketime.timer.TimerEnv;
import com.personal.waketime.timer.TimerRepository;
import com.personal.waketime.timer.TimerService;
import com.personal.waketime.timer.TimerState;

/** JS <-> 原生计时状态的桥。 */
@CapacitorPlugin(name = "WakeTimer")
public class WakeTimerPlugin extends Plugin {

    private TimerRepository repo() {
        return TimerEnv.repo(getContext());
    }

    private interface StateOperation {
        TimerState run();
    }

    /** 包括校验、持久化、通知刷新在内的错误都交给 JS，不返回假成功。 */
    private void resolveState(PluginCall call, StateOperation operation) {
        try {
            TimerState state = operation.run();
            if (state.notificationsEnabled && TimerState.STATUS_RUNNING.equals(state.status)) {
                TimerService.start(getContext());
            } else {
                TimerService.stop(getContext());
            }
            call.resolve(stateToJs(state));
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "计时操作失败" : e.getMessage(), e);
        }
    }

    private static String requiredString(PluginCall call, String key, boolean allowEmpty) {
        String value = call.getString(key);
        if (value == null || (!allowEmpty && value.trim().isEmpty())) {
            throw new IllegalArgumentException("缺少 " + key);
        }
        return value;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        resolveState(call, () -> repo().getState());
    }

    @PluginMethod
    public void startCycle(PluginCall call) {
        resolveState(call, () -> {
            Long sleepAt = call.getLong("sleepAtMs");
            Long wakeAt = call.getLong("wakeAtMs");
            if (sleepAt == null || wakeAt == null) throw new IllegalArgumentException("缺少睡眠起止时间");
            return repo().startCycle(requiredString(call, "cycleId", false), sleepAt, wakeAt);
        });
    }

    @PluginMethod
    public void lap(PluginCall call) {
        resolveState(call, () -> repo().lap(call.getString("note", ""), "app"));
    }

    @PluginMethod
    public void restartSession(PluginCall call) {
        resolveState(call, () -> repo().restartSession());
    }

    @PluginMethod
    public void setNote(PluginCall call) {
        resolveState(call, () -> repo().setNote(requiredString(call, "segmentId", false),
                call.getString("note", "")));
    }

    @PluginMethod
    public void setSegmentDetails(PluginCall call) {
        resolveState(call, () -> repo().setSegmentDetails(
                requiredString(call, "segmentId", false), requiredString(call, "note", true),
                requiredString(call, "category", false)));
    }

    @PluginMethod
    public void mergeSegments(PluginCall call) {
        resolveState(call, () -> repo().mergeSegments(
                requiredString(call, "firstId", false), requiredString(call, "secondId", false),
                requiredString(call, "category", false)));
    }

    @PluginMethod
    public void splitSegment(PluginCall call) {
        resolveState(call, () -> {
            JSObject expected = call.getObject("expected");
            JSArray cuts = call.getArray("cuts");
            JSArray parts = call.getArray("parts");
            if (expected == null || cuts == null || parts == null) throw new IllegalArgumentException("缺少拆分预览数据");
            try {
                long[] boundaries = new long[cuts.length()];
                String[] categories = new String[parts.length()];
                String[] notes = new String[parts.length()];
                for (int i = 0; i < boundaries.length; i++) {
                    double number = cuts.getDouble(i);
                    if (!Double.isFinite(number) || number != Math.rint(number) || Math.abs(number) > 9_007_199_254_740_991d) {
                        throw new IllegalArgumentException("分界点不是合法的毫秒时间");
                    }
                    boundaries[i] = (long) number;
                }
                for (int i = 0; i < categories.length; i++) {
                    org.json.JSONObject part = parts.getJSONObject(i);
                    categories[i] = part.getString("category");
                    notes[i] = part.getString("note");
                }
                return repo().splitSegment(requiredString(call, "cycleId", false), requiredString(call, "segmentId", false),
                        TimerState.Segment.fromJson(expected), boundaries, categories, notes);
            } catch (org.json.JSONException e) {
                throw new IllegalArgumentException("拆分数据格式不合法", e);
            }
        });
    }

    @PluginMethod
    public void startNap(PluginCall call) {
        resolveState(call, () -> repo().startNap());
    }

    @PluginMethod
    public void endNap(PluginCall call) {
        resolveState(call, () -> repo().endNap());
    }

    @PluginMethod
    public void endSession(PluginCall call) {
        resolveState(call, () -> repo().endSession());
    }

    @PluginMethod
    public void closeCycle(PluginCall call) {
        resolveState(call, () -> repo().closeCycle());
    }

    @PluginMethod
    public void setNotificationsEnabled(PluginCall call) {
        resolveState(call, () -> repo().setNotificationsEnabled(
                Boolean.TRUE.equals(call.getBoolean("enabled", Boolean.TRUE))));
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Activity activity = getActivity();
            ActivityCompat.requestPermissions(activity, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7001);
        }
        call.resolve();
    }

    @PluginMethod
    public void checkNotificationPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            intent.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("打开通知设置失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("打开应用设置失败: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("sdkInt", Build.VERSION.SDK_INT);
        result.put("androidRelease", Build.VERSION.RELEASE);
        result.put("model", Build.MODEL);
        result.put("manufacturer", Build.MANUFACTURER);
        String webView = "";
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.content.pm.PackageInfo pi = WebView.getCurrentWebViewPackage();
                webView = pi == null ? "" : pi.versionName;
            }
        } catch (Throwable ignored) {
        }
        result.put("webViewVersion", webView);
        result.put("notificationsGranted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(result);
    }

    private JSObject stateToJs(TimerState state) {
        JSObject o = new JSObject();
        o.put("cycleId", state.cycleId);
        o.put("sleepAtMs", state.sleepAtMs);
        o.put("wakeAtMs", state.wakeAtMs);
        o.put("targetAtMs", state.targetAtMs);
        o.put("status", state.status);
        o.put("sessionId", state.sessionId);
        o.put("sessionStartedAtMs", state.sessionStartedAtMs);
        o.put("notificationsEnabled", state.notificationsEnabled);
        o.put("clockAnomaly", state.clockAnomaly);
        JSArray segments = new JSArray();
        for (TimerState.Segment segment : state.segments) {
            JSObject so = new JSObject();
            so.put("id", segment.id);
            so.put("seq", segment.seq);
            so.put("startAtMs", segment.startAtMs);
            so.put("endAtMs", segment.endAtMs);
            so.put("note", segment.note);
            so.put("category", TimerState.categoryOrDefault(segment.category));
            so.put("source", segment.source);
            if (!segment.splitFromId.isEmpty()) so.put("splitFromId", segment.splitFromId);
            segments.put(so);
        }
        o.put("segments", segments);
        return o;
    }
}
