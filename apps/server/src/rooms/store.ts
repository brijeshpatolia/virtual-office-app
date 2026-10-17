import { forOrg, type Db } from '@vo/db'
import { DEFAULT_GUEST_ZONE_TYPES, ZONE_TYPES, type ZoneType } from '@vo/shared'
import { z } from 'zod'

export interface OfficeRoomSettings {
  // Zone types a guest may enter (no-zone cells such as doors are always open).
  guestZoneTypes: readonly ZoneType[]
}

export const DEFAULT_ROOM_SETTINGS: OfficeRoomSettings = { guestZoneTypes: DEFAULT_GUEST_ZONE_TYPES }

// What the office room reads from and writes to the database. Every call names the company (tenant rule).
export interface RoomStore {
  loadSettings(orgId: string, officeId: string): Promise<OfficeRoomSettings>
  // Opens a presence_sessions row and resolves its id.
  startPresence(orgId: string, officeId: string, userId: string): Promise<string>
  endPresence(orgId: string, presenceId: string): Promise<void>
}

const SettingsSchema = z.object({ guestZoneTypes: z.array(z.enum(ZONE_TYPES)).max(ZONE_TYPES.length).optional() })

// offices.settings is free JSON; a missing or invalid value falls back to the default.
export function roomSettingsFrom(raw: unknown): OfficeRoomSettings {
  const parsed = SettingsSchema.safeParse(raw)
  return { guestZoneTypes: (parsed.success ? parsed.data.guestZoneTypes : undefined) ?? DEFAULT_GUEST_ZONE_TYPES }
}

export function createRoomStore(db: Db): RoomStore {
  return {
    async loadSettings(orgId, officeId) {
      const office = await forOrg(db, orgId).getOffice(officeId)
      return roomSettingsFrom(office?.settings)
    },
    startPresence: (orgId, officeId, userId) => forOrg(db, orgId).startPresence(officeId, userId),
    endPresence: (orgId, presenceId) => forOrg(db, orgId).endPresence(presenceId),
  }
}
