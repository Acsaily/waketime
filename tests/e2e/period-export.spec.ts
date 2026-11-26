import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { AppData } from '../../src/application/index';

const fixture: AppData = JSON.parse(
  readFileSync(new URL('../fixtures/schema-3.json', import.meta.url), 'utf8'),
);
const now = Date.parse('2026-11-12T12:00:00+08:00');

for (const viewport of [
  { width: 375, height: 812 },
  { width: 360, height: 800 },
]) {
  test.describe(`period export ${viewport.width}`, () => {
    test.use({ viewport, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
    test('quick fill, manual bounds, preview and actual downloaded records', async ({
      page,
    }, info) => {
      await page.clock.setFixedTime(now);
      await page.addInitScript(
        (data) => localStorage.setItem('waketime.data', JSON.stringify(data)),
        fixture,
      );
      await page.goto('/');
      await page.getByRole('button', { name: /设置/ }).click();
      const panel = page.getByRole('region', { name: '周期导出' });
      const start = panel.getByLabel('开始日期');
      const end = panel.getByLabel('结束日期');
      await panel.getByRole('button', { name: '本月' }).click();
      await expect(start).toHaveValue('2026-11-01');
      await expect(end).toHaveValue('2026-11-30');
      await panel.getByRole('button', { name: '本周' }).click();
      await expect(start).toHaveValue('2026-11-09');
      await expect(end).toHaveValue('2026-11-15');
      await end.fill('2026-11-09');
      const selected = fixture.cycles.filter((c) => c.id.startsWith('2026-11-09'));
      await expect(panel.getByText(`记录 1 天 · ${selected.length} 个周期`)).toBeVisible();
      await panel.scrollIntoViewIfNeeded();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
        .toBe(viewport.width);
      await expect(panel.getByText('12h', { exact: true })).toBeVisible();
      await expect(panel.getByText('9h', { exact: true })).toBeVisible();
      await panel.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await expect(panel.getByRole('button', { name: '周期 JSON' })).toBeInViewport();
      await page.screenshot({ path: info.outputPath('period-preview.png') });
      const before = await page.evaluate(() => localStorage.getItem('waketime.data'));
      const getJson = page.waitForEvent('download');
      await panel.getByRole('button', { name: '周期 JSON' }).click();
      const jsonDownload = await getJson;
      expect(jsonDownload.suggestedFilename()).toBe('waketime-period-2026-11-09_2026-11-09.json');
      const json = JSON.parse(readFileSync((await jsonDownload.path())!, 'utf8'));
      expect(json.cycles.map((c: { id: string }) => c.id)).toEqual(selected.map((c) => c.id));
      expect(json.exportedAtMs).toBe(now);
      expect(json.cycleSummaries).toHaveLength(selected.length);
      expect(
        json.cycleSummaries.reduce(
          (sum: number, c: { totalSleepMs: number }) => sum + c.totalSleepMs,
          0,
        ),
      ).toBe(12 * 3_600_000);
      expect(
        json.cycleSummaries.reduce((sum: number, c: { awakeMs: number }) => sum + c.awakeMs, 0),
      ).toBe(9 * 3_600_000);
      const getTxt = page.waitForEvent('download');
      await panel.getByRole('button', { name: '周期 TXT' }).click();
      const txtDownload = await getTxt;
      expect(txtDownload.suggestedFilename()).toBe('waketime-period-2026-11-09_2026-11-09.txt');
      const txt = readFileSync((await txtDownload.path())!, 'utf8');
      expect(txt).toContain(`1 天 / ${selected.length} 个周期；总睡眠 12h；实际清醒 9h`);
      for (const c of selected) expect(txt).toContain(`日期：${c.id}（`);
      expect(txt).not.toContain('日期：2026-11-10（');
      expect(await page.evaluate(() => localStorage.getItem('waketime.data'))).toBe(before);
      await panel.getByRole('button', { name: '周期 PDF' }).click();
      await expect(page.getByRole('alert')).toContainText('PDF 只能在手机上生成');
      await start.fill('2026-11-10');
      await expect(panel.getByText('开始日期不能晚于结束日期')).toBeVisible();
      await expect(panel.getByRole('button', { name: '周期 JSON' })).toBeDisabled();
      await end.fill('2026-11-10');
      await start.fill('2026-11-16');
      await end.fill('2026-11-16');
      await expect(panel.getByText('所选日期范围内没有记录')).toBeVisible();
      await expect(panel.getByRole('button', { name: '周期 TXT' })).toBeDisabled();
      await page.screenshot({ path: info.outputPath('period-empty.png') });
      await expect(page.getByRole('button', { name: '全量备份 JSON' })).toBeEnabled();
    });
  });
}
