import { and, asc, eq, getTableColumns, gt, isNull, lt, or, sql } from 'drizzle-orm'
import type { Db } from './index.ts'
import { auditLog, inviteLinks, member, offices, organization, presenceSessions } from './schema/index.ts'

export type OfficeRow = typeof offices.$inferSelect
export type InviteLinkRow = typeof inviteLinks.$inferSelect
export type InviteLinkRole = InviteLinkRow['role']

export interface NewOffice {
  name: string
  templateId: string
  templateVersion: number
  settings?: Record<string, unknown>
}

export interface NewInviteLink {
  officeId: string
  tokenHash: string
  role: InviteLinkRole
  maxUses: number | null
  expiresAt: Date
  createdBy: string
}

export interface AuditEntry {
  actorId: string | null
  action: string
  targetType?: string
  targetId?: string
  data?: Record<string, unknown>
}

// Tenant data access. Every query filters by this orgId, so an id from another company finds nothing.
export function forOrg(db: Db, orgId: string) {
  if (orgId === '') throw new Error('forOrg needs an orgId')
  const link = (linkId: string) => and(eq(inviteLinks.orgId, orgId), eq(inviteLinks.id, linkId))

  return {
    orgId,

    async createOffice(input: NewOffice): Promise<OfficeRow> {
      return one(await db.insert(offices).values({ ...input, orgId }).returning())
    },

    async getOffice(officeId: string): Promise<OfficeRow | null> {
      const rows = await db
        .select()
        .from(offices)
        .where(and(eq(offices.orgId, orgId), eq(offices.id, officeId)))
        .limit(1)
      return rows[0] ?? null
    },

    async listOffices(): Promise<OfficeRow[]> {
      return db.select().from(offices).where(eq(offices.orgId, orgId)).orderBy(asc(offices.createdAt))
    },

    // The role column as Better Auth stores it (it may list several roles, comma-separated).
    async findMemberRole(userId: string): Promise<string | null> {
      const rows = await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
        .limit(1)
      return rows[0]?.role ?? null
    },

    async createInviteLink(input: NewInviteLink): Promise<InviteLinkRow> {
      return one(await db.insert(inviteLinks).values({ ...input, orgId }).returning())
    },

    // Counts one use in a single UPDATE, so concurrent accepts never exceed maxUses.
    // false: the link is revoked, expired, used up or not in this company.
    async consumeInviteLink(linkId: string, now = new Date()): Promise<boolean> {
      const rows = await db
        .update(inviteLinks)
        .set({ uses: sql`${inviteLinks.uses} + 1` })
        .where(
          and(
            link(linkId),
            isNull(inviteLinks.revokedAt),
            gt(inviteLinks.expiresAt, now),
            or(isNull(inviteLinks.maxUses), lt(inviteLinks.uses, inviteLinks.maxUses)),
          ),
        )
        .returning({ id: inviteLinks.id })
      return rows.length > 0
    },

    // Gives back a use that consumeInviteLink counted when the membership could not be created after all.
    async releaseInviteLink(linkId: string): Promise<void> {
      await db
        .update(inviteLinks)
        .set({ uses: sql`greatest(${inviteLinks.uses} - 1, 0)` })
        .where(link(linkId))
    },

    async revokeInviteLink(linkId: string, now = new Date()): Promise<boolean> {
      const rows = await db
        .update(inviteLinks)
        .set({ revokedAt: now })
        .where(and(link(linkId), isNull(inviteLinks.revokedAt)))
        .returning({ id: inviteLinks.id })
      return rows.length > 0
    },

    async startPresence(officeId: string, userId: string): Promise<string> {
      return one(await db.insert(presenceSessions).values({ orgId, officeId, userId }).returning({ id: presenceSessions.id })).id
    },

    async endPresence(presenceId: string, now = new Date()): Promise<void> {
      await db
        .update(presenceSessions)
        .set({ leftAt: now })
        .where(and(eq(presenceSessions.orgId, orgId), eq(presenceSessions.id, presenceId), isNull(presenceSessions.leftAt)))
    },

    async audit(entry: AuditEntry): Promise<void> {
      await db.insert(auditLog).values({ ...entry, orgId })
    },

    // Deletes the company; the foreign keys remove its members, offices, links and log.
    async deleteOrganization(): Promise<void> {
      await db.delete(organization).where(eq(organization.id, orgId))
    },
  }
}

export type TenantRepository = ReturnType<typeof forOrg>

export interface Membership {
  orgId: string
  name: string
  slug: string
  role: string
}

export interface OfficeMembership {
  office: OfficeRow
  // The member.role column of the user in the office's company.
  role: string
}

// What one user may see: the companies they belong to and the offices of those companies. Each query joins
// the user's member rows, so it starts from the user id instead of an orgId.
export function forUser(db: Db, userId: string) {
  if (userId === '') throw new Error('forUser needs a userId')
  const isMember = and(eq(member.organizationId, offices.orgId), eq(member.userId, userId))

  return {
    async memberships(): Promise<Membership[]> {
      return db
        .select({ orgId: organization.id, name: organization.name, slug: organization.slug, role: member.role })
        .from(member)
        .innerJoin(organization, eq(organization.id, member.organizationId))
        .where(eq(member.userId, userId))
        .orderBy(asc(member.createdAt))
    },

    async offices(): Promise<OfficeRow[]> {
      return db.select(getTableColumns(offices)).from(offices).innerJoin(member, isMember).orderBy(asc(offices.createdAt))
    },

    // The office with the user's role in its company; null when the office does not exist or the user is not a member.
    async officeMembership(officeId: string): Promise<OfficeMembership | null> {
      const rows = await db
        .select({ office: offices, role: member.role })
        .from(offices)
        .innerJoin(member, isMember)
        .where(eq(offices.id, officeId))
        .limit(1)
      return rows[0] ?? null
    },
  }
}

export interface InviteLinkLookup {
  link: InviteLinkRow
  companyName: string
  officeName: string
}

// The only lookup that starts from an invite token: the caller holds the token, not yet a membership.
export async function findInviteLinkByTokenHash(db: Db, tokenHash: string): Promise<InviteLinkLookup | null> {
  const rows = await db
    .select({ link: inviteLinks, companyName: organization.name, officeName: offices.name })
    .from(inviteLinks)
    .innerJoin(offices, and(eq(offices.id, inviteLinks.officeId), eq(offices.orgId, inviteLinks.orgId)))
    .innerJoin(organization, eq(organization.id, inviteLinks.orgId))
    .where(eq(inviteLinks.tokenHash, tokenHash))
    .limit(1)
  return rows[0] ?? null
}

export function isInviteLinkUsable(link: Pick<InviteLinkRow, 'revokedAt' | 'expiresAt' | 'maxUses' | 'uses'>, now = new Date()): boolean {
  return link.revokedAt === null && link.expiresAt > now && (link.maxUses === null || link.uses < link.maxUses)
}

function one<T>(rows: T[]): T {
  const row = rows[0]
  if (row === undefined) throw new Error('The statement returned no row')
  return row
}
