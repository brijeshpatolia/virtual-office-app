import { createDb, forOrg, member, newId, organization, user, type DbHandle } from '@vo/db'
import type { OrgRole } from '@vo/shared'
import { createServices, type Services } from '../../src/chat/services.ts'

// An in-memory PGlite with companies, members and offices written straight into the tables (no Better Auth), and
// the P2 services on it with a fake wall clock.

export class WallClock {
  ms = Date.now()
  readonly now = (): number => this.ms
  advance(ms: number): void {
    this.ms += ms
  }
}

export interface Member {
  userId: string
  name: string
  orgId: string
  role: OrgRole
}

export interface Company {
  orgId: string
  officeId: string
  join(name: string, role?: OrgRole, joinedAt?: Date): Promise<Member>
}

export interface ChatTestDb {
  handle: DbHandle
  clock: WallClock
  services: Services
  company(name: string): Promise<Company>
  close(): Promise<void>
}

export async function startChatDb(): Promise<ChatTestDb> {
  const handle = await createDb({ PGLITE_DIR: 'memory://' })
  const clock = new WallClock()
  const services = createServices(handle.db, { now: clock.now })
  const { db } = handle
  return {
    handle,
    clock,
    services,
    async company(name) {
      const orgId = newId()
      await db.insert(organization).values({ id: orgId, name, slug: `${name}-${orgId}`.toLowerCase(), createdAt: new Date(clock.ms) })
      const office = await forOrg(db, orgId).createOffice({ name: `${name} HQ`, templateId: 't', templateVersion: 1 })
      return {
        orgId,
        officeId: office.id,
        async join(userName, role = 'member', joinedAt = new Date(clock.ms)) {
          const userId = newId()
          await db.insert(user).values({ id: userId, name: userName, email: `${userName.toLowerCase()}-${userId}@example.com` })
          await db.insert(member).values({ id: newId(), organizationId: orgId, userId, role, createdAt: joinedAt })
          return { userId, name: userName, orgId, role }
        },
      }
    },
    close: () => handle.close(),
  }
}
