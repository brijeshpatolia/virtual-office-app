import { Client, type Room } from '@colyseus/sdk'
import { expect, request, type APIRequestContext, type APIResponse, type Browser, type Page, type TestInfo } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { API, ChatSendResponseSchema, MSG, ROOM_NAME, type ChatMessage } from '../packages/shared/src/protocol/index.ts'
import { CLIENT_ORIGIN, e2eDataDir, SERVER_PORT } from './env.ts'

// window.__voOffice of the office page (apps/client/src/game/session/OfficeSession.ts).
export interface OfficeSnapshot {
  sessionId: string
  rejects: number
  lastReject: { x: number; y: number; seq: number; reason: string } | null
  local: { x: number; y: number; dir: string; seatId: string; zoneId: string; status: string; walking: boolean; pose: string } | null
  players: Array<{
    sessionId: string
    userId: string
    name: string
    x: number
    y: number
    seatId: string
    zoneId: string
    // How the page draws the other avatars (null for the own one).
    rendered: { x: number; y: number; dir: string; pose: string } | null
  }>
  seats: Record<string, string>
  // The chat bar's model: loaded message ids (oldest first), messages on their way, unread counts.
  chat?: { ids: string[]; pending: number; unread: number; mentions: number }
}

declare global {
  interface Window {
    __voOffice?: { snapshot(): OfficeSnapshot; walkTo?(x: number, y: number): void }
  }
}

export interface Point {
  x: number
  y: number
}

export async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext()
  return context.newPage()
}

// PNGs in E2E_SCREENSHOT_DIR when set, else in the test's output folder; always attached to the report.
export async function screenshot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  const dir = process.env.E2E_SCREENSHOT_DIR
  const path = dir ? `${dir}/${name}.png` : testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

export function toast(page: Page, text: string) {
  return page.getByTestId('toast').filter({ hasText: text })
}

// Positions travel as float32.
export function near(value: number | undefined, expected: number): boolean {
  return value !== undefined && Math.abs(value - expected) < 0.5
}

// walkTo that must get all the way.
export async function arrive(page: Page, target: Point): Promise<void> {
  const at = await walkTo(page, target.x, target.y)
  const message = `at (${at.x}, ${at.y}), wanted (${target.x}, ${target.y}): ${JSON.stringify(await snapshot(page))}`
  expect(near(at.x, target.x) && near(at.y, target.y), message).toBe(true)
}

// The newest sign-in code mailed to `email`, from the dev mailer's log ({to, subject, text, at} per line).
async function latestCode(email: string): Promise<string | undefined> {
  const log = await readFile(join(e2eDataDir(), 'dev-mail.log'), 'utf8').catch(() => '')
  const mails = log
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { to: string; text: string })
  return mails
    .filter((mail) => mail.to === email)
    .at(-1)
    ?.text.match(/code is (\d{6})/)?.[1]
}

async function codeFor(email: string): Promise<string> {
  let code: string | undefined
  await expect.poll(async () => (code = await latestCode(email)), { message: `sign-in code for ${email}` }).toBeTruthy()
  return code ?? ''
}

// On the login page: email -> code from the dev mail log -> signed in. New users then get the name prompt.
export async function signInWithCode(page: Page, email: string): Promise<void> {
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-send-code').click()
  await expect(page.getByTestId('login-code')).toBeVisible()
  await page.getByTestId('login-code').fill(await codeFor(email))
  await page.getByTestId('login-verify').click()
}

export async function enterName(page: Page, name: string): Promise<void> {
  await page.getByTestId('name-input').fill(name)
  await page.getByTestId('name-submit').click()
}

export function snapshot(page: Page): Promise<OfficeSnapshot | null> {
  return page.evaluate(() => window.__voOffice?.snapshot() ?? null)
}

// Waits until the page is in the office room with its own avatar, and returns the snapshot.
export async function inOffice(page: Page): Promise<OfficeSnapshot> {
  await page.waitForFunction(() => window.__voOffice?.snapshot().local != null)
  const snap = await snapshot(page)
  if (!snap) throw new Error('No office on the page')
  return snap
}

export async function localPosition(page: Page): Promise<Point> {
  const local = (await snapshot(page))?.local
  if (!local) throw new Error('The own avatar is not on the page')
  return { x: local.x, y: local.y }
}

// Waits until the own avatar has not moved for a moment.
export async function standStill(page: Page): Promise<Point> {
  let last = await localPosition(page)
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(150)
    const now = await localPosition(page)
    if (now.x === last.x && now.y === last.y) return now
    last = now
  }
  throw new Error('The avatar does not stand still')
}

const KEYS = { x: ['ArrowLeft', 'ArrowRight'], y: ['ArrowUp', 'ArrowDown'] } as const

// Keyboard: holds the arrow key towards `target` (the avatar's sprite centre on `axis`) until the avatar gets
// there, then lets go. The key goes up a frame or two later, and software-rendered headless Chromium draws few
// frames, so the avatar overshoots by up to ~30 px. Use walkTo() where the path is narrow.
export async function walk(page: Page, axis: 'x' | 'y', target: number): Promise<Point> {
  const forward = target > (await localPosition(page))[axis]
  const key = KEYS[axis][forward ? 1 : 0]
  await page.keyboard.down(key)
  try {
    await page.waitForFunction(
      ({ axis, target, forward }) => {
        const local = window.__voOffice?.snapshot().local
        return local != null && (forward ? local[axis] >= target : local[axis] <= target)
      },
      { axis, target, forward },
      { polling: 'raf', timeout: 20_000 },
    )
  } finally {
    await page.keyboard.up(key)
  }
  return standStill(page)
}

// The dev-only autopilot (window.__voOffice.walkTo): a straight walk at MAX_SPEED that sends the usual moves, so the
// server checks every step. Resolves where the walk ended: the target, or where a move:reject put the avatar.
export async function walkTo(page: Page, x: number, y: number): Promise<Point> {
  await page.evaluate(({ x, y }) => {
    const office = window.__voOffice
    if (!office?.walkTo) throw new Error('walkTo exists only in dev builds of the client')
    office.walkTo(x, y)
  }, { x, y })
  await page.waitForFunction(() => window.__voOffice?.snapshot().local?.walking === false, null, { timeout: 20_000 })
  return standStill(page)
}

// Holds the key until the avatar stops moving (it walks into something), then lets go.
export async function walkUntilBlocked(page: Page, key: (typeof KEYS)[keyof typeof KEYS][number]): Promise<Point> {
  await page.keyboard.down(key)
  try {
    let last = await localPosition(page)
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(150)
      const now = await localPosition(page)
      if (now.x === last.x && now.y === last.y) return now
      last = now
    }
    throw new Error(`The avatar did not stop (key ${key})`)
  } finally {
    await page.keyboard.up(key)
  }
}

// Someone without a browser: signs up over HTTP straight to the e2e server and enters the office room with the
// Colyseus SDK in Node, so a test can add several chat authors quickly. Each has its own X-Forwarded-For, so Better
// Auth's per-IP limits on codes and sign-ins never count them with the browsers.
export interface Headless {
  userId: string
  name: string
  api: APIRequestContext
  room: Room | null
}

const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`
let headlessCount = 0

async function ok(response: Promise<APIResponse>): Promise<APIResponse> {
  const answer = await response
  if (!answer.ok()) throw new Error(`${answer.url()}: ${answer.status()} ${await answer.text()}`)
  return answer
}

// Signs up `email` with `name` and joins the company of the invite link `token`.
export async function headlessMember(email: string, name: string, inviteToken: string): Promise<Headless> {
  const n = ++headlessCount
  const api = await request.newContext({
    baseURL: SERVER_URL,
    extraHTTPHeaders: { origin: CLIENT_ORIGIN, 'x-forwarded-for': `10.77.${Math.floor(n / 250)}.${(n % 250) + 1}` },
  })
  await ok(api.post('/api/auth/email-otp/send-verification-otp', { data: { email, type: 'sign-in' } }))
  const otp = await codeFor(email)
  const signedIn = (await (await ok(api.post('/api/auth/sign-in/email-otp', { data: { email, otp, name } }))).json()) as { user: { id: string } }
  await ok(api.post(API.acceptInviteLink(inviteToken), { data: {} }))
  return { userId: signedIn.user.id, name, api, room: null }
}

export async function enterRoom(person: Headless, officeId: string): Promise<Room> {
  const { token } = (await (await ok(person.api.get(API.rtToken(officeId)))).json()) as { token: string }
  const client = new Client(SERVER_URL)
  client.auth.token = token
  const room = await client.joinOrCreate(ROOM_NAME, { officeId })
  // The pushes (chat:new, waves) are not needed here; a handler keeps the SDK from warning about each one.
  room.onMessage('*', () => undefined)
  person.room = room
  return room
}

// chat:send through the room, as the chat bar sends it; resolves the stored message.
export async function say(person: Headless, body: string): Promise<ChatMessage> {
  if (!person.room) throw new Error(`${person.name} is not in the room`)
  return ChatSendResponseSchema.parse(await person.room.request(MSG.chatSend, { clientMsgId: randomUUID(), body })).message
}

export async function leaveRoom(person: Headless): Promise<void> {
  await person.room?.leave()
  person.room = null
}
