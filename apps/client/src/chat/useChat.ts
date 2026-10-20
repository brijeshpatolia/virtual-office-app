import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { debugExtras } from '../game/session/debugExtras.ts'
import type { Social } from '../office/social.tsx'
import { ChatModel, type ChatSnapshot } from './chatModel.ts'
import { plainText } from './segments.ts'
import { shouldNotify } from './unread.ts'

export const notificationPermission = (): NotificationPermission | 'unsupported' =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission

// The chat of this office page: one model, attached to the room while connected.
export function useChat(social: Social, reconnecting: boolean): { model: ChatModel; snapshot: ChatSnapshot } {
  const { api, self, link, blocked } = social
  const model = useMemo(() => new ChatModel({ api, selfId: self.userId }), [api, self.userId])
  useEffect(() => () => model.destroy(), [model])
  useEffect(() => model.setBlocked(blocked), [model, blocked])
  useEffect(() => (link ? model.attach(link) : undefined), [model, link])

  // The SDK reconnected the same session: load what was missed.
  const wasReconnecting = useRef(reconnecting)
  useEffect(() => {
    if (wasReconnecting.current && !reconnecting) model.reconnected()
    wasReconnecting.current = reconnecting
  }, [model, reconnecting])

  // Browser notifications for mentions while the tab is hidden (not on DND, not when turned off).
  const latest = useRef(social)
  useEffect(() => {
    latest.current = social
  })
  useEffect(
    () =>
      model.onIncoming((message) => {
        const { ownPlayer, prefs, nameOf } = latest.current
        const notify = shouldNotify({
          message,
          viewer: { userId: self.userId, blocked: latest.current.blocked },
          chosenStatus: ownPlayer?.chosenStatus ?? 'available',
          notifyMentions: prefs.notifyMentions,
          hidden: document.hidden,
          permission: notificationPermission(),
        })
        if (!notify) return
        const note = new Notification(`${message.authorName} mentioned you`, {
          body: plainText(message.body, nameOf).slice(0, 200),
          tag: message.id,
        })
        note.onclick = () => {
          window.focus()
          note.close()
        }
      }),
    [model, self.userId],
  )

  useEffect(() => {
    debugExtras.chat = () => {
      const { history, pending, unread } = model.getSnapshot()
      return { ids: history.messages.map((m) => m.id), pending: pending.length, unread: unread.count, mentions: unread.mentions }
    }
    return () => {
      delete debugExtras.chat
    }
  }, [model])

  return { model, snapshot: useSyncExternalStore(model.subscribe, model.getSnapshot) }
}
