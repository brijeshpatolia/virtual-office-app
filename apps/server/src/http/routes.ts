import type { Db } from '@vo/db'
import type { Application } from 'express'
import type { Auth } from '../auth/auth.ts'
import type { GetOfficeAccess } from '../auth/membership.ts'
import type { Env } from '../env.ts'
import type { Mailer } from '../mail/mailer.ts'

export interface RouteDeps {
  env: Env
  db: Db
  auth: Auth
  mailer: Mailer
  getOfficeAccess: GetOfficeAccess
}

// The /api routes of the HTTP contract (packages/shared/src/protocol/http.ts), except /api/auth/* (Better Auth).
// Runs after express.json(); server.ts adds the JSON 404 and error handlers after these routes.
export function registerRoutes(app: Application, deps: RouteDeps): void {
  void [app, deps]
  throw new Error('Not implemented: registerRoutes')
}
