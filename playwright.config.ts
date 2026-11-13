import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 90_000,
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4173' } },
    { name: 'phone-isolated', use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4174' } },
    // WebKit: where the worker gotchas came from (a Blob module worker, the interrupt buffer under COOP/COEP).
    { name: 'webkit', use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:4173' } },
    { name: 'iphone-isolated', use: { ...devices['iPhone 15'], baseURL: 'http://localhost:4174' } },
  ],
  webServer: [
    { command: 'node scripts/serve.mjs example 4173', url: 'http://localhost:4173', reuseExistingServer: !process.env.CI },
    { command: 'node scripts/serve.mjs example 4174 --isolated', url: 'http://localhost:4174', reuseExistingServer: !process.env.CI },
  ],
});
