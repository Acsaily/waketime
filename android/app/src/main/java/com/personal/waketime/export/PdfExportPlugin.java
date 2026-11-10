package com.personal.waketime.export;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/** 生成 A4 PDF 并（可选）直接调系统分享面板。 */
@CapacitorPlugin(name = "PdfExport")
public class PdfExportPlugin extends Plugin {

    @PluginMethod
    public void export(PluginCall call) {
        try {
            String filename = call.getString("filename", "waketime.pdf");
            if (!filename.endsWith(".pdf")) filename = filename + ".pdf";
            JSArray blocks = call.getArray("blocks");
            if (blocks == null) {
                call.reject("缺少 blocks");
                return;
            }
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) {
                call.reject("无法创建导出目录");
                return;
            }
            File out = new File(dir, filename);
            PdfExporter.render(out, blocks);

            JSObject ret = new JSObject();
            ret.put("path", out.getAbsolutePath());
            ret.put("size", out.length());
            call.resolve(ret);

            Boolean share = call.getBoolean("share", Boolean.TRUE);
            if (Boolean.TRUE.equals(share)) {
                shareFile(out, filename);
            }
        } catch (Exception e) {
            call.reject("PDF 生成失败：" + e.getMessage());
        }
    }

    private void shareFile(File file, String filename) {
        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("application/pdf");
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, filename);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, "分享 PDF");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
        } catch (Exception e) {
            android.util.Log.w("PdfExport", "share failed", e);
        }
    }
}
