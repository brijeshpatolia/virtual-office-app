import type { OrgRole } from '@vo/shared'
import type { Env } from '../env.ts'
import type { Auth } from './auth.ts'

// The claims of the realtime JWT from GET /api/rt-token.
export interface AccessClaims {
  userId: string
  orgId: string
  officeId: string
  role: OrgRole
  name: string
}

// Resolves the claims of a valid token. Rejects a bad signature, a wrong issuer or audience, or an expired token.
export type VerifyAccessToken = (token: string) => Promise<AccessClaims>

export function createVerifyAccessToken(deps: { env: Env; auth: Auth }): VerifyAccessToken {
  void deps
  return async () => {
    throw new Error('Not implemented: verifyAccessToken')
  }
}
