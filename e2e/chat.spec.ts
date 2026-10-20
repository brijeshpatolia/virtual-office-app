import { expect, test, type Browser, type Page } from '@playwright/test'
import {
  API,
  CHAT_PAGE_SIZE,
  CHAT_RATE_LIMIT,
  MSG,
  mentionToken,
  type ChatHistoryResponse,
  type ChatUnreadResponse,
  type CreateInviteLinkResponse,
} from '../packages/shared/src/protocol/index.ts'
import { CLIENT_ORIGIN } from './env.ts'
import {
  arrive,
  enterName,
  enterRoom,
  headlessMember,
  inOffice,
  leaveRoom,
  localPosition,
  newPage,
  say,
  screenshot,
  signInWithCode,
  snapshot,
  standStill,
  toast,
  type Headless,
  type OfficeSnapshot,
} from './support.ts'

// P2: the office chat, presence status and the privacy and moderation rules, with real browsers and the real
// server. The tests run in order and share the office: Ann (owner) and Bob (member) in browsers, a guest later,
// and people without a browser (the Colyseus SDK in Node) who add chat messages quickly.

test.describe.configure({ mode: 'serial' })

const run = Date.now().toString(36)
const ann = { email: `chat-ann-${run}@example.com`, name: 'Ann' }
const bob = { email: `chat-bob-${run}@example.com`, name: 'Bob' }
const gus = { email: `chat-gus-${run}@example.com`, name: 'Gus' }
// 22 more members send 5 messages each (the most CHAT_RATE_LIMIT allows in one window): with Ann's two, three pages.
const SEED_AUTHORS = 22

let a: Page
let b: Page
let office = { id: '', orgId: '' }
let annId = ''
let bobId = ''
const headless: Headless[] = []
// When the server last accepted one of Ann's messages (for the rate limit test).
let annSentAt = 0

const selfId = (snap: OfficeSnapshot): string => snap.players.find((p) => p.sessionId === snap.sessionId)?.userId ?? ''
const stored = (page: Page) => page.locator('[data-testid="chat-message"][data-pending="false"]')
const storedRow = (page: Page, text: string) => stored(page).filter({ hasText: text })
const personRow = (page: Page, userId: string) => page.locator(`[data-testid="person-row"][data-user-id="${userId}"]`)
const waveToast = (page: Page, text: string) => page.getByTestId('wave-toast').filter({ hasText: text })

// The synced position of a player (what the server accepted), as the page sees it.
async function serverPosition(page: Page, userId: string): Promise<{ x: number; y: number } | undefined> {
  const player = (await snapshot(page))?.players.find((p) => p.userId === userId)
  return player && { x: player.x, y: player.y }
}

async function openChat(page: Page): Promise<void> {
  if ((await page.getByTestId('chat-bar').getAttribute('data-expanded')) !== 'true') await page.getByTestId('chat-toggle').click()
  await expect(page.getByTestId('chat-input')).toBeVisible()
}

// Types into the chat input and sends with Enter; resolves the id once the server has stored the message (shown
// with `shown`, by default the text itself).
async function send(page: Page, text: string, shown = text): Promise<string> {
  await openChat(page)
  const input = page.getByTestId('chat-input')
  await input.fill(text)
  await input.press('Enter')
  return storedId(page, shown)
}

// Waits until the page shows the stored message with this text; resolves its id.
async function storedId(page: Page, shown: string): Promise<string> {
  const row = storedRow(page, shown)
  await expect(row).toHaveCount(1)
  if (page === a) annSentAt = Date.now()
  return (await row.getAttribute('data-id')) ?? ''
}

// '@' + query, the first suggestion (which must be `label`) with Enter, then the rest of the message.
async function sendMention(page: Page, query: string, label: string, rest: string): Promise<string> {
  await openChat(page)
  const input = page.getByTestId('chat-input')
  await input.fill(`@${query}`)
  await expect(page.getByTestId('chat-mention-option').first()).toHaveText(`@${label}`)
  await input.press('Enter')
  await expect(input).toHaveValue(`@${label} `)
  await input.pressSequentially(rest)
  await input.press('Enter')
  return storedId(page, rest)
}

// GET request as the page's user (its cookies, through the Vite proxy).
async function getJson<T>(page: Page, path: string): Promise<{ status: number; body: T }> {
  const response = await page.request.get(path)
  return { status: response.status(), body: (await response.json()) as T }
}

// All of the office chat as the page's user sees it over HTTP, oldest first, and the page sizes.
async function fullHistory(page: Page): Promise<{ ids: string[]; pages: number[] }> {
  const ids: string[] = []
  const pages: number[] = []
  let before: string | undefined
  do {
    const { body } = await getJson<ChatHistoryResponse>(page, API.chat(office.id, before === undefined ? {} : { before }))
    ids.push(...body.messages.map((m) => m.id))
    pages.push(body.messages.length)
    before = body.nextBefore ?? undefined
  } while (before !== undefined)
  return { ids: ids.reverse(), pages }
}

async function createInvite(page: Page, role: 'member' | 'guest'): Promise<CreateInviteLinkResponse> {
  const response = await page.request.post(API.inviteLinks(office.id), { data: { role }, headers: { origin: CLIENT_ORIGIN } })
  expect(response.status()).toBe(201)
  return (await response.json()) as CreateInviteLinkResponse
}

// A new browser: opens the invite link, signs up, joins the company and enters the office.
async function joinByInvite(browser: Browser, url: string, person: { email: string; name: string }, company: string): Promise<Page> {
  const page = await newPage(browser)
  await page.goto(url)
  await page.getByTestId('invite-join').click()
  await signInWithCode(page, person.email)
  await expect(page.getByTestId('invite-join')).toHaveText(`Join ${company}`)
  await page.getByTestId('invite-join').click()
  await enterName(page, person.name)
  await expect(page).toHaveURL(new RegExp(`/office/${office.id}$`))
  await inOffice(page)
  return page
}

// A spot of the map with no avatar on it, so the click focuses the map without opening a profile card.
const focusMap = (page: Page) => page.locator('canvas').click({ position: { x: 12, y: 12 } })

test.afterAll(async () => {
  for (const person of headless) {
    await leaveRoom(person).catch(() => undefined)
    await person.api.dispose()
  }
})

test('members chat live, and the history survives a reload and pages back', async ({ browser }, testInfo) => {
  test.setTimeout(240_000)

  // Ann creates the company; Bob joins with a member link (no use limit, so the seed authors can use it too).
  a = await newPage(browser)
  await a.goto('/')
  await signInWithCode(a, ann.email)
  await enterName(a, ann.name)
  await a.getByTestId('company-name').fill('Chatco')
  await a.getByTestId('office-name').fill('Chat HQ')
  await a.getByTestId('create-company').click()
  await expect(a).toHaveURL(/\/office\/[A-Za-z0-9]+$/)
  annId = selfId(await inOffice(a))
  const officeId = new URL(a.url()).pathname.split('/').at(-1) ?? ''
  office = { id: officeId, orgId: (await getJson<{ office: { orgId: string } }>(a, API.office(officeId))).body.office.orgId }
  const invite = await createInvite(a, 'member')
  b = await joinByInvite(browser, invite.url, bob, 'Chatco')
  bobId = selfId((await snapshot(b)) as OfficeSnapshot)

  // Enter on the map opens the chat and puts the cursor in it. Ann sends a message with a link.
  await focusMap(a)
  await a.keyboard.press('Enter')
  await expect(a.getByTestId('chat-input')).toBeFocused()
  await expect(a.getByTestId('chat-bar')).toHaveAttribute('data-expanded', 'true')
  await a.keyboard.type('Hello Bob, the plan is at https://example.com/plan')
  await a.keyboard.press('Enter')
  await storedId(a, 'Hello Bob')

  // Bob's bar is one line: the newest message and the unread badge. Opened, it shows the message, and the link opens
  // in a new tab without access to this page.
  await expect(b.getByTestId('chat-bar')).toHaveAttribute('data-expanded', 'false')
  await expect(b.getByTestId('chat-preview')).toContainText('Ann: Hello Bob, the plan is at https://example.com/plan')
  await expect(b.getByTestId('chat-unread')).toHaveText('1')
  await screenshot(b, 'chat-bob-collapsed-unread', testInfo)
  await b.getByTestId('chat-toggle').click()
  const hello = storedRow(b, 'Hello Bob')
  await expect(hello).toHaveCount(1)
  await expect(b.getByTestId('chat-unread')).toHaveCount(0)
  const link = hello.locator('a')
  await expect(link).toHaveAttribute('href', 'https://example.com/plan')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')

  // A mention comes from the autocomplete and is stored as Bob's id, not as the name typed.
  await a.keyboard.type('@Bo')
  await expect(a.getByTestId('chat-mention-option')).toHaveText(['@Bob'])
  await a.keyboard.press('Enter')
  await expect(a.getByTestId('chat-input')).toHaveValue('@Bob ')
  await a.keyboard.type('lunch at noon?')
  await a.keyboard.press('Enter')
  await storedId(a, 'lunch at noon?')
  const mention = storedRow(b, 'lunch at noon?')
  await expect(mention).toHaveAttribute('data-mentions-me', 'true')
  await expect(mention.locator(`[data-mention="${bobId}"]`)).toHaveText('@Bob')
  const newest = (await getJson<ChatHistoryResponse>(b, API.chat(office.id))).body.messages[0]
  expect(newest?.body).toBe(`${mentionToken(bobId)} lunch at noon?`)

  // More people send through the room, as fast as the rate limit lets each of them.
  const joined = await Promise.all(
    Array.from({ length: SEED_AUTHORS }, (_, i) => {
      const n = String(i + 1).padStart(2, '0')
      return headlessMember(`chat-sam${n}-${run}@example.com`, `Sam ${n}`, invite.token)
    }),
  )
  headless.push(...joined)
  await Promise.all(headless.map((person) => enterRoom(person, office.id)))
  await Promise.all(
    headless.map(async (person) => {
      for (let k = 1; k <= CHAT_RATE_LIMIT.messages; k++) await say(person, `seed from ${person.name}, number ${k}`)
    }),
  )
  const total = 2 + SEED_AUTHORS * CHAT_RATE_LIMIT.messages
  await expect(stored(b)).toHaveCount(total)
  // Everyone but Sam 01 leaves again (Sam waves and mentions later).
  await Promise.all(headless.slice(1).map((person) => leaveRoom(person)))

  const history = await fullHistory(b)
  expect(history.pages).toEqual([CHAT_PAGE_SIZE, CHAT_PAGE_SIZE, total - 2 * CHAT_PAGE_SIZE])
  const shownIds = () => stored(b).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-id') ?? ''))

  // Bob reloads: the newest page, scrolled to the newest message.
  await b.reload()
  await inOffice(b)
  await expect(b.getByTestId('chat-bar')).toHaveAttribute('data-expanded', 'true')
  await expect(stored(b)).toHaveCount(CHAT_PAGE_SIZE)
  expect(await shownIds()).toEqual(history.ids.slice(-CHAT_PAGE_SIZE))
  await expect(stored(b).last()).toBeInViewport()
  await expect(b.getByTestId('chat-load-older')).toBeVisible()

  // Scrolling to the top loads the next older page above, and the messages in view stay in view.
  const list = b.getByTestId('chat-list')
  for (const count of [2 * CHAT_PAGE_SIZE, total]) {
    const firstId = await stored(b).first().getAttribute('data-id')
    await list.evaluate((el) => {
      el.scrollTop = 0
    })
    await expect(stored(b)).toHaveCount(count)
    await expect(b.locator(`[data-testid="chat-message"][data-id="${firstId}"]`)).toBeInViewport()
  }
  await expect(b.getByTestId('chat-load-older')).toHaveCount(0)
  await expect(b.getByText('This is the start of the chat.')).toBeVisible()

  // No gaps and no duplicates: the list is exactly the history the server pages out, in order.
  const shown = await shownIds()
  expect(new Set(shown).size).toBe(total)
  expect(shown).toEqual(history.ids)
  expect((await snapshot(b))?.chat?.ids).toEqual(history.ids)
  await expect(storedRow(b, 'Hello Bob')).toHaveCount(1)
  await screenshot(b, 'chat-bob-history-paged', testInfo)

  // Back at the bottom, everything counts as read.
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect
    .poll(async () => (await getJson<ChatUnreadResponse>(b, API.chatUnread(office.id))).body, { timeout: 10_000 })
    .toMatchObject({ count: 0, mentions: 0 })
})

test('typing in the chat never moves the avatar', async () => {
  const testInfo = test.info()
  const input = a.getByTestId('chat-input')
  await focusMap(a)
  await expect(input).not.toBeFocused()
  await a.keyboard.press('Enter')
  await expect(input).toBeFocused()
  const local = await standStill(a)
  const onServer = await serverPosition(a, annId)
  const seenByBob = await serverPosition(b, annId)
  expect(onServer).toBeDefined()

  // Letters that walk (WASD) and sit (E), and the arrow keys, held down, all stay in the input.
  await a.keyboard.type('wasd e')
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await a.keyboard.down(key)
    await a.waitForTimeout(300)
    await a.keyboard.up(key)
  }
  await expect(input).toHaveValue('wasd e')
  await a.waitForTimeout(500)
  expect(await localPosition(a)).toEqual(local)
  expect(await serverPosition(a, annId)).toEqual(onServer)
  expect(await serverPosition(b, annId)).toEqual(seenByBob)
  expect((await snapshot(a))?.local).toMatchObject({ seatId: '', walking: false })
  expect((await snapshot(a))?.rejects).toBe(0)
  await screenshot(a, 'chat-ann-typing', testInfo)

  // Esc gives the keyboard back to the map: the arrow keys walk again, and Bob sees it.
  await input.press('Escape')
  await expect(input).not.toBeFocused()
  await a.keyboard.down('ArrowRight')
  await a.waitForTimeout(300)
  await a.keyboard.up('ArrowRight')
  const walked = await standStill(a)
  expect(walked.x).toBeGreaterThan(local.x + 10)
  await expect.poll(async () => (await serverPosition(b, annId))?.x ?? 0).toBeGreaterThan((seenByBob?.x ?? 0) + 10)

  // The draft survives closing and opening the bar.
  await a.getByTestId('chat-toggle').click()
  await expect(a.getByTestId('chat-bar')).toHaveAttribute('data-expanded', 'false')
  await expect(input).toBeHidden()
  await a.getByTestId('chat-toggle').click()
  await expect(input).toHaveValue('wasd e')
  await input.fill('')
})

test('a sixth message within 10 s is rejected, and goes out after the window', async () => {
  const testInfo = test.info()
  test.setTimeout(60_000)
  // Ann's earlier messages are out of the window.
  await a.waitForTimeout(Math.max(0, annSentAt + CHAT_RATE_LIMIT.windowMs + 500 - Date.now()))
  const started = Date.now()
  for (let i = 1; i <= CHAT_RATE_LIMIT.messages; i++) await send(a, `burst ${i} of 6`)
  const input = a.getByTestId('chat-input')
  await input.fill('burst 6 of 6')
  await input.press('Enter')
  const sixth = a.locator('[data-testid="chat-message"][data-pending="true"]').filter({ hasText: 'burst 6 of 6' })
  await expect(sixth).toHaveAttribute('data-failed', 'true')
  await expect(sixth).toContainText('Not sent')
  await expect(a.getByTestId('chat-error')).toHaveText('Slow down: at most 5 messages in 10 seconds.')
  expect(Date.now() - started).toBeLessThan(CHAT_RATE_LIMIT.windowMs)
  await expect(storedRow(b, 'burst 5 of 6')).toHaveCount(1)
  await expect(storedRow(b, 'burst 6 of 6')).toHaveCount(0)
  await screenshot(a, 'chat-ann-rate-limited', testInfo)

  // Once the first of the five is 10 s old, Retry sends it (same clientMsgId) and Bob gets it.
  await a.waitForTimeout(Math.max(0, started + CHAT_RATE_LIMIT.windowMs + 1000 - Date.now()))
  await sixth.getByTestId('chat-retry').click()
  await expect(storedRow(a, 'burst 6 of 6')).toHaveCount(1)
  await expect(a.locator('[data-testid="chat-message"][data-pending="true"]')).toHaveCount(0)
  annSentAt = Date.now()
  await expect(storedRow(b, 'burst 6 of 6')).toHaveCount(1)
})

test('a guest sees only the messages sent after joining', async ({ browser }, testInfo) => {
  test.setTimeout(90_000)
  const invite = await createInvite(a, 'guest')
  const g = await joinByInvite(browser, invite.url, gus, 'Chatco')
  try {
    // None of the 100+ earlier messages: not in the bar, not over HTTP, not in the unread count.
    await g.getByTestId('chat-toggle').click()
    await expect(g.getByText('No messages yet. Say hello!')).toBeVisible()
    await expect(g.getByTestId('chat-message')).toHaveCount(0)
    await expect(g.getByTestId('chat-unread')).toHaveCount(0)
    expect((await getJson<ChatHistoryResponse>(g, API.chat(office.id))).body).toEqual({ messages: [], nextBefore: null })
    expect((await getJson<ChatUnreadResponse>(g, API.chatUnread(office.id))).body).toMatchObject({ count: 0, mentions: 0 })
    expect((await getJson(g, API.members(office.id))).status).toBe(403)

    // A message after the join: live, and still there after a reload, alone.
    await send(a, 'Welcome, Gus!')
    await expect(storedRow(g, 'Welcome, Gus!')).toHaveCount(1)
    await g.reload()
    await inOffice(g)
    await expect(storedRow(g, 'Welcome, Gus!')).toHaveCount(1)
    await expect(g.getByTestId('chat-message')).toHaveCount(1)
    expect((await getJson<ChatHistoryResponse>(g, API.chat(office.id))).body.messages.map((m) => m.body)).toEqual(['Welcome, Gus!'])
    await screenshot(g, 'chat-guest-history', testInfo)

    // Guests cannot mention everyone: no @everyone in their list, and a typed token is stored as plain text.
    const input = g.getByTestId('chat-input')
    await input.fill('@')
    await expect(g.getByTestId('chat-mention-option').filter({ hasText: 'Ann' })).toHaveCount(1)
    await expect(g.getByTestId('chat-mention-option').filter({ hasText: '@everyone' })).toHaveCount(0)
    await send(g, '<!everyone> hello from the guest', 'hello from the guest')
    const fromGuest = storedRow(a, 'hello from the guest')
    await expect(fromGuest).toHaveText(/@everyone hello from the guest/)
    await expect(fromGuest.locator('[data-mention]')).toHaveCount(0)
    expect((await getJson<ChatHistoryResponse>(a, API.chat(office.id))).body.messages[0]?.body).toBe('@everyone hello from the guest')
    await a.getByTestId('chat-input').fill('@ev')
    await expect(a.getByTestId('chat-mention-option')).toHaveText(['@everyone'])
    await a.getByTestId('chat-input').fill('')
  } finally {
    await g.context().close()
  }
})

test('status, DND and blocks: busy in a meeting room, no waves on DND, a block hides messages', async () => {
  const testInfo = test.info()
  test.setTimeout(120_000)
  const sam = headless[0]
  if (!sam?.room) throw new Error('Sam 01 is not in the room')
  await b.getByTestId('people-toggle').click()
  const annRow = personRow(b, annId)
  await expect(annRow).toHaveAttribute('data-status', 'available')

  // A status text, saved in Ann's prefs and shown to Bob.
  await a.getByTestId('status-menu').click()
  await a.getByTestId('status-text').fill('Planning the offsite')
  await a.getByTestId('status-text-save').click()
  await expect(annRow).toContainText('Planning the offsite')
  await expect
    .poll(async () => (await getJson<{ statusText: string }>(a, API.prefs(office.orgId))).body.statusText)
    .toBe('Planning the offsite')
  await a.keyboard.press('Escape')
  await expect(a.getByTestId('status-panel')).toHaveCount(0)

  // In the meeting room (a room-mode zone) Ann shows as busy by herself.
  await arrive(a, { x: 368, y: 356 })
  await arrive(a, { x: 368, y: 508 })
  await expect(toast(a, 'Entered Meeting room')).toBeVisible()
  await expect(annRow).toHaveAttribute('data-status', 'busy')
  await expect(a.getByTestId('status-menu')).toContainText('Busy (meeting room)')

  // Do not disturb wins over busy. Bob's card offers no Wave, and a wave sent anyway does not arrive.
  await a.getByTestId('status-menu').click()
  await a.getByTestId('status-option-dnd').check()
  await expect(a.getByTestId('status-menu')).toHaveAttribute('data-chosen-status', 'dnd')
  await a.keyboard.press('Escape')
  await expect(annRow).toHaveAttribute('data-status', 'dnd')
  await annRow.click()
  const card = b.getByTestId('profile-card')
  await expect(card).toHaveAttribute('data-user-id', annId)
  await expect(card.getByTestId('profile-status')).toContainText('Do not disturb')
  await expect(card.getByTestId('profile-status-text')).toHaveText('Planning the offsite')
  await expect(card.getByTestId('profile-wave')).toBeDisabled()
  sam.room.send(MSG.wave, { targetUserId: annId })
  // The room handles messages in order: once this answer is back, the wave was handled.
  await sam.room.request(MSG.statusSet, { status: 'available' })
  await a.waitForTimeout(1000)
  await expect(a.getByTestId('wave-toast')).toHaveCount(0)
  await screenshot(b, 'chat-bob-sees-ann-dnd', testInfo)

  // Available again (busy, still in the meeting room): both waves arrive.
  await a.getByTestId('status-menu').click()
  await a.getByTestId('status-option-available').check()
  await a.keyboard.press('Escape')
  await expect(annRow).toHaveAttribute('data-status', 'busy')
  sam.room.send(MSG.wave, { targetUserId: annId })
  await expect(waveToast(a, 'Sam 01 waved at you')).toBeVisible()
  await expect(card.getByTestId('profile-wave')).toBeEnabled()
  await card.getByTestId('profile-wave').click()
  await expect(waveToast(a, 'Bob waved at you')).toBeVisible()

  // Bob blocks Ann: her messages fold into one line, and new ones never show up.
  await card.getByTestId('profile-block').click()
  await expect(card.getByTestId('profile-block')).toHaveText('Unblock')
  await expect(b.locator(`[data-testid="chat-message"][data-author-id="${annId}"]`)).toHaveCount(0)
  await expect(b.getByTestId('chat-blocked').first()).toBeVisible()
  const hidden = await send(a, 'Bob, are you there?')
  await expect.poll(async () => (await snapshot(b))?.chat?.ids.includes(hidden)).toBe(true)
  await expect(b.locator(`[data-id="${hidden}"]`)).toHaveCount(0)
  await screenshot(b, 'chat-bob-blocked-ann', testInfo)

  // No mentions between them: with the bar closed, Ann's mention of Bob counts for nothing, Sam's does.
  await expect
    .poll(async () => (await getJson<ChatUnreadResponse>(b, API.chatUnread(office.id))).body, { timeout: 10_000 })
    .toMatchObject({ count: 0, mentions: 0 })
  await b.getByTestId('chat-toggle').click()
  await expect(b.getByTestId('chat-bar')).toHaveAttribute('data-expanded', 'false')
  await sendMention(a, 'Bo', 'Bob', 'are you still blocking me?')
  await say(sam, `${mentionToken(bobId)} Sam's mention`)
  await expect(b.getByTestId('chat-unread')).toHaveText('1')
  await expect(b.getByTestId('chat-unread-mentions')).toHaveText('@1')
  expect((await getJson<ChatUnreadResponse>(b, API.chatUnread(office.id))).body).toMatchObject({ count: 1, mentions: 1 })

  // Nor waves: Ann (who is not told about the block) waves, and Bob gets nothing.
  await a.getByTestId('people-toggle').click()
  await personRow(a, bobId).click()
  const annCard = a.getByTestId('profile-card')
  await expect(annCard).toHaveAttribute('data-user-id', bobId)
  await annCard.getByTestId('profile-wave').click()
  await expect(toast(a, 'You waved at Bob')).toBeVisible()
  await b.waitForTimeout(1500)
  await expect(b.getByTestId('wave-toast')).toHaveCount(0)
  await annCard.getByTestId('profile-close').click()
  await a.getByTestId('people-toggle').click()

  // Bob unblocks Ann: her messages are back.
  await card.getByTestId('profile-block').click()
  await expect(card.getByTestId('profile-block')).toHaveText('Block')
  await b.getByTestId('chat-toggle').click()
  await expect(b.locator(`[data-id="${hidden}"]`)).toHaveCount(1)
  await card.getByTestId('profile-close').click()
  await b.getByTestId('people-toggle').click()
  await expect(b.getByTestId('people-panel')).toHaveCount(0)
})

test('an owner mutes and kicks a member; the kicked member can enter again', async () => {
  const testInfo = test.info()
  test.setTimeout(90_000)
  await a.getByTestId('people-toggle').click()
  await personRow(a, bobId).click()
  const card = a.getByTestId('profile-card')
  await expect(card).toHaveAttribute('data-user-id', bobId)

  // Muted for 15 minutes: Bob is told at once, and his bar does not send.
  await card.getByTestId('profile-mute').selectOption('15')
  await expect(card.getByTestId('profile-notice')).toContainText('Bob is muted until')
  await expect(b.getByTestId('chat-muted')).toContainText('You are muted until')
  await b.getByTestId('chat-input').fill('Can I still talk?')
  await b.getByTestId('chat-input').press('Enter')
  await expect(b.getByTestId('chat-error')).toContainText('You are muted until')
  await screenshot(b, 'chat-bob-muted', testInfo)

  // The server holds the mute too: after a reload the page does not know, sends, and the room refuses.
  await b.reload()
  await inOffice(b)
  await openChat(b)
  await b.getByTestId('chat-input').fill('Am I muted?')
  await b.getByTestId('chat-input').press('Enter')
  const refused = b.locator('[data-testid="chat-message"][data-pending="true"]').filter({ hasText: 'Am I muted?' })
  await expect(refused).toHaveAttribute('data-failed', 'true')
  await expect(refused).toContainText('You are muted until')
  await expect(b.getByTestId('chat-error')).toContainText('You are muted until')
  await expect(storedRow(a, 'Am I muted?')).toHaveCount(0)

  // Unmuted: Retry goes through.
  await card.getByTestId('profile-mute').selectOption('0')
  await expect(card.getByTestId('profile-notice')).toHaveText('Bob is unmuted.')
  await expect(b.getByTestId('chat-muted')).toHaveCount(0)
  await expect(b.getByTestId('chat-error')).toHaveCount(0)
  await refused.getByTestId('chat-retry').click()
  const message = storedRow(a, 'Am I muted?')
  await expect(message).toHaveCount(1)
  await expect(storedRow(b, 'Am I muted?')).toHaveCount(1)

  // An owner may delete anyone's message; everyone sees the tombstone.
  const id = await message.getAttribute('data-id')
  const row = (page: Page) => page.locator(`[data-testid="chat-message"][data-id="${id}"]`)
  await row(a).hover()
  await row(a).getByTestId('chat-delete').click()
  await row(a).getByTestId('chat-delete-confirm').click()
  await expect(row(a)).toContainText('Message deleted')
  await expect(row(b)).toContainText('Message deleted')

  // Kicked: Bob's connection closes with the removed screen; he stays a member and enters again.
  await card.getByTestId('profile-kick').click()
  await card.getByTestId('profile-kick-confirm').click()
  await expect(card.getByTestId('profile-notice')).toContainText('Bob was removed from the office')
  const closed = b.getByTestId('connection-closed')
  await expect(closed).toHaveAttribute('data-reason', 'kicked')
  await expect(closed.getByRole('heading')).toHaveText('Removed from the office')
  await expect.poll(async () => (await snapshot(a))?.players.some((p) => p.userId === bobId)).toBe(false)
  await screenshot(b, 'chat-bob-kicked', testInfo)
  await closed.getByTestId('reconnect').click()
  await expect(closed).toHaveCount(0)
  await inOffice(b)
  await expect.poll(async () => (await snapshot(a))?.players.some((p) => p.userId === bobId)).toBe(true)
  await expect(personRow(a, bobId)).toHaveAttribute('data-online', 'true')
})
