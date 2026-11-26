import { env } from 'node:process';
import { defineConfig, devices } from '@playwright/test';

// Browser E2E entry point. Domain/application behavior is covered by Vitest;
// these tests are for real UI flows and are implemented by later tasks.
//
// The web server always builds the current source before previewing, and never
// reuses an unknown server on the port, so E2E cannot silently test a stale
// dist/ or another agent's preview. Use PW_PORT to avoid port collisions.
const port = Number(env.PW_PORT ?? 4173);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`PW_PORT must be a valid TCP port, received: ${env.PW_PORT}`);
}
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npm run preview -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
