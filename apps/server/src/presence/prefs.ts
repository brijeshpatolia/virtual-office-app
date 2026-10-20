import { forOrg, type Db, type UserPrefsRow } from '@vo/db'
import { MAX_BLOCKED_USERS, UpdatePrefsRequestSchema, type BlockRejectReason, type UpdatePrefsRequest, type UserPrefs } from '@vo/shared'

export const defaultPrefs = (): UserPrefs => ({ statusText: '', blockedUserIds: [], notifyMentions: true })

// origin: whatever the caller of update() passed (an office room passes itself, so it skips its own changes).
export type PrefsListener = (orgId: string, userId: string, prefs: UserPrefs, origin: unknown) => void

export type PrefsResult = { ok: true; prefs: UserPrefs } | { ok: false; reason: BlockRejectReason }

// A user's settings in one company (user_prefs), shared by the /api routes and the office rooms of this process.
// Every change goes through here, and the listeners hear of each one, so a room updates the status text in its
// state at once. Blocks are read from the database on every check (no cache).
export interface PrefsService {
  // The stored prefs, or the defaults.
  get(orgId: string, userId: string): Promise<UserPrefs>
  // PUT /api/me/prefs and status:set: changes the named fields; blockedUserIds replaces the list. 'invalid' for a
  // patch that fails UpdatePrefsRequestSchema, the caller's own id, or a newly listed id that is not a current
  // member (ids already on the list may stay after that person left the company).
  update(orgId: string, userId: string, patch: UpdatePrefsRequest, origin?: unknown): Promise<PrefsResult>
  // block:set: adds or removes one id. 'not_found' when blocking someone who is not a current member; 'invalid'
  // for the caller's own id or a full list (MAX_BLOCKED_USERS).
  setBlocked(orgId: string, userId: string, targetId: string, blocked: boolean): Promise<PrefsResult>
  // The users among otherIds with a block between them and userId, in either direction.
  blockedBetween(orgId: string, userId: string, otherIds: readonly string[]): Promise<Set<string>>
  onChange(listener: PrefsListener): () => void
}

const toPrefs = (row: UserPrefsRow | null): UserPrefs =>
  row === null ? defaultPrefs() : { statusText: row.statusText, blockedUserIds: row.blockedUserIds, notifyMentions: row.notifyMentions }

export function createPrefsService(db: Db, now: () => number = Date.now): PrefsService {
  const listeners = new Set<PrefsListener>()
  const invalid = { ok: false, reason: 'invalid' } as const

  const changed = (orgId: string, userId: string, row: UserPrefsRow, origin: unknown): PrefsResult => {
    const prefs = toPrefs(row)
    for (const listener of listeners) {
      try {
        listener(orgId, userId, prefs, origin)
      } catch (error) {
        console.error('A prefs listener failed:', error)
      }
    }
    return { ok: true, prefs }
  }

  return {
    async get(orgId, userId) {
      return toPrefs(await forOrg(db, orgId).getPrefs(userId))
    },

    async update(orgId, userId, patch, origin) {
      const parsed = UpdatePrefsRequestSchema.safeParse(patch)
      if (!parsed.success) return invalid
      const tenant = forOrg(db, orgId)
      const blocked = parsed.data.blockedUserIds === undefined ? undefined : [...new Set(parsed.data.blockedUserIds)]
      if (blocked !== undefined) {
        if (blocked.includes(userId)) return invalid
        const listed = new Set((await tenant.getPrefs(userId))?.blockedUserIds ?? [])
        const added = blocked.filter((id) => !listed.has(id))
        if ((await tenant.membersAmong(added)).length !== added.length) return invalid
      }
      const row = await tenant.savePrefs(userId, { ...parsed.data, blockedUserIds: blocked }, new Date(now()))
      return changed(orgId, userId, row, origin)
    },

    async setBlocked(orgId, userId, targetId, blocked) {
      if (targetId === userId || targetId === '') return invalid
      const tenant = forOrg(db, orgId)
      if (blocked) {
        if ((await tenant.membersAmong([targetId])).length === 0) return { ok: false, reason: 'not_found' }
        const listed = (await tenant.getPrefs(userId))?.blockedUserIds ?? []
        if (!listed.includes(targetId) && listed.length >= MAX_BLOCKED_USERS) return invalid
      }
      return changed(orgId, userId, await tenant.setBlocked(userId, targetId, blocked, new Date(now())), undefined)
    },

    async blockedBetween(orgId, userId, otherIds) {
      const others = [...new Set(otherIds)].filter((id) => id !== userId)
      if (others.length === 0) return new Set()
      const tenant = forOrg(db, orgId)
      const [own, blockers] = await Promise.all([tenant.getPrefs(userId), tenant.blockersOf(userId, others)])
      const mine = new Set(own?.blockedUserIds ?? [])
      return new Set([...others.filter((id) => mine.has(id)), ...blockers])
    },

    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
