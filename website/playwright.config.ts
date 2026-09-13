import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    baseURL: process.env.WEBSITE_URL || 'http://127.0.0.1:5198',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
  },
  webServer: process.env.WEBSITE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port 5198 --strictPort',
        url: 'http://127.0.0.1:5198',
        reuseExistingServer: false,
      },
});
