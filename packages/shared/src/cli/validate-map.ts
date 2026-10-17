// Usage: node packages/shared/src/cli/validate-map.ts <map.json>
// Runs on plain Node 22.18+ (type stripping). Exit code 1 when the map has any issue.
import { readFileSync } from 'node:fs'
import { OfficeMapError, parseOfficeMap } from '../officeMap.ts'
import type { OfficeMap } from '../types.ts'
import { summarizeOfficeMap, validateOfficeMap } from '../validate.ts'

function main(args: readonly string[]): number {
  const [path] = args
  if (path === undefined || args.length !== 1) {
    console.error('usage: node packages/shared/src/cli/validate-map.ts <map.json>')
    return 2
  }

  let map: OfficeMap
  try {
    map = parseOfficeMap(JSON.parse(readFileSync(path, 'utf8')))
  } catch (error) {
    if (!(error instanceof OfficeMapError)) {
      console.error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
    console.error(`${path}: cannot read the map (${error.issues.length} problems)`)
    for (const issue of error.issues) console.error(`  - ${issue}`)
    return 1
  }

  const s = summarizeOfficeMap(map)
  console.log(`${path}: ${map.width}x${map.height} tiles, template ${map.templateId || '?'} v${map.templateVersion}`)
  console.log(`  zones:          ${s.zones}`)
  console.log(`  seats:          ${s.seats}`)
  console.log(`  computer seats: ${s.computerSeats}`)
  console.log(`  whiteboards:    ${s.whiteboards}`)
  console.log(`  colliders:      ${s.colliders.wall} wall, ${s.colliders.furniture} furniture`)
  console.log(`  spawns:         ${s.spawns}`)

  const issues = validateOfficeMap(map)
  if (issues.length === 0) {
    console.log('No issues.')
    return 0
  }
  console.error(`${issues.length} issue${issues.length === 1 ? '' : 's'}:`)
  for (const issue of issues) console.error(`  - [${issue.code}] ${issue.message}`)
  return 1
}

process.exitCode = main(process.argv.slice(2))
