// `npm run dev`: reads apps/server/.env when it exists, then starts the server as index.ts does (NODE_ENV defaults to
// development here). Node 22's --watch crashes when an --env-file-if-exists file is missing, so the file is read here.
// Restart after changing it.
import { existsSync } from 'node:fs'

const envFile = new URL('../.env', import.meta.url)
if (existsSync(envFile)) process.loadEnvFile(envFile)
// index.ts refuses to start without NODE_ENV.
process.env.NODE_ENV ||= 'development'
await import('./index.ts')
