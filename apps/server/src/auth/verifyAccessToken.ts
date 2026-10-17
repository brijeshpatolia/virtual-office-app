import { OrgRoleSchema, type OrgRole } from '@vo/shared'
import { createLocalJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
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

// The audience of the realtime JWT. Better Auth's own JWTs carry its base URL instead, so the room refuses them.
export const ACCESS_TOKEN_AUDIENCE = 'vo-realtime'
// An unknown key id reloads the key set at most this often.
const JWKS_RELOAD_MS = 5_000

const ClaimsSchema = z.object({
  sub: z.string().min(1),
  orgId: z.string().min(1),
  officeId: z.string().min(1),
  role: OrgRoleSchema,
  name: z.string().min(1),
})

// Checks tokens against the public keys in the database (through the auth instance, no network hop).
export function createVerifyAccessToken(deps: { env: Env; auth: Auth }): VerifyAccessToken {
  let keys: Promise<JWTVerifyGetKey> | undefined
  let loadedAt = 0

  const load = () => {
    loadedAt = Date.now()
    const loading = deps.auth.api.getJwks().then((set) => createLocalJWKSet(set))
    loading.catch(() => {
      if (keys === loading) keys = undefined
    })
    keys = loading
    return loading
  }

  const verify = async (token: string, getKey: JWTVerifyGetKey): Promise<JWTPayload> => {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: deps.env.BETTER_AUTH_URL,
      audience: ACCESS_TOKEN_AUDIENCE,
      algorithms: ['EdDSA'],
      requiredClaims: ['sub', 'iat', 'exp'],
    })
    return payload
  }

  return async (token) => {
    let payload: JWTPayload
    try {
      payload = await verify(token, await (keys ?? load()))
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey) || Date.now() - loadedAt < JWKS_RELOAD_MS) throw error
      payload = await verify(token, await load())
    }
    const claims = ClaimsSchema.parse(payload)
    return { userId: claims.sub, orgId: claims.orgId, officeId: claims.officeId, role: claims.role, name: claims.name }
  }
}
