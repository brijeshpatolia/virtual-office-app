import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import * as schema from './schema/index.ts'

export * from './schema/index.ts'
export * from './repository.ts'
export * from './chatRepository.ts'
export { messageIdTime, newId, newMessageId } from './id.ts'
// All tables as one object, for drizzle({ schema }) and Better Auth's drizzleAdapter.
export { schema }

export type Schema = typeof schema
// One type for both drivers: drizzle-orm/node-postgres (DATABASE_URL) and drizzle-orm/pglite (dev, tests).
export type Db = PgDatabase<PgQueryResultHKT, Schema>

export interface DbEnv {
  // Postgres connection string. Unset: PGlite.
  DATABASE_URL?: string | undefined
  // PGlite data directory, or 'memory://' for a throwaway in-memory database.
  PGLITE_DIR: string
}

export interface DbHandle {
  db: Db
  kind: 'pg' | 'pglite'
  close(): Promise<void>
}

export const MIGRATIONS_DIR = fileURLToPath(new URL('../drizzle', import.meta.url))

// Opens Postgres (DATABASE_URL) or PGlite (PGLITE_DIR) and applies the migrations in MIGRATIONS_DIR.
export async function createDb(env: DbEnv): Promise<DbHandle> {
  if (env.DATABASE_URL) {
    const pool = new pg.Pool({ connectionString: env.DATABASE_URL })
    // An idle client that loses its connection emits 'error'; without a listener that would end the process.
    pool.on('error', (error) => console.error('Postgres pool error:', error.message))
    try {
      await migrateExclusively(pool)
      return { db: drizzlePg(pool, { schema }), kind: 'pg', close: () => pool.end() }
    } catch (error) {
      await pool.end()
      throw error
    }
  }
  // PGlite creates its own directory, but not the missing parents.
  if (env.PGLITE_DIR !== 'memory://') await mkdir(dirname(env.PGLITE_DIR), { recursive: true })
  const client = new PGlite(env.PGLITE_DIR)
  try {
    const db = drizzlePglite(client, { schema })
    await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR })
    return { db, kind: 'pglite', close: () => client.close() }
  } catch (error) {
    await client.close()
    throw error
  }
}

// Any fixed number: the advisory lock id that serializes migrations of servers starting at the same time.
const MIGRATION_LOCK_ID = 7_402_113

// Drizzle's migrator takes no lock, so two servers starting together would both create the tables. The lock is a
// session lock; destroying the connection afterwards releases it even when the migration fails.
async function migrateExclusively(pool: pg.Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await migratePg(drizzlePg(client, { schema }), { migrationsFolder: MIGRATIONS_DIR })
  } finally {
    client.release(true)
  }
}
