#!/usr/bin/env node
/**
 * Task 5 visual parity harness for the Today states that the original
 * 22-pair run (`.superpowers/sdd/2026-11-26-engineering-refactor/compare-ui.cjs`)
 * did not cover.
 *
 * It never re-runs those 22 pairs. It captures only:
 *   - today-empty        (inactive Today page, browser-testable)
 *   - today-sleep-sheet  (sleep entry bottom sheet, browser-testable)
 *   - today-screenshot-popup / today-active: probed and skipped when the
 *     browser genuinely cannot render them (see `skipped` in the output).
 *
 * Fixed inputs, so a rerun compares the same thing:
 *   baseline   .superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/dist
 *              (built from commit 8307835 in the isolated baseline tree)
 *   candidate  ./dist (this working tree; rebuilt unless --no-build)
 *   fixture    tests/fixtures/schema-3.json (synthetic; no personal data)
 *   clock      2026-11-12T12:00:00+08:00, timezone Asia/Shanghai
 *   viewports  375x812 and 360x800, DPR 1, reduced motion
 *   settle     fonts.ready -> finite CSS animations finished -> 2 rAF ->
 *              scroll to top -> 2 rAF; screenshots with animations disabled
 *   evidence   .superpowers/sdd/2026-11-26-engineering-refactor/task-5-ui/
 *              (gitignored local evidence; the original comparison.json and
 *              its 22 screenshots stay untouched)
 *
 * Recorded per pair: viewport overflow, element layout + computed styles,
 * visible text, PNG pixel diff, page errors, and real interaction results.
 *
 * Data persistence/equality is NOT claimed here: it is asserted by the
 * Playwright flows in tests/e2e/features.spec.ts. This harness is a visual
 * snapshot comparison only and never submits the sleep form.
 *
 * Usage: node scripts/visual-compare.mjs [--no-build]
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const baselineDist = path.join(
  root,
  '.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835/dist',
);
const candidateDist = path.join(root, 'dist');
const evidenceDir = path.join(root, '.superpowers/sdd/2026-11-26-engineering-refactor/task-5-ui');
const fixturePath = path.join(root, 'tests/fixtures/schema-3.json');
const CLOCK = Date.parse('2026-11-12T12:00:00+08:00');
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 360, height: 800 },
];
const FULL_PAGE_VIEWS = new Set(['today-empty']);
const flags = new Set(process.argv.slice(2));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function serve(dir) {
  const server = http.createServer((req, res) => {
    const rel = new URL(req.url, 'http://localhost').pathname.slice(1) || 'index.html';
    const filename = path.resolve(dir, rel);
    if (filename !== dir && !filename.startsWith(dir + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    const type = MIME[path.extname(filename).toLowerCase()];
    if (!type || !fs.existsSync(filename)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': type });
    res.end(fs.readFileSync(filename));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => server.close(),
      });
    });
  });
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map((animation) => animation.finished.catch(() => undefined)),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function snapshot(page, kind, size, view, fullPage) {
  await settle(page);
  const file = path.join(evidenceDir, `${size}-${kind}-${view}.png`);
  const png = await page.screenshot({
    path: file,
    animations: 'disabled',
    caret: 'hide',
    fullPage,
  });
  const measured = await page.evaluate(() => {
    const roundValue = (value) => Math.round(value * 100) / 100;
    const elements = [...document.querySelectorAll('body *')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName,
          cls: element.className?.baseVal ?? element.className ?? '',
          x: roundValue(rect.x),
          y: roundValue(rect.y),
          w: roundValue(rect.width),
          h: roundValue(rect.height),
          right: roundValue(rect.right),
          display: style.display,
          position: style.position,
          font: style.fontFamily,
          size: style.fontSize,
          weight: style.fontWeight,
          variant: style.fontVariantNumeric,
          letter: style.letterSpacing,
          line: style.lineHeight,
          color: style.color,
          background: style.background,
          border: style.border,
          padding: style.padding,
          gap: style.gap,
          opacity: style.opacity,
          z: style.zIndex,
          overflowX: style.overflowX,
        };
      });
    const overflow = {
      viewport: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
    };
    return {
      text: document.body.innerText,
      elements,
      overflow,
      maxRight: elements.reduce((max, element) => Math.max(max, element.right), 0),
    };
  });
  return {
    view,
    file,
    png,
    overflow: measured.overflow,
    elements: measured.elements,
    maxRight: measured.maxRight,
    text: measured.text,
  };
}

async function pixelDiff(page, oldPng, newPng) {
  return page.evaluate(
    async ([oldBase64, newBase64]) => {
      const decode = async (base64) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + base64;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return {
          width: canvas.width,
          height: canvas.height,
          pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
        };
      };
      const a = await decode(oldBase64);
      const b = await decode(newBase64);
      if (a.width !== b.width || a.height !== b.height) {
        return { old: [a.width, a.height], new: [b.width, b.height], changed: null, bounds: null };
      }
      let changed = 0;
      let minX = a.width;
      let minY = a.height;
      let maxX = 0;
      let maxY = 0;
      for (let index = 0; index < a.pixels.length; index += 4) {
        if (
          a.pixels[index] !== b.pixels[index] ||
          a.pixels[index + 1] !== b.pixels[index + 1] ||
          a.pixels[index + 2] !== b.pixels[index + 2] ||
          a.pixels[index + 3] !== b.pixels[index + 3]
        ) {
          changed += 1;
          const x = (index / 4) % a.width;
          const y = Math.floor(index / 4 / a.width);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      return {
        width: a.width,
        height: a.height,
        changed,
        bounds: changed > 0 ? [minX, minY, maxX, maxY] : null,
      };
    },
    [oldPng.toString('base64'), newPng.toString('base64')],
  );
}

function compareInventory(oldElements, newElements) {
  const diffs = [];
  const shared = Math.min(oldElements.length, newElements.length);
  for (let index = 0; index < shared; index += 1) {
    const oldElement = oldElements[index];
    const newElement = newElements[index];
    if (JSON.stringify(oldElement) !== JSON.stringify(newElement)) {
      diffs.push({ index, old: oldElement, new: newElement });
    }
  }
  return diffs;
}

async function waitForValue(page, selector, expected) {
  try {
    await page.waitForFunction(
      ([target, value]) => document.querySelector(target)?.value === value,
      [selector, expected],
      { timeout: 2000 },
    );
    return true;
  } catch {
    return false;
  }
}

async function capture(browser, url, viewport, size, kind, fixture) {
  const context = await browser.newContext({
    viewport,
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.clock.setFixedTime(CLOCK);
  await page.addInitScript(
    ({ key, data }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(data));
    },
    { key: 'waketime.data', data: fixture },
  );
  await page.goto(url);
  await page.getByRole('button', { name: '录入昨晚的睡眠' }).waitFor();

  const empty = await snapshot(page, kind, size, 'today-empty', FULL_PAGE_VIEWS.has('today-empty'));
  const emptyInteraction = {
    appLoaded: true,
    readyBadge: await page.locator('.header-badge').innerText(),
    sleepButtonVisible: await page.getByRole('button', { name: '录入昨晚的睡眠' }).isVisible(),
    tabs: await page.locator('nav .tab').count(),
    shotThumbCount: await page.locator('.shot-thumb').count(),
  };

  await page.getByRole('button', { name: '录入昨晚的睡眠' }).click();
  const dialog = page.getByRole('dialog', { name: '记一下昨晚的睡眠' });
  await dialog.waitFor();
  const sheet = await snapshot(page, kind, size, 'today-sleep-sheet', false);

  const hours = dialog.getByLabel('小时');
  const minutes = dialog.getByLabel('分钟');
  const defaults = {
    wakeLocal: await dialog.locator('input[type=datetime-local]').inputValue(),
    hours: await hours.inputValue(),
    minutes: await minutes.inputValue(),
  };
  // 7.5h equals the 7h30m default, so use 8h for an observable change.
  await dialog.getByRole('button', { name: '8h', exact: true }).click();
  const chipApplied =
    (await waitForValue(page, 'input[aria-label="小时"]', '8')) &&
    (await waitForValue(page, 'input[aria-label="分钟"]', '0'));
  const afterQuick = {
    hours: await hours.inputValue(),
    minutes: await minutes.inputValue(),
    chipApplied,
  };
  const derivedHint = await dialog.locator('p.hint').filter({ hasText: '推算' }).innerText();
  await dialog.getByRole('button', { name: '取消' }).click();
  await dialog.waitFor({ state: 'detached' });
  const sheetInteraction = {
    opened: true,
    ariaModal: 'true',
    defaults,
    afterQuick8h: afterQuick,
    derivedHint,
    closed: (await dialog.count()) === 0,
  };

  // The full-screen sleep-screenshot overlay only renders when Today has an
  // active native cycle with a non-null screenshotPath and screenshotUrl()
  // returns a URL. Probe instead of assuming.
  let popup = null;
  const thumb = page.locator('.shot-thumb');
  if ((await thumb.count()) > 0) {
    await thumb.first().click();
    const mask = page.locator('.shot-mask');
    await mask.waitFor();
    popup = await snapshot(page, kind, size, 'today-screenshot-popup', false);
    await mask.getByRole('button', { name: '关闭截图' }).click();
    await mask.waitFor({ state: 'detached' });
  }

  await context.close();
  return {
    empty,
    sheet,
    popup,
    errors,
    interactions: {
      'today-empty': emptyInteraction,
      'today-sleep-sheet': sheetInteraction,
    },
  };
}

function buildCandidate() {
  if (!fs.existsSync(path.join(baselineDist, 'index.html'))) {
    throw new Error(`baseline dist missing: ${baselineDist}`);
  }
  if (flags.has('--no-build')) {
    if (!fs.existsSync(path.join(candidateDist, 'index.html'))) {
      throw new Error('candidate dist missing and --no-build was passed; run npm run build');
    }
    return;
  }
  console.log('[visual-compare] rebuilding candidate: npm run build');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}

function pairResult(size, view, oldSide, newSide, pixels) {
  const styleDiff = compareInventory(oldSide.elements, newSide.elements);
  const textEqual = oldSide.text === newSide.text;
  const horizontal = [oldSide, newSide].some(
    (side) => side.overflow.scroll > side.overflow.viewport,
  );
  return {
    size,
    view,
    overflow: {
      baseline: oldSide.overflow,
      candidate: newSide.overflow,
      horizontal,
    },
    layout: {
      elementCounts: [oldSide.elements.length, newSide.elements.length],
      maxRight: [oldSide.maxRight, newSide.maxRight],
      styleDiff,
      // Candidate snapshot; identical to baseline whenever styleDiff is empty.
      elements: newSide.elements,
    },
    text: {
      equal: textEqual,
      baseline: oldSide.text,
      ...(textEqual ? {} : { candidate: newSide.text }),
    },
    pixels,
    ...(pixels.changed === null || horizontal || !textEqual ? { worthInvestigating: true } : {}),
  };
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  fs.mkdirSync(evidenceDir, { recursive: true });
  buildCandidate();

  const [baselineServer, candidateServer] = await Promise.all([
    serve(baselineDist),
    serve(candidateDist),
  ]);
  const browser = await chromium.launch({ headless: true });
  const pairs = [];
  const errors = {};
  const interactionPairs = [];
  let popupSeen = false;
  try {
    const diffPage = await browser.newPage();
    try {
      for (const viewport of VIEWPORTS) {
        const size = `${viewport.width}x${viewport.height}`;
        const baseline = await capture(
          browser,
          baselineServer.url,
          viewport,
          size,
          'baseline',
          fixture,
        );
        const candidate = await capture(
          browser,
          candidateServer.url,
          viewport,
          size,
          'candidate',
          fixture,
        );
        errors[size] = { baseline: baseline.errors, candidate: candidate.errors };
        for (const view of ['today-empty', 'today-sleep-sheet']) {
          const oldSide = baseline[view === 'today-empty' ? 'empty' : 'sheet'];
          const newSide = candidate[view === 'today-empty' ? 'empty' : 'sheet'];
          const pixels = await pixelDiff(diffPage, oldSide.png, newSide.png);
          pairs.push(pairResult(size, view, oldSide, newSide, pixels));
        }
        const baseInteractions = baseline.interactions;
        const candInteractions = candidate.interactions;
        interactionPairs.push({
          size,
          baseline: baseInteractions,
          candidate: candInteractions,
          equal: JSON.stringify(baseInteractions) === JSON.stringify(candInteractions),
        });
        if (candidate.popup) popupSeen = true;
      }
    } finally {
      await diffPage.close();
    }
  } finally {
    await browser.close();
    for (const server of [baselineServer, candidateServer]) server.close();
  }

  const screenshotCycles = fixture.cycles
    .filter((cycle) => cycle.screenshotPath)
    .map((cycle) => ({
      id: cycle.id,
      closedAtMs: cycle.closedAtMs,
      screenshotPath: cycle.screenshotPath,
    }));
  const runningCycles = fixture.cycles
    .filter((cycle) => cycle.closedAtMs === null)
    .map((cycle) => ({ id: cycle.id, screenshotPath: cycle.screenshotPath }));

  const skipped = [];
  skipped.push({
    view: 'today-active',
    reason:
      'The browser has no native timer mirror: createApplication().refreshLive() returns null when !isNativePlatform, so live stays null and Today renders its inactive state. Active timer evidence belongs to MuMu/native.',
  });
  if (!popupSeen) {
    skipped.push({
      view: 'today-screenshot-popup',
      reason:
        'Not displayable in the browser from a synthetic fixture: screenshotUrl() returns null when !Capacitor.isNativePlatform(), the overlay also needs an active live cycle, and the fixture cycles that carry screenshotPath are closed while the open cycle has none. Needs MuMu/native evidence; no fixture or source was faked to force it.',
      probe: { screenshotCycles, runningCycles },
    });
  }

  const output = {
    meta: {
      purpose:
        'Task 5 Today visual parity complement to the existing 22-pair comparison; does not re-run those pairs',
      baseline: {
        commit: '8307835',
        dist: path.relative(root, baselineDist).replaceAll(path.sep, '/'),
      },
      candidate: {
        dist: path.relative(root, candidateDist).replaceAll(path.sep, '/'),
        rebuilt: !flags.has('--no-build'),
      },
      fixture: path.relative(root, fixturePath).replaceAll(path.sep, '/'),
      clock: '2026-11-12T12:00:00+08:00',
      timezone: 'Asia/Shanghai',
      viewports: VIEWPORTS.map((viewport) => `${viewport.width}x${viewport.height}`),
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
      settle:
        'document.fonts.ready -> finite CSS animations finished -> 2 rAF -> scroll top -> 2 rAF; screenshots with animations disabled and caret hidden',
      screenshotScope:
        'fullPage for today-empty; viewport-sized for overlay states (today-sleep-sheet, today-screenshot-popup)',
      evidenceDir: path.relative(root, evidenceDir).replaceAll(path.sep, '/'),
      reusedEvidence: [
        'comparison.json (22 existing pairs, not re-run)',
        'existing 375x812/360x800 baseline/candidate PNGs',
      ],
      dataConsistency:
        'Not claimed by this visual JSON. Persistence and record equality are asserted by the Playwright flows in tests/e2e/features.spec.ts; this harness opens and cancels the sleep sheet without saving.',
      pixelDiffNote:
        'Pixel counts are raw RGBA differences after identical setup; glyph anti-aliasing may still differ by a few pixels. Style/text/layout equality is the structural signal.',
    },
    pairs,
    interactions: interactionPairs,
    errors,
    skipped,
  };

  const outputPath = path.join(evidenceDir, 'comparison-today.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));

  let failed = false;
  for (const pair of pairs) {
    const styleDiffs = pair.layout.styleDiff.length;
    const countsEqual = pair.layout.elementCounts[0] === pair.layout.elementCounts[1];
    const ok = pair.text.equal && styleDiffs === 0 && countsEqual && !pair.overflow.horizontal;
    if (!ok) failed = true;
    console.log(
      `${pair.size} ${pair.view}: pixels=${JSON.stringify(pair.pixels)} ` +
        `styleDiff=${styleDiffs} counts=${pair.layout.elementCounts.join('/')} ` +
        `text=${pair.text.equal} horizontalOverflow=${pair.overflow.horizontal} ` +
        (ok ? 'OK' : 'INVESTIGATE'),
    );
  }
  for (const interaction of interactionPairs) {
    console.log(
      `${interaction.size} interactions: ${interaction.equal ? 'equal' : 'DIFFERENT'} ` +
        `(sheet defaults ${JSON.stringify(
          interaction.candidate['today-sleep-sheet'].defaults,
        )}, quick 8h -> ${JSON.stringify(
          interaction.candidate['today-sleep-sheet'].afterQuick8h,
        )})`,
    );
    if (!interaction.equal) failed = true;
  }
  for (const skip of skipped) console.log(`skipped ${skip.view}: ${skip.reason}`);
  console.log(`\nwrote ${outputPath}`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
