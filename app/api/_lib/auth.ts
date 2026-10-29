import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * One password for the whole deployment (APP_PASSWORD). Signing in sets a signed, HttpOnly cookie, so no secret is ever kept
 * in the page or in browser storage. There are no accounts and nothing is stored on the server: the cookie is an expiry time
 * plus an HMAC keyed from the password, so changing the password signs every device out.
 *
 * The scheduled cron and scripts keep using `Authorization: Bearer $CRON_SECRET` for the ingest endpoint.
 */
export const COOKIE = 'sa_session'
export const SESSION_DAYS = 30

type Env = Record<string, string | undefined>

const key = (password: string) => createHmac('sha256', 'stock-analyzer-session-v1').update(password).digest()
const sign = (exp: number, password: string) => createHmac('sha256', key(password)).update(String(exp)).digest('base64url')

function same(a: string, b: string): boolean {
  // Hash first so the comparison takes the same time whatever the lengths.
  const x = createHash('sha256').update(a).digest()
  const y = createHash('sha256').update(b).digest()
  return timingSafeEqual(x, y)
}

export const passwordMatches = (given: string, password: string) => same(given, password)

export function mintSession(password: string, now: number): string {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86_400
  return `${exp}.${sign(exp, password)}`
}

export function validSession(token: string | undefined, password: string | undefined, now: number): boolean {
  if (!token || !password) return false
  const dot = token.indexOf('.')
  const exp = Number(token.slice(0, dot))
  if (dot <= 0 || !Number.isInteger(exp) || exp * 1000 <= now) return false
  return same(token.slice(dot + 1), sign(exp, password))
}

export function cookieOf(req: IncomingMessage, name: string): string | undefined {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return undefined
}

export const hasSession = (req: IncomingMessage, env: Env = process.env, now = Date.now()) => validSession(cookieOf(req, COOKIE), env.APP_PASSWORD, now)

/** A signed-in browser, or the cron/script secret. Either one alone is enough; an unset secret never matches. */
export function isAuthorized(req: IncomingMessage, env: Env = process.env, now = Date.now()): boolean {
  if (hasSession(req, env, now)) return true
  const secret = env.CRON_SECRET
  return !!secret && same(String(req.headers.authorization ?? ''), `Bearer ${secret}`)
}

const cookie = (value: string, maxAge: number, secure: boolean) => `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`

/**
 * Failed sign-ins are slowed and then refused. Serverless instances do not share memory, so this only slows guessing against
 * one instance; a long random password is what actually protects it.
 */
export function createLoginGuard(max = 8, windowMs = 10 * 60_000) {
  let fails: number[] = []
  return {
    blocked: (now: number) => (fails = fails.filter(t => now - t < windowMs)).length >= max,
    fail: (now: number) => { fails.push(now) },
    reset: () => { fails = [] },
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<{ password?: unknown }> {
  const pre = (req as { body?: unknown }).body
  if (pre && typeof pre === 'object' && !Buffer.isBuffer(pre)) return pre as { password?: unknown }
  const text = typeof pre === 'string' ? pre : Buffer.isBuffer(pre) ? pre.toString('utf8') : await new Promise<string>((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => { size += c.length; if (size > 2048) { reject(new Error('too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
  return JSON.parse(text) as { password?: unknown }
}

/** GET: who am I. POST: sign in with `{ password }`. DELETE: sign out. */
export function createAuthHandler(env: Env = process.env, delayMs = 800) {
  const guard = createLoginGuard()
  const secure = !!env.VERCEL
  return async (req: IncomingMessage, res: ServerResponse) => {
    const now = Date.now()
    const password = env.APP_PASSWORD
    if (req.method === 'GET') return send(res, 200, { configured: !!password, signedIn: hasSession(req, env, now) })
    if (req.method === 'DELETE') {
      res.setHeader('set-cookie', cookie('', 0, secure))
      return send(res, 200, { signedIn: false })
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'Use GET, POST or DELETE.' })
    if (!password) return send(res, 503, { error: 'APP_PASSWORD is not set on this deployment.' })
    // A sign-in must come from this app's own page, never another site.
    const origin = req.headers.origin
    if (typeof origin === 'string') {
      let host = ''
      try { host = new URL(origin).host } catch { /* refused below */ }
      if (host !== req.headers.host) return send(res, 403, { error: 'Cross-origin sign-in is not allowed.' })
    }
    if (guard.blocked(now)) return send(res, 429, { error: 'Too many failed attempts. Try again in a few minutes.' })
    let given: unknown
    try { given = (await readBody(req)).password } catch { return send(res, 400, { error: 'Invalid request body.' }) }
    if (typeof given !== 'string' || !passwordMatches(given, password)) {
      guard.fail(now)
      if (delayMs) await new Promise(r => setTimeout(r, delayMs))
      return send(res, 401, { error: 'Wrong password.' })
    }
    guard.reset()
    res.setHeader('set-cookie', cookie(mintSession(password, now), SESSION_DAYS * 86_400, secure))
    send(res, 200, { signedIn: true })
  }
}
