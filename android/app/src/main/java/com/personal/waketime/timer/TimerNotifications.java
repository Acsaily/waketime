package com.personal.waketime.timer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.personal.waketime.MainActivity;
import com.personal.waketime.R;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * 一条常驻通知，主角是"已清醒"秒表 + 计次：
 *  - 标题显示 已清醒 HH:MM:SS（服务亮屏时每秒更新一次；灭屏不更新，省电）
 *  - 正文显示 已完成清醒段 N 段 · 参考剩余（倒计时只是参考）
 *  - 动作：计次并备注（RemoteInput，通知栏里直接打字）/ 结束计时
 *
 * 为什么不用系统 Chronometer：Chronometer 必须把 when 设成醒来时刻（今早 7 点），
 * HyperOS 会按这个时间给通知排序，导致通知沉到列表很下面；而且两条通知会被折叠成
 * 一张卡、折叠后 Chronometer 不显示（实测四种方案都试过）。所以改成"每秒更新文字"，
 * 并把 when 设成当前时间，让通知一直排在最上面。
 */
public final class TimerNotifications {
    public static final String CHANNEL_ID = "waketime_timer";

    private TimerNotifications() {}

    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = context.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "清醒计时", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("已清醒多久的常驻通知（可计次备注）");
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        nm.createNotificationChannel(channel);
    }

    static PendingIntent openApp(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(context, 10, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent action(Context context, String action, int requestCode, boolean mutable) {
        Intent intent = new Intent(context, TimerService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (mutable ? PendingIntent.FLAG_MUTABLE : PendingIntent.FLAG_IMMUTABLE);
        return PendingIntent.getForegroundService(context, requestCode, intent, flags);
    }

    public static Notification timer(Context context, TimerState state, long nowMs) {
        long remaining = TimerMath.remainingMs(state.targetAtMs, nowMs);
        long awake = TimerMath.awakeMs(state, nowMs);
        long sinceWake = Math.max(0L, nowMs - state.wakeAtMs);
        int count = state.closedCount();
        String cutoff = hhmm(state.targetAtMs);
        String reference = remaining > 0 ? "参考剩余 " + hms(remaining) : "已超时 " + hms(-remaining);
        boolean napping = state.isNapping();
        String title = napping ? "补觉中 · 已清醒 " + hms(awake)
                : remaining <= 0 ? "已超时 " + hms(-remaining) : "已清醒 " + hms(awake);
        String body = "已完成清醒段 " + count + " 段 · " + reference;
        String detail = body + " · 参考截止 " + cutoff
                + "\n实际清醒 " + hms(awake) + " · 距起床 " + hms(sinceWake)
                + "\n" + (napping ? "补觉不计入清醒时长，参考截止不顺延；请点「结束补觉」"
                : "点「计次」切一段，分类与备注回 App 补");
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_waketime)
                .setContentTitle(title)
                .setContentText(body)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setWhen(nowMs)
                .setShowWhen(true)
                .setContentIntent(openApp(context))
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(detail));

        // 补觉时不暴露计次动作；旧通知遗留的计次 Intent 也由 Repository 拒绝。
        b.addAction(new NotificationCompat.Action.Builder(
                R.drawable.ic_stat_waketime, napping ? "结束补觉" : "计次",
                action(context, napping ? TimerService.ACTION_END_NAP : TimerService.ACTION_LAP,
                        napping ? 23 : 21, false)).build());
        b.addAction(new NotificationCompat.Action.Builder(
                R.drawable.ic_stat_waketime, "结束计时", action(context, TimerService.ACTION_END, 22, false)).build());
        return b.build();
    }

    static String hhmm(long ms) {
        return new SimpleDateFormat("HH:mm", Locale.CHINA).format(new Date(ms));
    }

    static String hms(long ms) {
        long total = Math.abs(ms) / 1000L;
        return String.format(Locale.CHINA, "%02d:%02d:%02d", total / 3600, (total % 3600) / 60, total % 60);
    }
}
