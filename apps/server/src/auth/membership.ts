import { forUser, type Db } from '@vo/db'
import type { OrgRole } from '@vo/shared'
import { toOrgRole } from './access.ts'

export interface OfficeAccess {
  orgId: string
  role: OrgRole
  officeName: string
}

// The caller's access to one office: null when the office does not exist or the user is not a member of its company.
export type GetOfficeAccess = (userId: string, officeId: string) => Promise<OfficeAccess | null>

export const OFFICE_ACCESS_TTL_MS = 60_000
const MAX_ENTRIES = 10_000

interface AccessCache {
  entries: Map<string, { access: OfficeAccess; expiresAt: number }>
  // Bumped by every invalidation, so a lookup that started before it does not store its stale answer.
  generation: number
}

// One cache per database, shared by every getOfficeAccess on it, so auth hooks can invalidate it.
const caches = new WeakMap<Db, AccessCache>()

function cacheOf(db: Db): AccessCache {
  let cache = caches.get(db)
  if (!cache) {
    cache = { entries: new Map(), generation: 0 }
    caches.set(db, cache)
  }
  return cache
}

// Forget cached access after a membership change (member removed, left, role changed, company deleted).
export function invalidateOfficeAccess(db: Db): void {
  const cache = cacheOf(db)
  cache.entries.clear()
  cache.generation += 1
}

// Only granted access is cached (60 s); a refusal is always looked up again, so a new member gets in at once.
export function createGetOfficeAccess(db: Db, now: () => number = Date.now): GetOfficeAccess {
  const cache = cacheOf(db)
  return async (userId, officeId) => {
    const key = `${userId}/${officeId}`
    const hit = cache.entries.get(key)
    if (hit && hit.expiresAt > now()) return hit.access
    cache.entries.delete(key)

    const generation = cache.generation
    const found = await forUser(db, userId).officeMembership(officeId)
    const role = found ? toOrgRole(found.role) : null
    if (!found || !role) return null
    const access: OfficeAccess = { orgId: found.office.orgId, role, officeName: found.office.name }
    if (generation === cache.generation) {
      if (cache.entries.size >= MAX_ENTRIES) prune(cache, now())
      cache.entries.set(key, { access, expiresAt: now() + OFFICE_ACCESS_TTL_MS })
    }
    return access
  }
}

function prune(cache: AccessCache, at: number): void {
  for (const [key, entry] of cache.entries) if (entry.expiresAt <= at) cache.entries.delete(key)
  if (cache.entries.size >= MAX_ENTRIES) cache.entries.clear()
}
