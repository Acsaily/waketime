import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Spacing regression guard for the Stats and History panels.
//
// The Stats panel renders the period bar and its cards as siblings inside
// .history-panel, while History renders its cards inside .history-week-panel /
// .history-month-panel. All of them must keep the project's card rhythm (12px)
// and leave the content clear of the fixed tab bar when scrolled to the end.
// These assertions are layout-level on purpose: same source, deterministic
// seed data, no screenshot diffing.

const storageKey = 'waketime.data';
const fixedNow = Date.parse('2026-11-12T12:00:00+08:00');
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/schema-3.json', import.meta.url), 'utf8'),
);

interface StackItem {
  cls: string;
  top: number;
  bottom: number;
}

async function openApp(page: Page) {
  await page.clock.setFixedTime(fixedNow);
  await page.addInitScript(
    ({ key, data }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
    },
    { key: storageKey, data: fixture },
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: '录入昨晚的睡眠' })).toBeVisible();
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

/** Visible direct children of a stacking container, in document order. */
async function readStack(page: Page, selector: string): Promise<StackItem[]> {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`missing ${sel}`);
    return [...root.children]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.height > 0 && getComputedStyle(el).display !== 'none';
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          cls: typeof el.className === 'string' ? el.className : el.tagName,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
  }, selector);
}

/** Every adjacent pair in the stack keeps the 12px card rhythm. */
function expectCardRhythm(stack: StackItem[], label: string) {
  expect(stack.length, `${label}: expected at least three stacked blocks`).toBeGreaterThanOrEqual(
    3,
  );
  for (let i = 1; i < stack.length; i += 1) {
    const gap = stack[i].top - stack[i - 1].bottom;
    const pair = `${label}: "${stack[i - 1].cls}" -> "${stack[i].cls}"`;
    // The history CTA deliberately adds 2px on top of the flex gap.
    const extra = stack[i].cls.split(/\s+/).includes('history-show-days') ? 2 : 0;
    expect(gap, `${pair} gap is ${gap}px`).toBeGreaterThanOrEqual(11.5);
    expect(gap, `${pair} gap is ${gap}px`).toBeLessThanOrEqual(12.5 + extra);
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  await settle(page);
  const width = (await page.viewportSize())!.width;
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
}

/** Scroll to the end and prove the last block clears the fixed tab bar. */
async function expectScrollsClearOfTabbar(page: Page, rootSelector: string, label: string) {
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  const state = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) throw new Error(`missing ${sel}`);
    return {
      scrollY,
      maxScroll: document.documentElement.scrollHeight - innerHeight,
      rootBottom: root.getBoundingClientRect().bottom,
      tabbarTop: document.querySelector('.tabbar')!.getBoundingClientRect().top,
    };
  }, rootSelector);
  expect(state.scrollY, `${label}: page should scroll`).toBeGreaterThan(0);
  expect(state.scrollY, `${label}: should reach the end`).toBeGreaterThanOrEqual(
    state.maxScroll - 1,
  );
  expect(
    state.rootBottom,
    `${label}: last block (${state.rootBottom}px) should end above the tab bar (${state.tabbarTop}px)`,
  ).toBeLessThanOrEqual(state.tabbarTop - 12);
}

for (const viewport of [
  { width: 375, height: 812 },
  { width: 360, height: 800 },
]) {
  test.describe(`${viewport.width}x${viewport.height} card spacing`, () => {
    test.use({ viewport, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });

    test('stats keeps the card rhythm and scrolls clear of the tab bar', async ({
      page,
    }, testInfo) => {
      await openApp(page);
      await page.getByRole('button', { name: '统计', exact: false }).click();
      await expect(page.getByRole('button', { name: /总清醒时间，点击展开/ })).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);

      const statsStack = await readStack(page, '.history-panel');
      expectCardRhythm(statsStack, 'stats');
      await expectNoHorizontalOverflow(page);

      await page.screenshot({
        path: testInfo.outputPath(`stats-${viewport.width}-top.png`),
      });

      // Expanding the overview grows the first card; the rhythm must hold.
      const overview = page.locator('.stats-overview');
      await overview.click();
      await expect(overview).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByText('总睡眠时间', { exact: true })).toBeVisible();
      await settle(page);
      const expandedStack = await readStack(page, '.history-panel');
      expectCardRhythm(expandedStack, 'stats-expanded');
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`stats-${viewport.width}-expanded.png`),
      });
      await overview.click();
      await expect(overview).toHaveAttribute('aria-expanded', 'false');

      await expectScrollsClearOfTabbar(page, '.history-panel', 'stats');
      await page.screenshot({
        path: testInfo.outputPath(`stats-${viewport.width}-bottom.png`),
      });
    });

    test('empty stats card uses the same panel gap', async ({ page }) => {
      await page.clock.setFixedTime(fixedNow);
      await page.addInitScript(
        ({ key, data }) => localStorage.setItem(key, JSON.stringify({ ...data, cycles: [] })),
        { key: storageKey, data: fixture },
      );
      await page.goto('/');
      await page.getByRole('button', { name: '统计', exact: false }).click();
      await expect(page.getByText('还没有可统计的记录')).toBeVisible();
      await settle(page);
      const stack = await readStack(page, '.history-panel');
      expect(stack).toHaveLength(2);
      expect(stack[1].top - stack[0].bottom).toBeCloseTo(12, 0);
      await expectNoHorizontalOverflow(page);
    });

    test('history week and day panels keep the card rhythm and scroll', async ({
      page,
    }, testInfo) => {
      await openApp(page);
      await page.getByRole('button', { name: '历史', exact: false }).click();
      await expect(page.getByRole('tab', { name: '周趋势' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      await settle(page);

      const weekStack = await readStack(page, '.history-week-panel');
      expectCardRhythm(weekStack, 'history-week');
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`history-week-${viewport.width}-top.png`),
      });

      await expectScrollsClearOfTabbar(page, '.history-panel', 'history-week');
      await page.screenshot({
        path: testInfo.outputPath(`history-week-${viewport.width}-bottom.png`),
      });

      // Switching panels resets the shared page scroll to the top.
      await page.getByRole('tab', { name: '每日明细' }).click();
      await expect(page.getByRole('tab', { name: '每日明细' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await settle(page);

      const dayStack = await readStack(page, '.history-month-panel');
      expectCardRhythm(dayStack, 'history-days');
      await expectNoHorizontalOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`history-days-${viewport.width}-top.png`),
      });

      await expectScrollsClearOfTabbar(page, '.history-panel', 'history-days');
      await page.screenshot({
        path: testInfo.outputPath(`history-days-${viewport.width}-bottom.png`),
      });
    });
  });
}
