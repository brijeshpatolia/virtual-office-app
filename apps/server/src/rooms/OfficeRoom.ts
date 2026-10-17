import { Room, type AuthContext, type Client } from '@colyseus/core'
import type { JoinOptions, OfficeMap, OrgRole } from '@vo/shared'
import type { GetOfficeAccess } from '../auth/membership.ts'
import type { VerifyAccessToken } from '../auth/verifyAccessToken.ts'
import type { OfficeState } from './state.ts'

export interface OfficeRoomDeps {
  officeMap: OfficeMap
  verifyAccessToken: VerifyAccessToken
  getOfficeAccess: GetOfficeAccess
  // Clock in ms; tests pass a fake one.
  now?: () => number
}

// client.auth of a joined client: the value static onAuth returns.
export interface RoomAuth {
  userId: string
  name: string
  orgId: string
  officeId: string
  role: OrgRole
}

export type OfficeClient = Client<{ auth: RoomAuth }>

// One room per office (defineRoom(...).filterBy(['officeId'])). The deps are closed over, because Colyseus
// creates the room and calls the static onAuth itself.
export function createOfficeRoom(deps: OfficeRoomDeps) {
  return class OfficeRoom extends Room<{ state: OfficeState; client: OfficeClient }> {
    static override async onAuth(token: string, options: JoinOptions, context: AuthContext): Promise<RoomAuth> {
      void [token, options, context, deps]
      throw new Error('Not implemented: OfficeRoom.onAuth')
    }

    override onCreate(options: JoinOptions) {
      void options
      throw new Error('Not implemented: OfficeRoom.onCreate')
    }
  }
}

export type OfficeRoomClass = ReturnType<typeof createOfficeRoom>
