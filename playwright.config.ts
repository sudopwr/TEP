import { defineConfig, devices } from '@playwright/test';

/**
 * N4's third clause: "core journeys e2e".
 *
 * These are the twenty-seven paths a person actually walks, driven through a real
 * browser against a real server and a real database. Everything smaller is
 * already covered — 1,972 unit and integration tests — so nothing here exists
 * to check a function. They exist to catch what only shows up when the pieces
 * are assembled: a redirect that loops, a cookie that does not survive the
 * proxy, a form that posts a shape the server refuses.
 *
 * No `webServer` block, deliberately. Each test starts its own API on a port
 * the OS picks and its own preview server pointed at it (see
 * `e2e/fixtures/world.ts`) — one shared server would make these journeys
 * order-dependent, since half of them change the data the other half assert on.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/fixtures/global-setup.ts',

  /*
    Generous, and for one reason: every test builds a database, imports the
    legacy sheet and starts two servers before its first assertion. The work is
    real, so the limit accommodates it rather than the work being faked to fit.
  */
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // A single-user local application. There is no flake budget to spend here:
  // a journey that only passes sometimes is a journey that is telling us
  // something, and retrying would be how we stop hearing it.
  retries: 0,
  forbidOnly: true,

  // Each worker holds an API, a preview server and a browser. Two is plenty on
  // a laptop that is also being used.
  workers: 2,
  fullyParallel: true,

  reporter: [['list']],

  use: {
    // Loopback everywhere, like everything else in this project (N7).
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
