// Fresh-tree observation and bounded input for the MuMu E2E harness.
//
// Observe = one unique UIAutomator dump + one screenshot. A tap is only issued
// from bounds in that fresh tree, re-verified against the screenshot dimensions
// and the device identity immediately before input. If the tree is unavailable
// or ambiguous, the harness returns `needs-agent-visual` with a screenshot
// instead of guessing coordinates. Complex gestures may use the visual path,
// but only from the latest screenshot of the current evidence run, within a
// short age limit, and never from an unrecorded fixed coordinate.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { MumuGuardError, decodeText, sleepMs } from './mumu-guard.mjs';

export class TreeParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TreeParseError';
  }
}

export function decodeXmlEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributes(text) {
  const attributes = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_:.-]*)="([^"]*)"/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }
  return attributes;
}

export function parseBounds(value) {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(String(value ?? '').trim());
  if (!match) return null;
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  return {
    x1,
    y1,
    x2,
    y2,
    width,
    height,
    centerX: x1 + Math.floor(width / 2),
    centerY: y1 + Math.floor(height / 2),
  };
}

/** Parse a complete UIAutomator XML dump; reject empty or truncated output. */
export function parseUiTree(xmlText) {
  const text = decodeText(xmlText);
  if (!text.trim()) throw new TreeParseError('empty tree');
  if (!text.includes('</hierarchy>'))
    throw new TreeParseError('truncated tree (no closing hierarchy)');
  const hierarchy = /<hierarchy\b([^>]*)>/.exec(text);
  if (!hierarchy) throw new TreeParseError('missing hierarchy element');
  const rootAttributes = parseAttributes(hierarchy[1]);
  const rotation = Number(rootAttributes.rotation ?? 0);
  const nodes = [];
  const nodePattern = /<node\b([^>]*?)\/?>/g;
  let match;
  while ((match = nodePattern.exec(text)) !== null) {
    const attributes = parseAttributes(match[1]);
    const bounds = parseBounds(attributes.bounds);
    nodes.push({
      text: attributes.text ?? '',
      contentDesc: attributes['content-desc'] ?? '',
      resourceId: attributes['resource-id'] ?? '',
      className: attributes.class ?? '',
      package: attributes.package ?? '',
      clickable: attributes.clickable === 'true',
      enabled: attributes.enabled !== 'false',
      selected: attributes.selected === 'true',
      bounds,
      attributeCount: Object.keys(attributes).length,
    });
  }
  if (nodes.length === 0) throw new TreeParseError('tree contains no nodes');
  return { rotation, nodes, nodeCount: nodes.length, rawLength: text.length };
}

export function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    throw new MumuGuardError('SCREENSHOT_INVALID', 'screenshot is too short to be PNG');
  }
  const signature = buffer.subarray(0, 8);
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(expected)) {
    throw new MumuGuardError(
      'SCREENSHOT_INVALID',
      'screenshot does not start with a PNG signature',
    );
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new MumuGuardError('SCREENSHOT_INVALID', `invalid PNG dimensions ${width}x${height}`);
  }
  return { width, height };
}

export function findMatches(nodes, selector) {
  const criteria = [];
  if (typeof selector.text === 'string') criteria.push((node) => node.text === selector.text);
  if (typeof selector.textContains === 'string')
    criteria.push((node) => node.text.includes(selector.textContains));
  if (typeof selector.contentDesc === 'string')
    criteria.push((node) => node.contentDesc === selector.contentDesc);
  if (typeof selector.contentDescContains === 'string')
    criteria.push((node) => node.contentDesc.includes(selector.contentDescContains));
  if (typeof selector.resourceId === 'string')
    criteria.push((node) => node.resourceId === selector.resourceId);
  if (typeof selector.className === 'string')
    criteria.push((node) => node.className === selector.className);
  if (criteria.length === 0) {
    throw new MumuGuardError(
      'SELECTOR_EMPTY',
      'selector needs at least one text/desc/id/class criterion',
    );
  }
  return nodes.filter((node) => {
    if (!criteria.every((test) => test(node))) return false;
    if (selector.clickable !== undefined && node.clickable !== selector.clickable) return false;
    if (selector.enabled === undefined) {
      if (!node.enabled) return false;
    } else if (node.enabled !== selector.enabled) {
      return false;
    }
    if (
      selector.hasBounds !== false &&
      (!node.bounds || node.bounds.width <= 0 || node.bounds.height <= 0)
    ) {
      return false;
    }
    return true;
  });
}

/** Find matches, preferring the single clickable node when text is duplicated. */
export function narrowMatches(nodes, selector) {
  const matches = findMatches(nodes, selector);
  if (matches.length <= 1) return matches;
  const clickable = matches.filter((node) => node.clickable);
  return clickable.length === 1 ? clickable : matches;
}

function labelsOf(nodes) {
  const labels = new Set();
  for (const node of nodes) {
    if (node.text) labels.add(node.text);
    if (node.contentDesc) labels.add(node.contentDesc);
  }
  return labels;
}

function missingExpectations(observation, expectText = [], expectContains = []) {
  const labels = labelsOf(observation.nodes);
  return {
    missingText: expectText.filter((text) => !labels.has(text)),
    missingContains: expectContains.filter(
      (fragment) => ![...labels].some((label) => label.includes(fragment)),
    ),
  };
}

function safeSlug(value) {
  const slug = String(value ?? 'step')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'step';
}

function scanIndex(directory) {
  let maximum = 0;
  try {
    for (const name of readdirSync(directory)) {
      const match = /^(\d{3,})-/.exec(name);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    }
  } catch {
    // Directory may not exist yet.
  }
  return maximum + 1;
}

function writeArtifactPair(directory, slug, png, xml) {
  mkdirSync(directory, { recursive: true });
  const index = scanIndex(directory);
  const prefix = String(index).padStart(3, '0');
  const safe = safeSlug(slug);
  const pngPath = path.join(directory, `${prefix}-${safe}.png`);
  writeFileSync(pngPath, png);
  let xmlPath = null;
  if (xml) {
    xmlPath = path.join(directory, `${prefix}-${safe}.xml`);
    writeFileSync(xmlPath, xml);
  }
  return { pngPath, xmlPath };
}

function writeState(directory, state) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'last-observation.json'),
    `${JSON.stringify(state, null, 2)}\n`,
  );
}

export function readObservationState(evidenceDir) {
  try {
    return JSON.parse(readFileSync(path.join(evidenceDir, 'last-observation.json'), 'utf8'));
  } catch {
    return null;
  }
}

function summarizeMatches(matches) {
  return matches.slice(0, 10).map((node) => ({
    label: node.text || node.contentDesc || node.resourceId || node.className,
    className: node.className,
    bounds: node.bounds,
    clickable: node.clickable,
  }));
}

function withinEvidence(filePath, evidenceDir) {
  const relative = path.relative(path.resolve(evidenceDir), path.resolve(filePath));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

const FOREGROUND_PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;

function normalizeAllowedForeground(allowedForeground) {
  if (allowedForeground === undefined || allowedForeground === null) return [];
  const values = Array.isArray(allowedForeground) ? allowedForeground : [allowedForeground];
  for (const value of values) {
    if (typeof value !== 'string' || !FOREGROUND_PACKAGE.test(value)) {
      throw new MumuGuardError(
        'VISUAL_FOREGROUND',
        `invalid allowed foreground package: ${JSON.stringify(value)}`,
      );
    }
  }
  return values;
}

export function createObserver(device, options) {
  const evidenceDir = path.resolve(options.evidenceDir);
  const packageName = options.packageName ?? device.packageName;
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? sleepMs;

  // Pointer input is only safe when the intended window owns focus. A fresh
  // tree alone does not prove that (a system chooser or notification shade can
  // overlay the app), so tap/swipe/scroll are gated on the focused package. The
  // default allowlist is the test package; intentional system surfaces must
  // declare their package explicitly, e.g. ["com.android.systemui"].
  function foregroundStatus(allowedForeground, context) {
    const allowed = normalizeAllowedForeground(allowedForeground);
    const effective = allowed.length > 0 ? allowed : [packageName];
    let current;
    try {
      current = device.foregroundPackage();
    } catch {
      current = null;
    }
    if (!current) {
      return {
        ok: false,
        current: null,
        allowed: effective,
        reason: `${context}: foreground package is unknown; refusing input`,
      };
    }
    if (!effective.includes(current)) {
      return {
        ok: false,
        current,
        allowed: effective,
        reason: `${context}: focused package ${current} is not allowed (${effective.join(', ')})`,
      };
    }
    return { ok: true, current, allowed: effective, reason: null };
  }

  function observe(request = {}) {
    device.verifyIdentity();
    const name = request.name ?? 'observe';
    const remote = `/data/local/tmp/waketime-mumu-${randomBytes(8).toString('hex')}.xml`;
    let dumpStatus;
    let dumpText;
    let tree = null;
    let parseError = null;
    let xmlText = null;
    try {
      device.shell(['rm', '-f', remote], {
        tolerateFailure: true,
        allowInternalRm: true,
        timeoutMs: 10_000,
      });
      const dump = device.shell(['uiautomator', 'dump', '--compressed', remote], {
        tolerateFailure: true,
        timeoutMs: 30_000,
      });
      dumpStatus = dump.status;
      dumpText = decodeText(dump.stdout).trim();
      const cat = device.execOut(['cat', remote], { tolerateFailure: true, timeoutMs: 15_000 });
      if (cat.status === 0 && cat.stdout.length > 0) {
        xmlText = decodeText(cat.stdout);
        try {
          tree = parseUiTree(xmlText);
        } catch (error) {
          parseError = error instanceof Error ? error.message : String(error);
        }
      } else {
        parseError = 'dump file was not readable';
      }
    } finally {
      device.shell(['rm', '-f', remote], {
        tolerateFailure: true,
        allowInternalRm: true,
        timeoutMs: 10_000,
      });
    }

    const screenshot = device.execOut(['screencap', '-p'], { timeoutMs: 30_000 });
    const { width, height } = pngSize(screenshot.stdout);
    const paths = writeArtifactPair(evidenceDir, name, screenshot.stdout, xmlText);
    const packagePresent = tree ? tree.nodes.some((node) => node.package === packageName) : false;
    const warnings = [];
    if (dumpStatus !== 0 && tree) {
      warnings.push(`uiautomator exited ${dumpStatus} but wrote a fresh parseable tree`);
    }
    if (dumpStatus !== 0 && !tree) warnings.push(`uiautomator exited ${dumpStatus}`);
    if (parseError) warnings.push(`tree unavailable: ${parseError}`);
    const observation = {
      name,
      atMs: clock(),
      treeAvailable: tree !== null,
      packagePresent,
      rotation: tree?.rotation ?? null,
      nodes: tree?.nodes ?? [],
      nodeCount: tree?.nodeCount ?? 0,
      width,
      height,
      pngPath: paths.pngPath,
      xmlPath: paths.xmlPath,
      warnings,
      dumpStatus,
      dumpText: dumpText.slice(0, 200),
    };
    observation.expectations = missingExpectations(
      observation,
      request.expectText ?? [],
      request.expectContains ?? [],
    );
    writeState(evidenceDir, {
      pngPath: observation.pngPath,
      xmlPath: observation.xmlPath,
      atMs: observation.atMs,
      width,
      height,
      rotation: observation.rotation,
      treeAvailable: observation.treeAvailable,
      packagePresent,
      name,
    });
    return observation;
  }

  function describeBlock(observation, reason, matches = []) {
    return {
      status: 'needs-agent-visual',
      reason,
      observation,
      matches: summarizeMatches(matches),
      screenshot: observation.pngPath,
    };
  }

  function tap(request) {
    const name = request.name ?? 'tap';
    const settleMs = request.settleMs ?? 700;
    const before = observe({
      name: `${name}-before`,
      requirePackage: request.requirePackage,
      expectText: [],
      expectContains: [],
    });
    if (!before.treeAvailable) {
      return {
        ...describeBlock(before, 'fresh UI tree unavailable; use the screenshot fallback'),
        action: 'none',
      };
    }
    if (request.requirePackage !== false && !before.packagePresent) {
      return {
        ...describeBlock(before, `package ${packageName} is not in the fresh tree`),
        action: 'none',
      };
    }
    const foreground = foregroundStatus(request.allowedForeground, 'tap');
    if (!foreground.ok) {
      return { ...describeBlock(before, foreground.reason), action: 'none', foreground };
    }
    const selector = request.selector;
    const matches = narrowMatches(before.nodes, selector);
    if (matches.length !== 1) {
      return {
        ...describeBlock(
          before,
          matches.length === 0
            ? 'selector matched no element in the fresh tree'
            : 'selector matched more than one element; refusing an ambiguous tap',
          matches,
        ),
        action: 'none',
      };
    }
    const node = matches[0];
    if (!node.bounds) {
      return { ...describeBlock(before, 'matched element has no bounds'), action: 'none' };
    }
    const { centerX, centerY } = node.bounds;
    if (centerX < 0 || centerY < 0 || centerX >= before.width || centerY >= before.height) {
      return {
        ...describeBlock(
          before,
          `bounds center ${centerX},${centerY} is outside ${before.width}x${before.height}`,
        ),
        action: 'none',
      };
    }
    device.verifyIdentity();
    device.shell(['input', 'tap', String(centerX), String(centerY)], {
      timeoutMs: 10_000,
      expectedForeground: foreground.current,
      note: `tap ${selector.text ?? selector.contentDesc ?? selector.resourceId ?? ''}`.trim(),
    });
    sleep(settleMs);
    const after = observe({ name: `${name}-after`, requirePackage: false });
    const missing = missingExpectations(
      after,
      request.expectText ?? [],
      request.expectContains ?? [],
    );
    const verified =
      (request.expectText?.length ?? 0) + (request.expectContains?.length ?? 0) === 0
        ? null
        : missing.missingText.length === 0 && missing.missingContains.length === 0;
    return {
      status: verified === false ? 'unverified' : 'ok',
      action: 'tap',
      tapped: {
        label: node.text || node.contentDesc || node.resourceId || node.className,
        x: centerX,
        y: centerY,
        bounds: node.bounds,
      },
      before,
      after,
      missing,
      input: 'fresh-tree-bounds',
      foreground: foreground.current,
    };
  }

  function validateVisualPoint(point, width, height, label) {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) {
      throw new MumuGuardError('VISUAL_COORDS', `${label} must use integer x,y`);
    }
    if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) {
      throw new MumuGuardError(
        'VISUAL_COORDS',
        `${label} ${point.x},${point.y} is outside ${width}x${height}`,
      );
    }
  }

  function loadVisualSource(request, name) {
    const state = readObservationState(evidenceDir);
    if (!state?.pngPath) {
      throw new MumuGuardError('VISUAL_NO_STATE', 'no observed screenshot in this evidence run');
    }
    const fromShot = path.resolve(request.fromShot);
    if (!withinEvidence(fromShot, evidenceDir)) {
      throw new MumuGuardError(
        'VISUAL_OUTSIDE',
        'visual input must use a screenshot from this evidence directory',
      );
    }
    if (fromShot.toLowerCase() !== path.resolve(state.pngPath).toLowerCase()) {
      throw new MumuGuardError(
        'VISUAL_STALE',
        'visual input must use the latest observed screenshot, not an older frame',
      );
    }
    const stats = statSync(fromShot);
    const age = Math.max(0, clock() - stats.mtimeMs);
    const maxAge = request.maxShotAgeMs ?? 15_000;
    if (!Number.isFinite(age) || age > maxAge) {
      throw new MumuGuardError(
        'VISUAL_STALE',
        `screenshot age ${Math.round(age)}ms exceeds ${maxAge}ms; observe again`,
      );
    }
    const size = pngSize(readFileSync(fromShot));
    return { fromShot, state, size, age, name };
  }

  function tapVisual(request) {
    const name = request.name ?? 'tap-visual';
    const source = loadVisualSource(request, name);
    const point = { x: Number(request.x), y: Number(request.y) };
    validateVisualPoint(point, source.size.width, source.size.height, 'tap point');
    // A fresh screenshot is taken immediately before input; a size/orientation
    // change invalidates the agent-selected point.
    const preflight = observe({ name: `${name}-preflight`, requirePackage: false });
    if (preflight.width !== source.size.width || preflight.height !== source.size.height) {
      return {
        status: 'needs-agent-visual',
        reason: 'screen dimensions changed since the visual screenshot; observe again',
        observation: preflight,
        screenshot: preflight.pngPath,
        action: 'none',
      };
    }
    const foreground = foregroundStatus(request.allowedForeground, 'visual tap');
    if (!foreground.ok) {
      return {
        status: 'needs-agent-visual',
        reason: foreground.reason,
        observation: preflight,
        screenshot: preflight.pngPath,
        action: 'none',
        foreground,
      };
    }
    device.verifyIdentity();
    device.shell(['input', 'tap', String(point.x), String(point.y)], {
      timeoutMs: 10_000,
      expectedForeground: foreground.current,
      note: 'agent visual tap',
    });
    sleep(request.settleMs ?? 700);
    const after = observe({
      name: `${name}-after`,
      requirePackage: false,
      expectText: request.expectText ?? [],
      expectContains: request.expectContains ?? [],
    });
    const verified =
      (request.expectText?.length ?? 0) + (request.expectContains?.length ?? 0) === 0
        ? null
        : after.expectations.missingText.length === 0 &&
          after.expectations.missingContains.length === 0;
    return {
      status: verified === false ? 'unverified' : 'applied',
      action: 'tap',
      input: 'agent-visual-from-latest-screenshot',
      point,
      sourceShot: source.fromShot,
      sourceAgeMs: Math.round(source.age),
      preflight,
      after,
      missing: after.expectations,
      foreground: foreground.current,
    };
  }

  function swipeVisual(request) {
    const name = request.name ?? 'swipe-visual';
    const source = loadVisualSource(request, name);
    const from = { x: Number(request.fromX), y: Number(request.fromY) };
    const to = { x: Number(request.toX), y: Number(request.toY) };
    validateVisualPoint(from, source.size.width, source.size.height, 'swipe start');
    validateVisualPoint(to, source.size.width, source.size.height, 'swipe end');
    const durationMs = Math.max(80, Math.min(Number(request.durationMs) || 300, 3000));
    const preflight = observe({ name: `${name}-preflight`, requirePackage: false });
    if (preflight.width !== source.size.width || preflight.height !== source.size.height) {
      return {
        status: 'needs-agent-visual',
        reason: 'screen dimensions changed since the visual screenshot; observe again',
        observation: preflight,
        screenshot: preflight.pngPath,
        action: 'none',
      };
    }
    const foreground = foregroundStatus(request.allowedForeground, 'visual swipe');
    if (!foreground.ok) {
      return {
        status: 'needs-agent-visual',
        reason: foreground.reason,
        observation: preflight,
        screenshot: preflight.pngPath,
        action: 'none',
        foreground,
      };
    }
    device.verifyIdentity();
    device.shell(
      [
        'input',
        'swipe',
        String(from.x),
        String(from.y),
        String(to.x),
        String(to.y),
        String(Math.round(durationMs)),
      ],
      { timeoutMs: 10_000, expectedForeground: foreground.current, note: 'agent visual swipe' },
    );
    sleep(request.settleMs ?? 700);
    const after = observe({
      name: `${name}-after`,
      requirePackage: false,
      expectText: request.expectText ?? [],
      expectContains: request.expectContains ?? [],
    });
    const verified =
      (request.expectText?.length ?? 0) + (request.expectContains?.length ?? 0) === 0
        ? null
        : after.expectations.missingText.length === 0 &&
          after.expectations.missingContains.length === 0;
    return {
      status: verified === false ? 'unverified' : 'applied',
      action: 'swipe',
      input: 'agent-visual-from-latest-screenshot',
      from,
      to,
      durationMs,
      sourceShot: source.fromShot,
      preflight,
      after,
      missing: after.expectations,
      foreground: foreground.current,
    };
  }

  function scroll(request = {}) {
    const name = request.name ?? 'scroll';
    const before = observe({ name: `${name}-before`, requirePackage: request.requirePackage });
    if (!before.treeAvailable) {
      return {
        ...describeBlock(before, 'fresh UI tree unavailable before scroll'),
        action: 'none',
      };
    }
    const foreground = foregroundStatus(request.allowedForeground, 'scroll');
    if (!foreground.ok) {
      return { ...describeBlock(before, foreground.reason), action: 'none', foreground };
    }
    const direction = request.direction ?? 'up';
    const startRatio = direction === 'down' ? 0.3 : 0.72;
    const endRatio = direction === 'down' ? 0.72 : 0.3;
    const x = Math.round(before.width / 2);
    const startY = Math.round(before.height * startRatio);
    const endY = Math.round(before.height * endRatio);
    device.verifyIdentity();
    device.shell(
      [
        'input',
        'swipe',
        String(x),
        String(startY),
        String(x),
        String(endY),
        String(request.durationMs ?? 400),
      ],
      {
        timeoutMs: 10_000,
        expectedForeground: foreground.current,
        note: `scripted ${direction} scroll`,
      },
    );
    sleep(request.settleMs ?? 700);
    const after = observe({ name: `${name}-after`, requirePackage: false });
    return {
      status: 'ok',
      action: 'swipe',
      input: 'scripted-fresh-proportional-scroll',
      direction,
      from: { x, y: startY },
      to: { x, y: endY },
      before,
      after,
      foreground: foreground.current,
    };
  }

  return { observe, tap, scroll, tapVisual, swipeVisual, evidenceDir, packageName };
}

export function selectorFromOptions(options) {
  const selector = {};
  const mappings = [
    ['text', 'text'],
    ['text-contains', 'textContains'],
    ['content-desc', 'contentDesc'],
    ['content-desc-contains', 'contentDescContains'],
    ['resource-id', 'resourceId'],
    ['class', 'className'],
  ];
  for (const [option, key] of mappings) {
    if (typeof options[option] === 'string') selector[key] = options[option];
  }
  if (options['no-clickable'] === true) selector.clickable = false;
  return selector;
}

export function parsePoint(value, label) {
  const match = /^(\d+),(\d+)$/.exec(String(value ?? '').trim());
  if (!match) throw new MumuGuardError('VISUAL_COORDS', `${label} must be x,y`);
  return { x: Number(match[1]), y: Number(match[2]) };
}
