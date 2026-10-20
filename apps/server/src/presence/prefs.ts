import type { Db } from '@vo/db'
import type { BlockRejectReason, UpdatePrefsRequest, UserPrefs } from '@vo/shared'
import { notImplemented } from '../notImplemented.ts'

export const defaultPrefs = (): UserPrefs => ({ statusText: '', blockedUserIds: [], notifyMentions: true })

export type PrefsListener = (orgId: string, userId: string, prefs: UserPrefs) => void

export type PrefsResult = { ok: true; prefs: UserPrefs } | { ok: false; reason: BlockRejectReason }

// A user's settings in one company (user_prefs), shared by the /api routes and the office rooms of this process.
// Every change goes through here, and the listeners hear of each one, so a room updates the status text in its
// state and its block checks at once.
export interface PrefsService {
  // The stored prefs, or the defaults.
  get(orgId: string, userId: string): Promise<UserPrefs>
  // PUT /api/me/prefs: changes the named fields; blockedUserIds replaces the list. 'invalid' for the caller's own
  // id or an id that is not a current member of the company.
  update(orgId: string, userId: string, patch: UpdatePrefsRequest): Promise<PrefsResult>
  // block:set: adds or removes one id. 'not_found' when blocking someone who is not a current member; 'invalid'
  // for the caller's own id or a full list (MAX_BLOCKED_USERS).
  setBlocked(orgId: string, userId: string, targetId: string, blocked: boolean): Promise<PrefsResult>
  // The users among otherIds with a block between them and userId, in either direction.
  blockedBetween(orgId: string, userId: string, otherIds: readonly string[]): Promise<Set<string>>
  onChange(listener: PrefsListener): () => void
}

export function createPrefsService(db: Db): PrefsService {
  void db
  return {
    get: () => notImplemented('PrefsService.get'),
    update: () => notImplemented('PrefsService.update'),
    setBlocked: () => notImplemented('PrefsService.setBlocked'),
    blockedBetween: () => notImplemented('PrefsService.blockedBetween'),
    onChange: () => () => undefined,
  }
}
