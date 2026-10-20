import { defineConfig, devices } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLIENT_ORIGIN, CLIENT_PORT, DATA_DIR_VAR, SERVER_PORT } from './e2e/env.ts'

// End-to-end tests in e2e/. They start their own office server (port 2600, NODE_ENV=development) and Vite client
// (port 8100) with a fresh PGlite database in a temporary folder, removed when the run ends. The dev mailer writes
// the sign-in codes to dev-mail.log in that folder, where the tests read them.
// Never run `playwright install` in the dev container: set PW_CHROMIUM_PATH to a local Chromium there
// (/opt/pw-browsers/chromium). CI installs Playwright's own Chromium.

// The config also loads in every test worker; only the runner process (no variable yet) creates the folder.
const dataDir = process.env[DATA_DIR_VAR] ?? createDataDir()

function createDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vo-e2e-'))
  process.env[DATA_DIR_VAR] = dir
  // On exit the web servers are already stopped.
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }))
  return dir
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: CLIENT_ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Chromium's headless shell (the CI default) denies clipboard writes unless the context grants them.
        permissions: ['clipboard-write'],
        launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
      },
    },
  ],
  webServer: [
    {
      command: 'node src/index.ts',
      cwd: 'apps/server',
      url: `http://127.0.0.1:${SERVER_PORT}/__healthcheck`,
      // '' counts as unset, so a DATABASE_URL or RESEND_API_KEY in the shell cannot leak into the run.
      env: {
        NODE_ENV: 'development',
        PORT: String(SERVER_PORT),
        CLIENT_ORIGIN,
        DATA_DIR: dataDir,
        PGLITE_DIR: '',
        DATABASE_URL: '',
        BETTER_AUTH_URL: '',
        RESEND_API_KEY: '',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        MAP_PATH: '',
      },
      stdout: 'pipe',
      gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npx vite --port ${CLIENT_PORT} --strictPort`,
      cwd: 'apps/client',
      url: CLIENT_ORIGIN,
      env: { OFFICE_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
