import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 120000,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true,
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: [
    { command: 'npm run dev', url: 'http://127.0.0.1:3001/api/health', reuseExistingServer: !process.env.CI, timeout: 30000 },
    { command: 'npm --prefix ../frontend run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 30000 },
  ],
});
