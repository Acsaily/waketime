package com.personal.waketime.export;

import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;

import com.getcapacitor.JSArray;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * 用系统 PdfDocument 生成 A4 中文 PDF（系统字体，不嵌字体文件、无授权问题）。
 * 输入是 JS 侧排好序的块：title / h2 / row / para。
 */
public final class PdfExporter {
    private static final int PAGE_W = 595;
    private static final int PAGE_H = 842;
    private static final int MARGIN = 40;
    private static final int FOOTER_H = 26;

    private PdfExporter() {}

    public static void render(File outFile, JSArray blocks) throws Exception {
        PdfDocument document = new PdfDocument();
        Renderer r = new Renderer(document);
        r.begin();

        for (int i = 0; i < blocks.length(); i++) {
            JSONObject block = blocks.optJSONObject(i);
            if (block == null) continue;
            String kind = block.optString("kind", "para");
            String text = block.optString("text", "");
            switch (kind) {
                case "title":
                    r.drawLine(text, 19f, true, 0xFF111318, 3f, 10f);
                    break;
                case "h2":
                    r.drawLine(text, 12.5f, true, 0xFF2A3240, 2f, 12f);
                    break;
                case "row":
                    r.drawRow(text, block.optString("right", ""));
                    break;
                case "para":
                default:
                    r.drawLine(text, 10.5f, false, 0xFF5A6272, 1f, 4f);
                    break;
            }
        }

        r.finish();
        FileOutputStream fos = new FileOutputStream(outFile);
        document.writeTo(fos);
        fos.flush();
        fos.close();
        document.close();
    }

    private static final class Renderer {
        private final PdfDocument doc;
        private PdfDocument.Page page;
        private Canvas canvas;
        private int pageNo = 0;
        private float y = 0f;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint footPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final SimpleDateFormat stamp = new SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.CHINA);
        private final String generatedAt = stamp.format(new Date());

        Renderer(PdfDocument doc) {
            this.doc = doc;
            paint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
            footPaint.setColor(0xFF8A92A0);
            footPaint.setTextSize(8.5f);
            footPaint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        }

        void begin() {
            newPage();
        }

        private void newPage() {
            if (page != null) {
                drawFooter();
                doc.finishPage(page);
            }
            pageNo++;
            page = doc.startPage(new PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNo).create());
            canvas = page.getCanvas();
            canvas.drawColor(Color.WHITE);
            y = MARGIN;
        }

        private void ensure(float need) {
            if (y + need > PAGE_H - MARGIN - FOOTER_H) newPage();
        }

        private List<String> wrap(String text, float maxWidth) {
            List<String> lines = new ArrayList<>();
            for (String raw : text.split("\n", -1)) {
                if (raw.isEmpty()) {
                    lines.add("");
                    continue;
                }
                int start = 0;
                while (start < raw.length()) {
                    int count = paint.breakText(raw, start, raw.length(), true, maxWidth, null);
                    if (count <= 0) break;
                    lines.add(raw.substring(start, start + count));
                    start += count;
                }
            }
            if (lines.isEmpty()) lines.add("");
            return lines;
        }

        void drawLine(String text, float size, boolean bold, int color, float lineGap, float spaceAfter) {
            paint.setTextSize(size);
            paint.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL));
            paint.setColor(color);
            float lineHeight = size * 1.45f;
            List<String> lines = wrap(text, PAGE_W - MARGIN * 2f);
            for (String line : lines) {
                ensure(lineHeight);
                y += lineHeight;
                canvas.drawText(line, MARGIN, y, paint);
            }
            y += spaceAfter + lineGap;
        }

        void drawRow(String left, String right) {
            float size = 10.5f;
            paint.setTextSize(size);
            paint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
            paint.setColor(0xFF20242C);
            float rightWidth = right.isEmpty() ? 0f : paint.measureText(right) + 8f;
            float lineHeight = size * 1.45f;
            List<String> lines = wrap(left, PAGE_W - MARGIN * 2f - rightWidth);
            boolean first = true;
            for (String line : lines) {
                ensure(lineHeight);
                y += lineHeight;
                canvas.drawText(line, MARGIN, y, paint);
                if (first && !right.isEmpty()) {
                    Paint rightPaint = paint;
                    rightPaint.setColor(0xFF4C8DFF);
                    canvas.drawText(right, PAGE_W - MARGIN - paint.measureText(right), y, rightPaint);
                    rightPaint.setColor(0xFF20242C);
                    first = false;
                }
            }
            y += 3f;
        }

        void drawFooter() {
            String text = "清醒时光 · 第 " + pageNo + " 页 · 生成于 " + generatedAt;
            canvas.drawText(text, MARGIN, PAGE_H - MARGIN + 6f, footPaint);
        }

        void finish() {
            if (page != null) {
                drawFooter();
                doc.finishPage(page);
                page = null;
            }
        }
    }
}
