import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';
import playwrightConfig from '../../playwright.config';

type VitestSection = {
  include?: string[];
  exclude?: string[];
  setupFiles?: string | string[];
};

type PlaywrightShape = {
  testDir?: string;
  webServer?: { command?: string; reuseExistingServer?: boolean };
};

const vitestSection = (viteConfig as unknown as { test?: VitestSection }).test ?? {};
const playwright = playwrightConfig as unknown as PlaywrightShape;

describe('test runner separation', () => {
  it('keeps Vitest out of the Playwright E2E directory', () => {
    expect(vitestSection.exclude ?? []).toContain('tests/e2e/**');
    expect(playwright.testDir).toBe('./tests/e2e');
  });

  it('wires the shared RTL/jest-dom setup file', () => {
    const setupFiles = vitestSection.setupFiles;
    const files = Array.isArray(setupFiles) ? setupFiles : [setupFiles];
    expect(files).toContain('./tests/setup.ts');
  });

  it('builds the current artifact and refuses to reuse an unknown preview server', () => {
    expect(playwright.webServer?.command).toContain('npm run build');
    expect(playwright.webServer?.reuseExistingServer).toBe(false);
  });
});
