import type { Db } from '@vo/db'
import type { Env } from '../env.ts'
import type { Mailer } from '../mail/mailer.ts'

export interface AuthDeps {
  env: Env
  db: Db
  mailer: Mailer
}

// The Better Auth instance: drizzleAdapter, basePath '/api/auth', emailOTP, organization (owner, admin, member,
// guest; membershipLimit 500; sendInvitationEmail), jwt (EdDSA) and Google when env.google is set.
// The stub returns `never`; the implementation drops the annotation so Auth becomes the inferred betterAuth() type.
export function createAuth(deps: AuthDeps): never {
  void deps
  throw new Error('Not implemented: createAuth')
}

export type Auth = ReturnType<typeof createAuth>
