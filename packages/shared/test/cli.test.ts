import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { mapWith, objectOf, removeLayer, setProp, type TestMap } from './helpers/tiledMap.ts'

const cli = fileURLToPath(new URL('../src/cli/validate-map.ts', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'vo-validate-map-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

// Plain `node file.ts`, no flags: Node 22.18+ strips the types itself.
function run(name: string, map: TestMap | string) {
  const file = join(dir, name)
  writeFileSync(file, typeof map === 'string' ? map : JSON.stringify(map))
  const result = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

describe('validate-map CLI', () => {
  it('prints the summary and exits 0 for a valid map', () => {
    const { code, out, err } = run('ok.json', mapWith())
    expect(err).toBe('')
    expect(code).toBe(0)
    expect(out).toContain('zones:          3')
    expect(out).toContain('seats:          2')
    expect(out).toContain('computer seats: 1')
    expect(out).toContain('whiteboards:    1')
    expect(out).toContain('doors:          1')
    expect(out).toContain('colliders:      6 wall, 1 furniture')
    expect(out).toContain('spawns:         1')
    expect(out).toContain('No issues.')
  })

  it('lists the issues and exits 1', () => {
    const { code, err } = run('bad.json', mapWith((m) => setProp(objectOf(m, 'Seats', 's2'), 'zoneId', 'open')))
    expect(code).toBe(1)
    expect(err).toContain('1 issue:')
    expect(err).toContain('[seat-zone] seat "s2" has zoneId "open" but lies in zone "desk"')
  })

  it('exits 1 when the map cannot be parsed', () => {
    const broken = run('broken.json', mapWith((m) => removeLayer(m, 'Seats')))
    expect(broken.code).toBe(1)
    expect(broken.err).toContain('missing object layer "Seats"')

    const notJson = run('not.json', '{ nope')
    expect(notJson.code).toBe(1)
    expect(notJson.err).toContain('not.json')
  })

  it('exits 2 without a path', () => {
    const result = spawnSync(process.execPath, [cli], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })
})
