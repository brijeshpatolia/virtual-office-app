import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { CLIENT_ORIGIN } from './env.ts'
import { enterName, inOffice, signInWithCode, snapshot, standStill, walk, walkTo, walkUntilBlocked, type Point } from './support.ts'

// Two people meet in a fresh office, and someone from another company stays out. Positions are sprite centres in
// world px (the feet are 12 px lower). The map: apps/client/public/assets/map/map.json (spawn in the lobby).

test.describe.configure({ mode: 'serial' })

const run = Date.now().toString(36)
const ann = { email: `ann-${run}@example.com`, name: 'Ann' }
const bob = { email: `bob-${run}@example.com`, name: 'Bob' }
const cleo = { email: `cleo-${run}@example.com`, name: 'Cleo' }
// Set by the first test, read by the second.
let annOffice: { id: string; url: string } | undefined

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  return context.newPage()
}

// PNGs in E2E_SCREENSHOT_DIR when set, else in the test's output folder; always attached to the report.
async function screenshot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  const dir = process.env.E2E_SCREENSHOT_DIR
  const path = dir ? `${dir}/${name}.png` : testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

// walkTo that must get all the way.
async function arrive(page: Page, target: Point): Promise<void> {
  const at = await walkTo(page, target.x, target.y)
  const message = `at (${at.x}, ${at.y}), wanted (${target.x}, ${target.y}): ${JSON.stringify(await snapshot(page))}`
  expect(near(at.x, target.x) && near(at.y, target.y), message).toBe(true)
}

// Positions travel as float32.
function near(value: number | undefined, expected: number): boolean {
  return value !== undefined && Math.abs(value - expected) < 0.5
}

function toast(page: Page, text: string) {
  return page.getByTestId('toast').filter({ hasText: text })
}

test('two members see each other walk, sit and bump into a wall', async ({ browser }, testInfo) => {
  test.setTimeout(180_000)

  // Ann signs up with an email code, names herself and creates the company with its office.
  const a = await newPage(browser)
  await a.goto('/')
  await expect(a).toHaveURL(/\/login/)
  await signInWithCode(a, ann.email)
  await enterName(a, ann.name)
  await expect(a.getByTestId('onboarding-page')).toBeVisible()
  await a.getByTestId('company-name').fill('Acme')
  await a.getByTestId('office-name').fill('HQ')
  await a.getByTestId('create-company').click()
  await expect(a).toHaveURL(/\/office\/[A-Za-z0-9]+$/)
  const officeId = new URL(a.url()).pathname.split('/').at(-1) ?? ''
  const officeUrl = a.url()
  annOffice = { id: officeId, url: officeUrl }
  await expect(a.getByTestId('company-name')).toHaveText('Acme')
  const annStart = await inOffice(a)
  const annId = annStart.players.find((p) => p.sessionId === annStart.sessionId)?.userId ?? ''

  // Ann creates a member invite link.
  const created = a.waitForResponse((r) => r.url().endsWith(`/api/offices/${officeId}/invite-links`) && r.request().method() === 'POST')
  await a.getByTestId('copy-invite').click()
  const invite = (await (await created).json()) as { url: string }
  expect((await created).status()).toBe(201)
  expect(invite.url.startsWith(`${CLIENT_ORIGIN}/invite/`)).toBe(true)
  await expect(a.getByTestId('invite-status')).toBeVisible()

  // Bob opens the link in his own browser, signs up, accepts and enters the office.
  const b = await newPage(browser)
  await b.goto(invite.url)
  await expect(b.getByRole('heading', { name: 'Join Acme' })).toBeVisible()
  await b.getByTestId('invite-join').click()
  await expect(b).toHaveURL(/\/login\?next=/)
  await signInWithCode(b, bob.email)
  await expect(b.getByTestId('invite-join')).toHaveText('Join Acme')
  await b.getByTestId('invite-join').click()
  await enterName(b, bob.name)
  await expect(b).toHaveURL(officeUrl)
  await inOffice(b)

  // Each sees the other's avatar.
  await expect.poll(async () => (await snapshot(a))?.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bob'])
  await expect.poll(async () => (await snapshot(b))?.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bob'])
  await screenshot(a, 'ann-meets-bob', testInfo)
  await screenshot(b, 'bob-meets-ann', testInfo)
  const annSeenByBob = async () => (await snapshot(b))?.players.find((p) => p.userId === annId)

  // Ann walks left with the keyboard, and Bob sees her move.
  await a.locator('canvas').click()
  const startX = (await annSeenByBob())?.x ?? 0
  await walk(a, 'x', 440)
  await expect.poll(async () => (await annSeenByBob())?.x).toBeLessThan(startX - 50)

  // Through the meeting-room door (x 352-384): the zone toast. The doorway leaves the 20 px body 12 px of room,
  // so from here on Ann uses the autopilot where she has to hit a doorway.
  await arrive(a, { x: 368, y: 356 })
  await arrive(a, { x: 368, y: 508 })
  await expect(toast(a, 'Entered Meeting room (group call later)')).toBeVisible()
  await expect.poll(async () => (await annSeenByBob())?.zoneId).toBe('meeting-room')
  await screenshot(a, 'ann-meeting-room', testInfo)
  await screenshot(b, 'bob-sees-ann-in-meeting-room', testInfo)

  // Back to the lobby and down into the hallway.
  await arrive(a, { x: 368, y: 392 })
  await arrive(a, { x: 704, y: 392 })
  await arrive(a, { x: 704, y: 548 })
  await expect(toast(a, 'Entered Hallway')).toBeVisible()

  // With the keyboard, the wall between hallway and open plan stops her (its left edge is x 768; the body is 20 px wide).
  await walkUntilBlocked(a, 'ArrowRight')
  const atWall = await standStill(a)
  expect(atWall.x).toBeGreaterThan(750)
  expect(atWall.x).toBeLessThanOrEqual(758.5)
  await expect.poll(async () => near((await annSeenByBob())?.x, atWall.x)).toBe(true)
  // Walking on into the wall without the local collision check: the server rejects the move and Ann snaps back to
  // the last position it accepted.
  const rejectsBefore = (await snapshot(a))?.rejects ?? 0
  const snapped = await walkTo(a, atWall.x + 40, atWall.y)
  expect(near(snapped.x, atWall.x) && near(snapped.y, atWall.y)).toBe(true)
  // Every move sent into the wall is rejected; the first one snaps her back.
  await a.waitForTimeout(500)
  const afterWall = await snapshot(a)
  expect(afterWall?.rejects).toBeGreaterThan(rejectsBefore)
  expect(afterWall?.lastReject).toMatchObject({ reason: 'collision' })
  expect(near(afterWall?.lastReject?.x, atWall.x)).toBe(true)
  expect(near((await annSeenByBob())?.x, atWall.x)).toBe(true)

  // Bob goes over to the open plan to watch; Ann sees him walk.
  const bobId = (await snapshot(b))?.players.find((p) => p.name === 'Bob')?.userId ?? ''
  await arrive(b, { x: 540, y: 392 })
  await arrive(b, { x: 880, y: 392 })
  await arrive(b, { x: 880, y: 548 })
  await expect.poll(async () => (await snapshot(a))?.players.find((p) => p.userId === bobId)?.zoneId).toBe('open-plan')

  // Up to the open-plan door (y 384-416 at the feet), through it, and to desk d1 in pod A.
  await arrive(a, { x: atWall.x, y: 392 })
  await arrive(a, { x: 848, y: 392 })
  await arrive(a, { x: 848, y: 548 })
  await arrive(a, { x: 996, y: 548 })
  await expect(a.getByTestId('seat-hint')).toHaveText('E sit (computer)')
  await a.keyboard.press('e')
  await expect.poll(async () => (await snapshot(a))?.local?.seatId).toBe('d1')
  await expect(a.getByTestId('seat-hint')).toHaveText('E stand')

  // Bob sees the seat taken and Ann sitting on it.
  await expect.poll(async () => (await snapshot(b))?.seats.d1).toBe(annId)
  await expect.poll(async () => (await annSeenByBob())?.seatId).toBe('d1')
  await screenshot(a, 'ann-seated-d1', testInfo)
  await screenshot(b, 'bob-sees-ann-seated', testInfo)

  // Ann stands up; the seat is free again for Bob.
  await a.keyboard.press('e')
  await expect.poll(async () => (await snapshot(b))?.seats.d1).toBe('')
  await expect.poll(async () => (await annSeenByBob())?.seatId).toBe('')
  // Doorways, the seat and standing up cost no rejects.
  expect((await snapshot(a))?.rejects).toBe(afterWall?.rejects)
  expect((await snapshot(b))?.rejects).toBe(0)

  // Bob signs out: he leaves the room and Ann sees him go.
  await b.getByTestId('sign-out').click()
  await expect(b).toHaveURL(/\/login$/)
  await expect.poll(async () => (await snapshot(a))?.players.map((p) => p.name)).toEqual(['Ann'])
  await a.getByTestId('sign-out').click()
  await expect(a).toHaveURL(/\/login$/)
})

test('someone from another company cannot open the office or join its room', async ({ browser }, testInfo) => {
  test.skip(annOffice === undefined, 'needs the office from the first test')
  const foreign = annOffice ?? { id: '', url: '' }

  // Cleo signs up and has her own company.
  const c = await newPage(browser)
  await c.goto('/')
  await signInWithCode(c, cleo.email)
  await enterName(c, cleo.name)
  await c.getByTestId('company-name').fill('Other Co')
  await c.getByTestId('create-company').click()
  await expect(c).toHaveURL(/\/office\/[A-Za-z0-9]+$/)
  const ownOfficeId = new URL(c.url()).pathname.split('/').at(-1) ?? ''
  await inOffice(c)

  // Ann's office page answers "not found", and the page does not join the room.
  await c.goto(foreign.url)
  await expect(c.getByRole('heading', { name: 'Office not found' })).toBeVisible()
  expect(await snapshot(c)).toBeNull()
  await screenshot(c, 'cleo-office-not-found', testInfo)

  // Directly: no realtime token for Ann's office, and Cleo's own token does not open Ann's room.
  const result = await c.evaluate(
    async ({ ownOfficeId, foreignOfficeId }) => {
      const foreignToken = await fetch(`/api/rt-token?officeId=${foreignOfficeId}`)
      const own = (await (await fetch(`/api/rt-token?officeId=${ownOfficeId}`)).json()) as { token: string }
      const join = await fetch('/colyseus/matchmake/joinOrCreate/office', {
        method: 'POST',
        headers: { authorization: `Bearer ${own.token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ officeId: foreignOfficeId }),
      })
      return { foreignTokenStatus: foreignToken.status, joinStatus: join.status, join: (await join.json()) as unknown }
    },
    { ownOfficeId, foreignOfficeId: foreign.id },
  )
  expect(result.foreignTokenStatus).toBe(404)
  expect(result.joinStatus).toBeGreaterThanOrEqual(400)
  expect(result.join).toMatchObject({ code: 525 })
})
