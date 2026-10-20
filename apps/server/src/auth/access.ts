import { ORG_ROLES, type OrgRole } from '@vo/shared'
import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access'

// Company roles for the Better Auth organization plugin: the built-in owner, admin and member, plus guest.
const statement = { ...defaultStatements, office: ['enter', 'invite', 'configure'] } as const

export const ac = createAccessControl(statement)

export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, office: ['enter', 'invite', 'configure'] }),
  admin: ac.newRole({ ...adminAc.statements, office: ['enter', 'invite', 'configure'] }),
  member: ac.newRole({ ...memberAc.statements, office: ['enter'] }),
  guest: ac.newRole({ office: ['enter'] }),
} satisfies Record<OrgRole, unknown>

export type OfficeAction = (typeof statement.office)[number]

export function can(role: OrgRole, action: OfficeAction): boolean {
  return roles[role].authorize({ office: [action] }).success
}

// Better Auth stores member.role as text that may list several roles ('admin,member'). It splits it on ',' without
// trimming, and so does this: the strongest known role counts, null when none is known (the user then gets no
// access). The organization hooks in auth.ts store only single, exact roles.
export function toOrgRole(stored: string): OrgRole | null {
  const listed = new Set(stored.split(','))
  return ORG_ROLES.find((role) => listed.has(role)) ?? null
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === 'string' && (ORG_ROLES as readonly string[]).includes(value)
}
