import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: ['workspace.spec.ts', 'site.spec.ts'],
  fullyParallel: true,
  workers: 2,
  timeout: 25000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5182',
    channel:
      process.env.PULSE_BROWSER_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined),
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:site && npm run dev -- --host 127.0.0.1 --port 5182 --strictPort',
    url: 'http://127.0.0.1:5182',
    reuseExistingServer: false,
    timeout: 30000,
  },
})
