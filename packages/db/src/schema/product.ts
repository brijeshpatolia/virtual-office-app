import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { newId } from '../id.ts'
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
