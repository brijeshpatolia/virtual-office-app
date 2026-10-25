import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { newId, newMessageId } from '../id.ts'
import { organization, user } from './auth.ts'

// Product tables. Every row belongs to one company (Better Auth organization) through org_id.
// Rows that point at an office carry the office's org_id too; a composite foreign key keeps the two in step.

const id = () => text('id').primaryKey().$defaultFn(() => newId())
const orgId = () =>
  text('org_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' })
const at = (name: string) => timestamp(name, { withTimezone: true })

export const offices = pgTable(
  'offices',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    templateId: text('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [index('offices_org_id_idx').on(t.orgId), unique('offices_id_org_id_key').on(t.id, t.orgId)],
)

export const inviteLinks = pgTable(
  'invite_links',
  {
    id: id(),
    orgId: orgId(),
    officeId: text('office_id').notNull(),
    // sha256 (hex) of the token. The token itself is shown once and never stored.
    tokenHash: text('token_hash').notNull(),
    role: text('role').$type<'member' | 'guest'>().notNull(),
    // null = no limit.
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    expiresAt: at('expires_at').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    revokedAt: at('revoked_at'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invite_links_token_hash_idx').on(t.tokenHash),
    index('invite_links_org_id_office_id_idx').on(t.orgId, t.officeId),
    foreignKey({ name: 'invite_links_office_fk', columns: [t.officeId, t.orgId], foreignColumns: [offices.id, offices.orgId] }).onDelete(
      'cascade',
    ),
    check('invite_links_role_check', sql`${t.role} in ('member', 'guest')`),
    check('invite_links_uses_check', sql`${t.uses} >= 0 and (${t.maxUses} is null or ${t.maxUses} >= 1)`),
  ],
)

// People an owner or admin removed from the company. An invite link does not let them back in; an email invitation
// they accept does (and deletes the row).
export const memberRemovals = pgTable(
  'member_removals',
  {
    orgId: orgId(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    removedBy: text('removed_by').references(() => user.id, { onDelete: 'set null' }),
    removedAt: at('removed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'member_removals_pkey', columns: [t.orgId, t.userId] })],
)

export const presenceSessions = pgTable(
  'presence_sessions',
  {
    id: id(),
    orgId: orgId(),
    officeId: text('office_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    joinedAt: at('joined_at').notNull().defaultNow(),
    // null while the user is in the office.
    leftAt: at('left_at'),
  },
  (t) => [
    index('presence_sessions_org_id_office_id_idx').on(t.orgId, t.officeId),
    index('presence_sessions_user_id_idx').on(t.userId),
    foreignKey({ name: 'presence_sessions_office_fk', columns: [t.officeId, t.orgId], foreignColumns: [offices.id, offices.orgId] }).onDelete(
      'cascade',
    ),
  ],
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    orgId: orgId(),
    // null when the actor's account was deleted; the entry stays.
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    at: at('at').notNull().defaultNow(),
  },
  (t) => [index('audit_log_org_id_at_idx').on(t.orgId, t.at)],
)

const userRef = (name: string) =>
  text(name)
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' })

// The office chat. id: uuidv7 from newMessageId, so "id < x" is "older than x" (keyset paging, read state).
// A deleted message stays as a tombstone: body '' and deleted_at set; its mentions are removed.
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newMessageId()),
    orgId: orgId(),
    officeId: text('office_id').notNull(),
    authorId: userRef('author_id'),
    body: text('body').notNull(),
    clientMsgId: uuid('client_msg_id').notNull(),
    // The body has the everyone token (authors other than guests).
    mentionsEveryone: boolean('mentions_everyone').notNull().default(false),
    createdAt: at('created_at').notNull().defaultNow(),
    deletedAt: at('deleted_at'),
    deletedBy: text('deleted_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('chat_messages_author_id_client_msg_id_idx').on(t.authorId, t.clientMsgId),
    index('chat_messages_office_id_id_idx').on(t.officeId, t.id.desc()),
    foreignKey({ name: 'chat_messages_office_fk', columns: [t.officeId, t.orgId], foreignColumns: [offices.id, offices.orgId] }).onDelete(
      'cascade',
    ),
    check('chat_messages_body_check', sql`char_length(${t.body}) <= 2000`),
  ],
)

// The users a message notifies: mentioned by id (or by the everyone token, which has no rows), members of the
// company, not the author, and no block between the two.
export const chatMentions = pgTable(
  'chat_mentions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => chatMessages.id, { onDelete: 'cascade' }),
    orgId: orgId(),
    userId: userRef('user_id'),
  },
  (t) => [
    primaryKey({ name: 'chat_mentions_pkey', columns: [t.messageId, t.userId] }),
    index('chat_mentions_user_id_message_id_idx').on(t.userId, t.messageId),
  ],
)

// The newest message each user has seen in an office. It only moves forward.
export const chatReadState = pgTable(
  'chat_read_state',
  {
    userId: userRef('user_id'),
    orgId: orgId(),
    officeId: text('office_id').notNull(),
    lastReadId: uuid('last_read_id').notNull(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'chat_read_state_pkey', columns: [t.userId, t.officeId] }),
    foreignKey({ name: 'chat_read_state_office_fk', columns: [t.officeId, t.orgId], foreignColumns: [offices.id, offices.orgId] }).onDelete(
      'cascade',
    ),
  ],
)

// A user's settings in one company. No row = the defaults.
export const userPrefs = pgTable(
  'user_prefs',
  {
    userId: userRef('user_id'),
    orgId: orgId(),
    statusText: text('status_text').notNull().default(''),
    blockedUserIds: text('blocked_user_ids').array().notNull().default(sql`'{}'::text[]`),
    notifyMentions: boolean('notify_mentions').notNull().default(true),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'user_prefs_pkey', columns: [t.userId, t.orgId] }),
    check('user_prefs_status_text_check', sql`char_length(${t.statusText}) <= 80`),
    check('user_prefs_blocked_user_ids_check', sql`cardinality(${t.blockedUserIds}) <= 500`),
  ],
)

// Chat mutes by an owner or admin, company-wide, until `until`. Unmuting deletes the row.
export const chatMutes = pgTable(
  'chat_mutes',
  {
    orgId: orgId(),
    userId: userRef('user_id'),
    until: at('until').notNull(),
    mutedBy: text('muted_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'chat_mutes_pkey', columns: [t.orgId, t.userId] })],
)
