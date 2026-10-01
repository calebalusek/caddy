import { defineConfig } from '@playwright/test';

// UI tests run in the installed Chrome with real WebGL.
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
    colorScheme: 'light',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
