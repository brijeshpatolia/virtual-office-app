import { defineConfig, devices } from '@playwright/test'

// End-to-end tests in e2e/. They start `npm run dev` (server 2567 + client 8000) unless it already runs.
// Never run `playwright install` here: set PLAYWRIGHT_CHROMIUM_PATH to a local Chromium if the bundled
// revision is missing (in the dev container: /opt/pw-browsers/chromium).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { executablePath } } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
