import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { AppData } from '../../src/application/index';

const golden = (): AppData =>
  JSON.parse(readFileSync(new URL('../fixtures/schema-3.json', import.meta.url), 'utf8'));
const N = Date.parse('2026-11-12T12:00:00+08:00');

const original = golden();
const storageKey = 'waketime.data';

async function readRecords(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey) as Promise<
    ReturnType<typeof golden>
  >;
}

async function openApp(page: Page) {
  await page.clock.setFixedTime(N);
  await page.addInitScript(
    ({ key, data }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
    },
    { key: storageKey, data: original },
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: '录入昨晚的睡眠' })).toBeVisible();
}

async function noOverflow(page: Page) {
  // The slide-in animation briefly translates the panel; test the settled frame.
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe((await page.viewportSize())!.width);
}

// These browser paths are intentionally the same on v0.9.0 and the candidate.
// The browser does not own an active timer; native timer behavior is tested separately.
for (const viewport of [
  { width: 375, height: 812 },
  { width: 360, height: 800 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });

    test('history navigation, edit, split and merge persist the original interval', async ({
      page,
    }) => {
      await openApp(page);
      await page.getByRole('button', { name: '历史', exact: false }).click();
      await expect(page.getByRole('tab', { name: '周趋势' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await noOverflow(page);
      await page.getByRole('tab', { name: '周趋势' }).press('ArrowRight');
      await expect(page.getByRole('tab', { name: '每日明细' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await noOverflow(page);
      await page.locator('.history-month-pill').click();
      await page.getByRole('button', { name: '2026年11月，有记录' }).click();
      await page.locator('.history-cal-cell.has').filter({ hasText: /^9/ }).click();
      const first = page.getByRole('button', { name: /编辑第 1 段，工作，/ });
      await first.click();
      const editor = page.getByRole('dialog');
      await editor.getByLabel('备注（可留空）').fill('合成修改');
      await expect(editor.getByRole('button', { name: '拆分这一段' })).toBeDisabled();
      await editor.getByRole('button', { name: '保存分类与备注' }).click();
      await expect(editor).toHaveCount(0);
      await expect(first).toContainText('合成修改');
      await first.click();
      await editor.getByRole('button', { name: '拆分这一段' }).click();
      await editor.getByRole('button', { name: /添加分界点/ }).click();
      await editor.getByRole('button', { name: '预览拆分结果' }).click();
      await editor.getByRole('button', { name: '确认拆分并保存' }).click();
      await expect(editor).toHaveCount(0);
      const current = () =>
        readRecords(page).then(
          (data) => data.cycles.find((cycle) => cycle.id === '2026-11-09')!.session!.segments,
        );
      const before = original.cycles[0].session!.segments[0];
      const split = await current();
      expect(split).toHaveLength(6);
      expect(split[0].id).toBe('a');
      expect(split[0].startAtMs).toBe(before.startAtMs);
      expect(split[0].endAtMs).toBe(split[1].startAtMs);
      expect(split[1].endAtMs).toBe(before.endAtMs);
      await first.click();
      await editor.getByRole('button', { name: '合并后一段' }).click();
      await expect(editor.getByRole('button', { name: '直接确认合并' })).toBeDisabled();
      await editor
        .getByRole('group', { name: '选择分类' })
        .getByRole('button', { name: /工作/ })
        .click();
      const track = editor.locator('.merge-slide-track');
      await track.scrollIntoViewIfNeeded();
      const box = (await track.boundingBox())!;
      await page.mouse.move(box.x + 26, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 12, box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect(editor).toHaveCount(0);
      const merged = await current();
      expect(merged).toHaveLength(5);
      expect(merged[0]).toMatchObject({
        id: before.id,
        startAtMs: before.startAtMs,
        endAtMs: before.endAtMs,
        note: '合成修改',
      });
      await noOverflow(page);
      await page.reload();
      await page.getByRole('button', { name: '历史', exact: false }).click();
      await page.getByRole('tab', { name: '每日明细' }).click();
      await page.locator('.history-cal-cell.has').filter({ hasText: /^9/ }).click();
      await expect(page.getByRole('button', { name: /编辑第 1 段，工作，/ })).toContainText(
        '合成修改',
      );
    });

    test('statistics expand, drill down, allocate and manage categories', async ({ page }) => {
      await openApp(page);
      await page.getByRole('button', { name: '统计', exact: false }).click();
      const total = page.getByRole('button', { name: /总清醒时间，点击展开/ });
      await total.click();
      await expect(total).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByText('总睡眠时间', { exact: true })).toBeVisible();
      await total.click();
      await expect(total).toHaveAttribute('aria-expanded', 'false');
      await page.getByRole('button', { name: '月', exact: true }).click();
      await page.getByRole('button', { name: '年', exact: true }).click();
      await page.getByRole('button', { name: '周', exact: true }).click();
      await page.getByRole('button', { name: '查看工作的细分' }).click();
      await expect(page.getByText('工作的细分占比')).toBeVisible();
      await page.getByRole('button', { name: '‹ 全部大类' }).click();
      await page.getByRole('button', { name: '大类', exact: true }).click();
      await page.getByRole('button', { name: '单分类', exact: true }).click();
      await noOverflow(page);
      await page.getByRole('button', { name: '选择分类分配…' }).click();
      await page.getByRole('dialog').getByRole('button', { name: /日常/ }).click();
      await page.getByRole('button', { name: '确认分配' }).click();
      await expect(page.getByText('已把这段睡前时间分配到「日常」')).toBeVisible();
      expect(
        (await readRecords(page)).cycles.find((c) => c.id === '2026-11-10')!.session!.segments[0],
      ).toMatchObject({ id: 'g', category: 'daily', note: '合成G' });
      await page.getByRole('tab', { name: '分类管理' }).click();
      await noOverflow(page);
      await page.getByRole('button', { name: '收起工作的小标签' }).click();
      await expect(page.getByRole('button', { name: '修改学习颜色' })).toHaveCount(0);
      await page.getByRole('button', { name: '展开工作的小标签' }).click();
      await page.getByLabel('新分类名称').fill('合成子类');
      await page.getByLabel('新分类归属').selectOption('work');
      await page.getByRole('button', { name: '添加', exact: true }).click();
      await expect(page.getByRole('button', { name: '修改合成子类颜色' })).toBeVisible();
      await page.getByRole('button', { name: '修改合成子类颜色' }).click();
      await page.locator('.category-swatch').first().click();
      await expect(page.getByText('颜色已保存')).toBeVisible();
      await noOverflow(page);
      expect(
        (await readRecords(page)).settings.categories.find((c) => c.name === '合成子类'),
      ).toMatchObject({ parentId: 'work', archived: false });
      page.once('dialog', (dialog) => dialog.accept());
      await page
        .locator('.category-management-row')
        .filter({ has: page.getByRole('button', { name: '修改学习颜色' }) })
        .getByRole('button', { name: '删除' })
        .click();
      await expect(page.getByText('已从新记录选项中移除，历史引用仍保留')).toBeVisible();
      expect(
        (await readRecords(page)).settings.categories.find((c) => c.id === 'cat-study')?.archived,
      ).toBe(true);
    });

    test('settings notification preference, export and restore conflict confirmation', async ({
      page,
    }) => {
      await openApp(page);
      await page.getByRole('button', { name: '设置', exact: false }).click();
      await page.getByRole('button', { name: '申请通知权限' }).click();
      await expect(page.getByRole('alert')).toContainText('通知权限需要在手机上设置');
      await page.getByLabel('显示常驻通知（参考剩余 + 实际清醒）').check();
      await expect(page.getByText('常驻通知已开启')).toBeVisible();
      await page.getByLabel('新的常用备注').fill('合成新增词');
      await page.getByRole('button', { name: '添加', exact: true }).click();
      await expect(page.getByRole('button', { name: '删除常用备注 合成新增词' })).toBeVisible();
      await page.getByRole('button', { name: '导出 PDF' }).click();
      await expect(page.getByRole('alert')).toContainText('PDF 只能在手机上生成');
      const pendingDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: '全量备份 JSON' }).click();
      const download = await pendingDownload;
      expect(download.suggestedFilename()).toBe('waketime-backup-2026-11-12.json');
      await expect(page.getByText('已生成全量备份，选择保存位置或发给文件传输助手')).toBeVisible();
      const backup = golden();
      backup.settings.categories.find((c) => c.id === 'work')!.name = '合成备份类';
      await page.locator('input[type=file]').setInputFiles({
        name: 'synthetic.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(backup)),
      });
      const merge = page.getByRole('button', { name: '合并恢复' });
      await expect(merge).toBeDisabled();
      await page.getByLabel('分类冲突work').selectOption('backup');
      await expect(merge).toBeEnabled();
      page.once('dialog', (dialog) => dialog.dismiss());
      await page.getByRole('button', { name: /覆盖恢复/ }).click();
      await expect(merge).toBeVisible();
      await merge.click();
      await expect(page.getByText(/已合并恢复 4 个周期及分类目录/)).toBeVisible();
      const result = await readRecords(page);
      expect(result.cycles).toHaveLength(4);
      expect(result.settings.categories.find((c) => c.id === 'work')?.name).toBe('合成备份类');
      expect(result.settings.notificationsEnabled).toBe(true);
      expect(result.settings.quickNotes).toContain('合成新增词');
      await noOverflow(page);
    });
  });
}
