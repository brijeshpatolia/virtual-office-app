import type { CSSProperties } from 'react'
import type { PlayerStatus } from '@vo/shared'
import { OFFLINE_COLOR, STATUS_COLOR } from '../ui/statusColors.ts'

// The status colour as a dot (DND with a white bar, like the avatar's). Always next to a text label.
export function StatusDot({ status, size = 10 }: { status: PlayerStatus | null; size?: number }) {
  const style: CSSProperties = {
    position: 'relative',
    display: 'inline-block',
    flex: '0 0 auto',
    width: size,
    height: size,
    borderRadius: '50%',
    background: status ? STATUS_COLOR[status] : 'transparent',
    border: status ? '1px solid rgba(0, 0, 0, 0.35)' : `2px solid ${OFFLINE_COLOR}`,
    boxSizing: 'border-box',
  }
  return (
    <span style={style} aria-hidden="true">
      {status === 'dnd' && (
        <span style={{ position: 'absolute', left: '22%', right: '22%', top: '50%', height: 2, marginTop: -1, background: '#ffffff' }} />
      )}
    </span>
  )
}
