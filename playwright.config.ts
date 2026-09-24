import { defineConfig, devices } from '@playwright/test';

// The pinned @playwright/test version may want a headless-shell build the
// environment's pre-installed browser cache doesn't have; fall back to the
// full Chromium binary when PLAYWRIGHT_CHROMIUM_PATH is set.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      // Required — always runs. See plan §3.4.
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        launchOptions: {
          args: ['--autoplay-policy=no-user-gesture-required'],
          ...(chromiumPath ? { executablePath: chromiumPath } : {}),
        },
      },
    },
    {
      // Best-effort — only meaningful where `npx playwright install --with-deps webkit`
      // succeeds. Linux WebKit is not iOS Safari and never substitutes for a real device.
      name: 'mobile-webkit',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
