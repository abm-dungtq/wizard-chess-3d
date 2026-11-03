import { defineConfig } from '@playwright/test';

const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: externalBaseUrl || 'http://localhost:3107',
    viewport: { width: 1024, height: 768 }
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--enable-gpu-rasterization']
        }
      }
    }
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command: 'npx vite --port=3107 --strictPort',
        url: 'http://localhost:3107',
        reuseExistingServer: false,
        timeout: 120_000
      }
});
