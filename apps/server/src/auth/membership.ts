import type { Db } from '@vo/db'
import type { OrgRole } from '@vo/shared'

export interface OfficeAccess {
  orgId: string
  role: OrgRole
  officeName: string
}

// The caller's access to one office: null when the office does not exist or the user is not a member of its company.
export type GetOfficeAccess = (userId: string, officeId: string) => Promise<OfficeAccess | null>

export function createGetOfficeAccess(db: Db): GetOfficeAccess {
  void db
  return async () => {
    throw new Error('Not implemented: getOfficeAccess')
  }
}
