package com.personal.waketime.timer;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

/**
 * 前台服务：常驻通知（已清醒秒表 + 计次）。亮屏时每秒刷新一次通知文字，灭屏停更省电；
 * 处理通知栏动作与"直接打字备注"。
 */
public class TimerService extends Service {
    public static final String ACTION_START = "com.personal.waketime.action.START";
    public static final String ACTION_REFRESH = "com.personal.waketime.action.REFRESH";
    public static final String ACTION_LAP = "com.personal.waketime.action.LAP";
    public static final String ACTION_END = "com.personal.waketime.action.END";
    public static final String ACTION_END_NAP = "com.personal.waketime.action.END_NAP";
    public static final String EXTRA_NOTE = "lap_note";

    public static final int NOTIFICATION_ID = 1;
    private static final long TICK_MS = 1_000L;

    private TimerRepository repo;
    private boolean screenOn = true;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (!pushNotification()) return;
            if (screenOn) handler.postDelayed(this, TICK_MS);
        }
    };

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (Intent.ACTION_SCREEN_ON.equals(action)) {
                screenOn = true;
                startTicking();
            } else if (Intent.ACTION_SCREEN_OFF.equals(action)) {
                screenOn = false;
                handler.removeCallbacks(ticker);
            }
        }
    };

    public static void start(Context context) {
        Intent intent = new Intent(context, TimerService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(context, intent);
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, TimerService.class));
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        repo = TimerEnv.repo(this);
        TimerNotifications.ensureChannel(this);
        // 服务可能在灭屏时被系统重建，此时收不到 SCREEN_OFF，需要主动查一次
        android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
        screenOn = pm == null || pm.isInteractive();
        IntentFilter filter = new IntentFilter();
        filter.addAction(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        ContextCompat.registerReceiver(this, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_REFRESH : intent.getAction();

        TimerState state = repo.getState();
        if (!TimerState.STATUS_RUNNING.equals(state.status) || !state.notificationsEnabled) {
            stopSelf();
            return START_NOT_STICKY;
        }

        // 所有入口（包括通知栏冷启动触发的 LAP）都必须先进入前台，否则会触发
        // ForegroundServiceDidNotStartInTimeException。
        Notification notification = TimerNotifications.timer(this, state, System.currentTimeMillis());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        try {
            if (ACTION_LAP.equals(action)) {
                repo.lap(readReply(intent), "notification");
            } else if (ACTION_END_NAP.equals(action)) {
                repo.endNap();
            } else if (ACTION_END.equals(action)) {
                repo.endSession();
                stopSelf();
                return START_NOT_STICKY;
            }
        } catch (RuntimeException e) {
            // 通知可能尚未更新就被再次点击：拒绝旧动作，但不能让前台服务崩溃。
            android.util.Log.w("WakeTimer", "通知动作未完成", e);
            android.widget.Toast.makeText(this, "操作未完成：" + e.getMessage(),
                    android.widget.Toast.LENGTH_SHORT).show();
        }
        pushNotification();
        startTicking();
        return START_STICKY;
    }

    private void startTicking() {
        handler.removeCallbacks(ticker);
        if (screenOn) handler.post(ticker);
    }

    /** 刷新通知；返回 false 表示已不在计时，服务应停止。 */
    private boolean pushNotification() {
        TimerState state = repo.getState();
        if (!TimerState.STATUS_RUNNING.equals(state.status) || !state.notificationsEnabled) {
            stopSelf();
            return false;
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return false;
        // 同一 id 再 notify 一次：既能更新文字，也能关闭"直接回复"的输入框
        nm.notify(NOTIFICATION_ID, TimerNotifications.timer(this, state, System.currentTimeMillis()));
        return true;
    }

    private String readReply(Intent intent) {
        if (intent == null) return "";
        Bundle results = RemoteInput.getResultsFromIntent(intent);
        if (results == null) return "";
        CharSequence text = results.getCharSequence(EXTRA_NOTE);
        return text == null ? "" : text.toString().trim();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        try {
            unregisterReceiver(screenReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(NOTIFICATION_ID);
        super.onDestroy();
    }
}
