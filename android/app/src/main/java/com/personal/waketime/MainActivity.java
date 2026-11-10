package com.personal.waketime;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.personal.waketime.export.PdfExportPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeTimerPlugin.class);
        registerPlugin(PdfExportPlugin.class);
        super.onCreate(savedInstanceState);
        applySystemBarAppearance();
    }

    @Override
    public void onResume() {
        super.onResume();
        applySystemBarAppearance();
    }

    private void applySystemBarAppearance() {
        // target 36 强制边到边：不依赖已失效的 statusBarColor/退出边到边开关。
        // 与深蓝页面保持一致的底色 + 浅色系统图标，避免黑字落在深色背景上。
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.rgb(11, 18, 32)));
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            getWindow().setStatusBarContrastEnforced(false);
        }
    }
}
