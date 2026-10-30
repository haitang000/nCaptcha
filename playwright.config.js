import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', timeout: 30000, fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:18877', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-dark-reduced', use: { ...devices['Pixel 7'], colorScheme: 'dark', reducedMotion: 'reduce' } },
  ],
  webServer: { command: 'node test/browser-server.js', url: 'http://127.0.0.1:18877/test', reuseExistingServer: false },
});
