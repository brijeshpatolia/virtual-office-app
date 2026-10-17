import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { fileURLToPath } from 'node:url'
import type * as schema from './schema/index.ts'

export * from './schema/index.ts'

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
  void env
  throw new Error('Not implemented: createDb (@vo/db)')
}
