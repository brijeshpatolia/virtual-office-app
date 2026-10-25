import { and, arrayContains, count, desc, eq, exists, getTableColumns, gt, gte, inArray, isNull, lt, ne, not, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { messageIdFloor, newMessageId } from './id.ts'
import type { Db } from './index.ts'
import { chatMentions, chatMessages, chatMutes, chatReadState, member, user, userPrefs } from './schema/index.ts'

export type ChatMessageRow = typeof chatMessages.$inferSelect
export type UserPrefsRow = typeof userPrefs.$inferSelect

export interface ChatMessageRecord extends ChatMessageRow {
  // The author's user row; the server shows displayName() of it.
  author: { name: string; email: string }
}

export interface ViewedChatMessageRecord extends ChatMessageRecord {
  // The message mentions the viewer of the page (see mentionsViewer).
  mentionsViewer: boolean
}

export interface NewChatMessage {
  officeId: string
  authorId: string
  clientMsgId: string
  body: string
  mentionsEveryone: boolean
  // Users to notify. Only current members of the company get a chat_mentions row; the caller leaves out the author
  // and blocked pairs.
  mentionUserIds: readonly string[]
  createdAt?: Date
}

export interface ChatPageQuery {
  // Only messages with an id below this one.
  before?: string | undefined
  limit: number
  // Only messages created at or after this time (a guest's member.createdAt).
  since?: Date | null | undefined
  // Who reads the page, for mentionsViewer (false for every row without one).
  viewerId?: string | undefined
}

export interface UnreadQuery {
  since?: Date | null | undefined
  // Authors the reader blocked: their messages do not count.
  blockedUserIds: readonly string[]
  // Each count stops here.
  limit: number
}

export interface UnreadCounts {
  count: number
  mentions: number
  lastReadId: string | null
}

export interface MemberRecord {
  userId: string
  name: string
  email: string
  // member.role as Better Auth stores it.
  role: string
  joinedAt: Date
}

export interface PrefsPatch {
  statusText?: string | undefined
  blockedUserIds?: string[] | undefined
  notifyMentions?: boolean | undefined
}

// The P2 queries of one company (chat, read state, prefs, mutes, members); forOrg includes them.
export function chatRepository(db: Db, orgId: string) {
  const inOffice = (officeId: string) => and(eq(chatMessages.orgId, orgId), eq(chatMessages.officeId, officeId))
  const record = { ...getTableColumns(chatMessages), author: { name: user.name, email: user.email } }
  const selectRecords = () => db.select(record).from(chatMessages).innerJoin(user, eq(user.id, chatMessages.authorId))
  const prefsKey = (userId: string) => and(eq(userPrefs.userId, userId), eq(userPrefs.orgId, orgId))
  // created_at >= since, plus the same floor on the id, which the (office_id, id) index can use.
  const createdSince = (since: Date | null | undefined) =>
    since ? and(gte(chatMessages.id, messageIdFloor(since.getTime())), gte(chatMessages.createdAt, since)) : undefined
  // A block between the viewer and the message's author, in either direction, as the prefs stand now.
  const blockedWithAuthor = (viewerId: string) =>
    exists(
      db
        .select({ one: sql`1` })
        .from(userPrefs)
        .where(
          and(
            eq(userPrefs.orgId, orgId),
            or(
              and(eq(userPrefs.userId, chatMessages.authorId), arrayContains(userPrefs.blockedUserIds, [viewerId])),
              and(eq(userPrefs.userId, viewerId), sql`${chatMessages.authorId} = any(${userPrefs.blockedUserIds})`),
            ),
          ),
        ),
    )
  // The message mentions the viewer: a mention row for them (current members, no block when it was sent) or
  // everyone; never their own or a deleted message, and never across a block that stands now.
  const mentionsViewer = (viewerId: string): SQL =>
    and(
      ne(chatMessages.authorId, viewerId),
      isNull(chatMessages.deletedAt),
      or(
        eq(chatMessages.mentionsEveryone, true),
        exists(
          db
            .select({ one: sql`1` })
            .from(chatMentions)
            .where(and(eq(chatMentions.messageId, chatMessages.id), eq(chatMentions.userId, viewerId))),
        ),
      ),
      not(blockedWithAuthor(viewerId)),
    ) ?? sql`false`

  const membersAmong = async (userIds: readonly string[]): Promise<string[]> => {
    if (userIds.length === 0) return []
    const rows = await db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, orgId), inArray(member.userId, [...userIds])))
    return rows.map((row) => row.userId)
  }

  const getChatMessage = async (officeId: string, messageId: string): Promise<ChatMessageRecord | null> => {
    const rows = await selectRecords()
      .where(and(inOffice(officeId), eq(chatMessages.id, messageId)))
      .limit(1)
    return rows[0] ?? null
  }

  // The author's message with this clientMsgId in the office (an earlier try of a retried send), or null.
  const findChatMessageByClientMsgId = async (officeId: string, authorId: string, clientMsgId: string): Promise<ChatMessageRecord | null> => {
    const rows = await selectRecords()
      .where(and(inOffice(officeId), eq(chatMessages.authorId, authorId), eq(chatMessages.clientMsgId, clientMsgId)))
      .limit(1)
    return rows[0] ?? null
  }

  const readState = async (officeId: string, userId: string): Promise<string | null> => {
    const rows = await db
      .select({ lastReadId: chatReadState.lastReadId })
      .from(chatReadState)
      .where(and(eq(chatReadState.orgId, orgId), eq(chatReadState.officeId, officeId), eq(chatReadState.userId, userId)))
      .limit(1)
    return rows[0]?.lastReadId ?? null
  }

  return {
    membersAmong,
    getChatMessage,
    findChatMessageByClientMsgId,
    readState,

    async listMembers(): Promise<MemberRecord[]> {
      return db
        .select({ userId: member.userId, name: user.name, email: user.email, role: member.role, joinedAt: member.createdAt })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, orgId))
        .orderBy(member.createdAt)
    },

    async findMember(userId: string): Promise<{ role: string; joinedAt: Date } | null> {
      const rows = await db
        .select({ role: member.role, joinedAt: member.createdAt })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
        .limit(1)
      return rows[0] ?? null
    },

    // Stores a message and its mentions. created=false: the author already sent this clientMsgId, and the stored
    // message comes back unchanged. null: that clientMsgId belongs to a message of another office or company.
    async insertChatMessage(input: NewChatMessage): Promise<{ message: ChatMessageRecord; created: boolean } | null> {
      const createdAt = input.createdAt ?? new Date()
      // Before the transaction: PGlite runs one transaction at a time, and a query outside it would wait for it.
      const mentioned = await membersAmong(input.mentionUserIds.filter((userId) => userId !== input.authorId))
      const id = await db.transaction(async (tx) => {
        const rows = await tx
          .insert(chatMessages)
          .values({
            id: newMessageId(createdAt.getTime()),
            orgId,
            officeId: input.officeId,
            authorId: input.authorId,
            clientMsgId: input.clientMsgId,
            body: input.body,
            mentionsEveryone: input.mentionsEveryone,
            createdAt,
          })
          .onConflictDoNothing({ target: [chatMessages.authorId, chatMessages.clientMsgId] })
          .returning({ id: chatMessages.id })
        const messageId = rows[0]?.id
        if (messageId === undefined) return null
        if (mentioned.length > 0) {
          await tx.insert(chatMentions).values(mentioned.map((userId) => ({ messageId, orgId, userId })))
        }
        return messageId
      })
      if (id !== null) {
        const message = await getChatMessage(input.officeId, id)
        return message === null ? null : { message, created: true }
      }
      const existing = await findChatMessageByClientMsgId(input.officeId, input.authorId, input.clientMsgId)
      return existing === null ? null : { message: existing, created: false }
    },

    // Newest first (keyset paging on the id).
    async listChatMessages(officeId: string, query: ChatPageQuery): Promise<ViewedChatMessageRecord[]> {
      const viewer = query.viewerId
      const mentioned = viewer === undefined ? sql<boolean>`false` : sql<boolean>`(${mentionsViewer(viewer)})`
      return db
        .select({ ...record, mentionsViewer: mentioned })
        .from(chatMessages)
        .innerJoin(user, eq(user.id, chatMessages.authorId))
        .where(and(inOffice(officeId), query.before === undefined ? undefined : lt(chatMessages.id, query.before), createdSince(query.since)))
        .orderBy(desc(chatMessages.id))
        .limit(query.limit)
    },

    // Soft delete: the body goes, the row stays as a tombstone. false: no such message, or already deleted.
    async deleteChatMessage(officeId: string, messageId: string, deletedBy: string, now = new Date()): Promise<boolean> {
      return db.transaction(async (tx) => {
        const rows = await tx
          .update(chatMessages)
          .set({ body: '', deletedAt: now, deletedBy })
          .where(and(inOffice(officeId), eq(chatMessages.id, messageId), isNull(chatMessages.deletedAt)))
          .returning({ id: chatMessages.id })
        if (rows.length === 0) return false
        await tx.delete(chatMentions).where(and(eq(chatMentions.orgId, orgId), eq(chatMentions.messageId, messageId)))
        return true
      })
    },

    // Moves the read state forward to lastReadId. false: lastReadId is not a message of this office.
    async markChatRead(officeId: string, userId: string, lastReadId: string, now = new Date()): Promise<boolean> {
      const found = await db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(and(inOffice(officeId), eq(chatMessages.id, lastReadId)))
        .limit(1)
      if (found.length === 0) return false
      await db
        .insert(chatReadState)
        .values({ userId, orgId, officeId, lastReadId, updatedAt: now })
        .onConflictDoUpdate({
          target: [chatReadState.userId, chatReadState.officeId],
          set: { lastReadId: sql`greatest(${chatReadState.lastReadId}, excluded.last_read_id)`, updatedAt: now },
        })
      return true
    },

    async countUnread(officeId: string, userId: string, query: UnreadQuery): Promise<UnreadCounts> {
      const lastReadId = await readState(officeId, userId)
      const unread = and(
        inOffice(officeId),
        lastReadId === null ? undefined : gt(chatMessages.id, lastReadId),
        createdSince(query.since),
        isNull(chatMessages.deletedAt),
        ne(chatMessages.authorId, userId),
        query.blockedUserIds.length > 0 ? notInArray(chatMessages.authorId, [...query.blockedUserIds]) : undefined,
      )
      const mentionsMe = mentionsViewer(userId)
      const capped = async (where: ReturnType<typeof and>): Promise<number> => {
        const page = db.select({ id: chatMessages.id }).from(chatMessages).where(where).limit(query.limit).as('page')
        const rows = await db.select({ n: count() }).from(page)
        return Number(rows[0]?.n ?? 0)
      }
      const [all, mentions] = await Promise.all([capped(unread), capped(and(unread, mentionsMe))])
      return { count: all, mentions, lastReadId }
    },

    async getPrefs(userId: string): Promise<UserPrefsRow | null> {
      const rows = await db.select().from(userPrefs).where(prefsKey(userId)).limit(1)
      return rows[0] ?? null
    },

    // Changes the named fields (creating the row with the defaults for the rest).
    async savePrefs(userId: string, patch: PrefsPatch, now = new Date()): Promise<UserPrefsRow> {
      const set = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as PrefsPatch
      const rows = await db
        .insert(userPrefs)
        .values({ ...set, userId, orgId, updatedAt: now })
        .onConflictDoUpdate({ target: [userPrefs.userId, userPrefs.orgId], set: { ...set, updatedAt: now } })
        .returning()
      return one(rows)
    },

    // Adds or removes one id in a single statement, so two changes at once do not lose each other.
    async setBlocked(userId: string, targetId: string, blocked: boolean, now = new Date()): Promise<UserPrefsRow> {
      const list = userPrefs.blockedUserIds
      const rows = blocked
        ? await db
            .insert(userPrefs)
            .values({ userId, orgId, blockedUserIds: [targetId], updatedAt: now })
            .onConflictDoUpdate({
              target: [userPrefs.userId, userPrefs.orgId],
              set: {
                blockedUserIds: sql`case when ${targetId} = any(${list}) then ${list} else array_append(${list}, ${targetId}::text) end`,
                updatedAt: now,
              },
            })
            .returning()
        : await db
            .insert(userPrefs)
            .values({ userId, orgId, updatedAt: now })
            .onConflictDoUpdate({
              target: [userPrefs.userId, userPrefs.orgId],
              set: { blockedUserIds: sql`array_remove(${list}, ${targetId}::text)`, updatedAt: now },
            })
            .returning()
      return one(rows)
    },

    // The users among `userIds` who blocked targetId.
    async blockersOf(targetId: string, userIds: readonly string[]): Promise<string[]> {
      if (userIds.length === 0) return []
      const rows = await db
        .select({ userId: userPrefs.userId })
        .from(userPrefs)
        .where(and(eq(userPrefs.orgId, orgId), inArray(userPrefs.userId, [...userIds]), arrayContains(userPrefs.blockedUserIds, [targetId])))
      return rows.map((row) => row.userId)
    },

    // The end of the user's mute; null when not muted (or the mute is over).
    async mutedUntil(userId: string, now = new Date()): Promise<Date | null> {
      const rows = await db
        .select({ until: chatMutes.until })
        .from(chatMutes)
        .where(and(eq(chatMutes.orgId, orgId), eq(chatMutes.userId, userId), gt(chatMutes.until, now)))
        .limit(1)
      return rows[0]?.until ?? null
    },

    // until null: unmute.
    async setMute(userId: string, until: Date | null, mutedBy: string | null): Promise<void> {
      if (until === null) {
        await db.delete(chatMutes).where(and(eq(chatMutes.orgId, orgId), eq(chatMutes.userId, userId)))
        return
      }
      await db
        .insert(chatMutes)
        .values({ orgId, userId, until, mutedBy })
        .onConflictDoUpdate({ target: [chatMutes.orgId, chatMutes.userId], set: { until, mutedBy, createdAt: new Date() } })
    },
  }
}

function one<T>(rows: T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('The statement returned no row')
  return row
}
