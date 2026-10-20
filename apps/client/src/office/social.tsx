import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MemberSummary, UserPrefs } from '@vo/shared'
import { EventBus } from '../game/EventBus.ts'
import type { OfficeLink } from '../net/officeLink.ts'
import type { PresencePlayer } from '../presence/people.ts'
import { usePresence } from '../presence/presenceStore.ts'
import type { OfficeApi, OfficeSelf } from './officeApi.ts'

// Who is around and what the user set: shared by the chat bar, the status menu, the People panel and the card.
export interface Social {
  self: OfficeSelf
  api: OfficeApi
  // null while not connected.
  link: OfficeLink | null
  players: readonly PresencePlayer[]
  ownPlayer: PresencePlayer | null
  // null for guests (they may not list them) and until loaded.
  members: readonly MemberSummary[] | null
  prefs: UserPrefs
  // The prefs (and with them the block list) are loaded once 'ready'; 'error' while a retry waits.
  prefsStatus: PrefsStatus
  blocked: ReadonlySet<string>
  nameOf(userId: string): string | undefined
  setBlocked(userId: string, blocked: boolean): Promise<void>
  setNotifyMentions(on: boolean): Promise<void>
  profileUserId: string | null
  openProfile(userId: string): void
  closeProfile(): void
}

export type PrefsStatus = 'loading' | 'ready' | 'error'

const DEFAULT_PREFS: UserPrefs = { statusText: '', blockedUserIds: [], notifyMentions: true }
// A failed prefs load is tried again after 1 s, 2 s, 4 s ... up to this.
const PREFS_RETRY_MAX_MS = 30_000
// A player that is not in the members list (joined after it was loaded) reloads it, at most this often.
const MEMBERS_RELOAD_MS = 10_000

const SocialContext = createContext<Social | null>(null)

export function useSocial(): Social {
  const social = useContext(SocialContext)
  if (!social) throw new Error('useSocial outside SocialProvider')
  return social
}

export function SocialProvider({ value, children }: { value: Social; children: ReactNode }) {
  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
}

export function useOfficeSocial(api: OfficeApi, self: OfficeSelf, link: OfficeLink | null): Social {
  const players = usePresence(link)
  const [loadedMembers, setMembers] = useState<readonly MemberSummary[] | null>(null)
  // A member who became a guest may no longer list them.
  const members = self.role === 'guest' ? null : loadedMembers
  const [prefs, setPrefs] = useState<UserPrefs>(DEFAULT_PREFS)
  const [prefsStatus, setPrefsStatus] = useState<PrefsStatus>('loading')
  const [prefsAttempt, setPrefsAttempt] = useState(0)
  const [profileUserId, setProfileUserId] = useState<string | null>(null)
  const [membersVersion, setMembersVersion] = useState(0)
  const membersLoadedAt = useRef(0)
  const reloadedFor = useRef(new Set<string>())

  useEffect(() => {
    if (self.role === 'guest') return
    let live = true
    api.members().then(
      (list) => {
        if (live) setMembers(list)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [api, self.role, membersVersion])

  // Until the block list is loaded the chat shows nothing (useChat). A failure is tried again with a backoff, and at
  // once when a new connection comes.
  const prefsReady = prefsStatus === 'ready'
  useEffect(() => {
    if (prefsReady) return
    let live = true
    let timer = 0
    api.prefs().then(
      (loaded) => {
        if (!live) return
        setPrefs(loaded)
        setPrefsStatus('ready')
      },
      () => {
        if (!live) return
        setPrefsStatus('error')
        timer = window.setTimeout(() => setPrefsAttempt((n) => n + 1), Math.min(PREFS_RETRY_MAX_MS, 1000 * 2 ** Math.min(prefsAttempt, 5)))
      },
    )
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [api, link, prefsReady, prefsAttempt])

  // Someone new in the room: reload the members for their role (once per person).
  useEffect(() => {
    if (self.role === 'guest' || members === null) return
    const known = new Set(members.map((m) => m.userId))
    const unknown = players.filter((p) => !known.has(p.userId) && !reloadedFor.current.has(p.userId))
    if (unknown.length === 0) return
    const wait = Math.max(0, membersLoadedAt.current + MEMBERS_RELOAD_MS - Date.now())
    const timer = window.setTimeout(() => {
      for (const player of unknown) reloadedFor.current.add(player.userId)
      membersLoadedAt.current = Date.now()
      setMembersVersion((v) => v + 1)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [players, members, self.role])

  useEffect(() => {
    const open = (userId: string): void => setProfileUserId(userId)
    EventBus.on('profile-open', open)
    return () => {
      EventBus.off('profile-open', open)
    }
  }, [])

  const ownPlayer = players.find((p) => p.userId === self.userId) ?? null
  const blocked = useMemo(() => new Set(prefs.blockedUserIds), [prefs.blockedUserIds])
  const chosenStatus = ownPlayer?.chosenStatus

  // "Ann waved at you". The server drops waves while on DND or between blocked people; this is a second check.
  useEffect(() => {
    if (!link) return
    return link.onWaveReceived(({ fromUserId, fromName }) => {
      if (chosenStatus === 'dnd' || blocked.has(fromUserId)) return
      EventBus.emit('toast', `${fromName} waved at you`, 'wave')
    })
  }, [link, chosenStatus, blocked])

  const names = useMemo(() => {
    const map = new Map<string, string>()
    for (const member of members ?? []) map.set(member.userId, member.name)
    for (const player of players) map.set(player.userId, player.name)
    return map
  }, [members, players])
  const nameOf = useCallback((userId: string) => names.get(userId), [names])

  // block:set changes one id on the server. Without a connection the PUT replaces the whole list, so it is built from
  // the list as the server has it now, never from prefs that may not be loaded.
  const setBlocked = useCallback(
    async (userId: string, block: boolean) => {
      let blockedUserIds: string[]
      if (link) {
        blockedUserIds = await link.setBlocked(userId, block)
      } else {
        const listed = (await api.prefs()).blockedUserIds
        const next = block ? [...new Set([...listed, userId])] : listed.filter((id) => id !== userId)
        blockedUserIds = (await api.updatePrefs({ blockedUserIds: next })).blockedUserIds
      }
      setPrefs((current) => ({ ...current, blockedUserIds }))
    },
    [link, api],
  )

  const setNotifyMentions = useCallback(
    async (on: boolean) => {
      setPrefs((current) => ({ ...current, notifyMentions: on }))
      try {
        setPrefs(await api.updatePrefs({ notifyMentions: on }))
      } catch (error) {
        setPrefs((current) => ({ ...current, notifyMentions: !on }))
        throw error
      }
    },
    [api],
  )

  const openProfile = useCallback((userId: string) => setProfileUserId(userId), [])
  const closeProfile = useCallback(() => setProfileUserId(null), [])

  return useMemo(
    () => ({
      self,
      api,
      link,
      players,
      ownPlayer,
      members,
      prefs,
      prefsStatus,
      blocked,
      nameOf,
      setBlocked,
      setNotifyMentions,
      profileUserId,
      openProfile,
      closeProfile,
    }),
    [self, api, link, players, ownPlayer, members, prefs, prefsStatus, blocked, nameOf, setBlocked, setNotifyMentions, profileUserId, openProfile, closeProfile],
  )
}
