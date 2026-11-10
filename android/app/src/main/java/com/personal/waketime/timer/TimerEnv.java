package com.personal.waketime.timer;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.provider.Settings;

/** Android 环境实现：SharedPreferences 存储 + 系统时钟。 */
public final class TimerEnv {
    private static TimerRepository repository;

    private TimerEnv() {}

    public static synchronized TimerRepository repo(Context context) {
        if (repository == null) {
            Context app = context.getApplicationContext();
            repository = new TimerRepository(new PrefsStore(app), new SystemClockSource(app));
        }
        return repository;
    }

    private static final class PrefsStore implements TimerRepository.KeyValueStore {
        private final SharedPreferences prefs;

        PrefsStore(Context context) {
            prefs = context.getSharedPreferences("waketime_timer", Context.MODE_PRIVATE);
        }

        @Override
        public String get(String key, String defValue) {
            return prefs.getString(key, defValue);
        }

        @Override
        public void put(String key, String value) {
            prefs.edit().putString(key, value).commit();
        }
    }

    private static final class SystemClockSource implements TimerRepository.Clock {
        private final Context context;
        private String bootId;

        SystemClockSource(Context context) {
            this.context = context;
        }

        @Override
        public long wallMs() {
            return System.currentTimeMillis();
        }

        @Override
        public long monoMs() {
            return SystemClock.elapsedRealtime();
        }

        @Override
        public String bootId() {
            if (bootId != null) return bootId;
            try {
                bootId = String.valueOf(Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT));
            } catch (Throwable t) {
                bootId = "unknown";
            }
            return bootId;
        }
    }
}
