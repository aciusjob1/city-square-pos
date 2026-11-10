import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROMIUM_PATH = process.env.CHROMIUM_PATH
  || '/data/data/com.termux/files/usr/bin/chromium-browser';

export default defineConfig({
  testDir: './tests',
  globalSetup: path.resolve(__dirname, 'playwright.global-setup.ts'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    launchOptions: {
      executablePath: CHROMIUM_PATH,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--no-zygote',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--disable-software-rasterizer',
      ],
    },
  },
  projects: [
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],
});
