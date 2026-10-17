import { loadEnv } from './env.ts'
import { startServer } from './server.ts'

try {
  const env = loadEnv()
  const server = await startServer(env)
  console.log(`Office server (${env.NODE_ENV}) on http://localhost:${server.port}, client ${env.CLIENT_ORIGIN}`)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      server.close().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(error)
          process.exit(1)
        },
      )
    })
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
