import { expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { e2eDataDir } from './env.ts'

// window.__voOffice of the office page (apps/client/src/game/session/OfficeSession.ts).
export interface OfficeSnapshot {
  sessionId: string
  rejects: number
  lastReject: { x: number; y: number; seq: number; reason: string } | null
  local: { x: number; y: number; dir: string; seatId: string; zoneId: string; status: string; walking: boolean } | null
  players: Array<{ sessionId: string; userId: string; name: string; x: number; y: number; seatId: string; zoneId: string }>
  seats: Record<string, string>
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

// On the login page: email -> code from the dev mail log -> signed in. New users then get the name prompt.
export async function signInWithCode(page: Page, email: string): Promise<void> {
  await page.getByTestId('login-email').fill(email)
  await page.getByTestId('login-send-code').click()
  await expect(page.getByTestId('login-code')).toBeVisible()
  let code: string | undefined
  await expect.poll(async () => (code = await latestCode(email)), { message: `sign-in code for ${email}` }).toBeTruthy()
  await page.getByTestId('login-code').fill(code ?? '')
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
