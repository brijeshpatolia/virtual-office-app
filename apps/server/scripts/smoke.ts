// `npm run build --workspace @vo/server`. The server has no build output: Node runs src/ as it is (type stripping).
// So the build step starts it once under plain Node (in-memory PGlite, a free port) and stops it again. That fails
// on syntax Node cannot strip and on imports Node cannot resolve, which tsc (bundler resolution) and Vitest allow.
import { loadEnv } from '../src/env.ts'
import { startServer } from '../src/server.ts'

const server = await startServer(loadEnv({ NODE_ENV: 'test', PORT: '0' }))
await server.close()
console.log(`Server smoke test: started on port ${server.port} under plain Node ${process.version} and stopped`)
