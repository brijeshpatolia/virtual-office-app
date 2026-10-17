// Shared by playwright.config.ts and the tests. The e2e run has its own ports, so it never meets `npm run dev`.
export const SERVER_PORT = 2600
export const CLIENT_PORT = 8100
export const CLIENT_ORIGIN = `http://localhost:${CLIENT_PORT}`

// The server's DATA_DIR (PGlite and dev-mail.log): a temporary folder that playwright.config.ts creates in the
// runner process. The test workers inherit the variable.
export const DATA_DIR_VAR = 'VO_E2E_DATA_DIR'

export function e2eDataDir(): string {
  const dir = process.env[DATA_DIR_VAR]
  if (!dir) throw new Error(`${DATA_DIR_VAR} is not set; run the tests with npm run e2e`)
  return dir
}
