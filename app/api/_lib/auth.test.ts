import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { COOKIE, SESSION_DAYS, createAuthHandler, createLoginGuard, isAuthorized, mintSession, validSession } from './auth'

const NOW = 1_800_000_000_000
const env = { APP_PASSWORD: 'correct horse', CRON_SECRET: 'cron-secret' }
const req = (headers: Record<string, string> = {}, extra: Partial<IncomingMessage> = {}) => ({ headers, ...extra }) as unknown as IncomingMessage

describe('session cookie', () => {
  it('is valid for its lifetime, then expires', () => {
    const t = mintSession('pw', NOW)
    expect(validSession(t, 'pw', NOW)).toBe(true)
    expect(validSession(t, 'pw', NOW + (SESSION_DAYS * 86_400 - 5) * 1000)).toBe(true)
    expect(validSession(t, 'pw', NOW + (SESSION_DAYS * 86_400 + 5) * 1000)).toBe(false)
  })
  it('is rejected when forged, tampered with, or the password changed', () => {
    const t = mintSession('pw', NOW)
    expect(validSession(t, 'other', NOW)).toBe(false)
    const [exp, sig] = t.split('.')
    expect(validSession(`${Number(exp) + 9999}.${sig}`, 'pw', NOW)).toBe(false)
    for (const bad of [undefined, '', 'x', '.', 'abc.def', `${exp}.`]) expect(validSession(bad, 'pw', NOW), String(bad)).toBe(false)
    expect(validSession(t, undefined, NOW)).toBe(false)
  })
})

describe('isAuthorized', () => {
  it('accepts a signed-in cookie or the cron secret, and nothing else', () => {
    expect(isAuthorized(req({ cookie: `${COOKIE}=${mintSession(env.APP_PASSWORD, NOW)}` }), env, NOW)).toBe(true)
    expect(isAuthorized(req({ cookie: `a=b; ${COOKIE}=${mintSession(env.APP_PASSWORD, NOW)}` }), env, NOW)).toBe(true)
    expect(isAuthorized(req({ authorization: 'Bearer cron-secret' }), env, NOW)).toBe(true)
    expect(isAuthorized(req({ authorization: 'Bearer nope' }), env, NOW)).toBe(false)
    expect(isAuthorized(req({}), env, NOW)).toBe(false)
  })
  it('never matches an unset secret, so an empty header cannot get in', () => {
    expect(isAuthorized(req({ authorization: 'Bearer ' }), { CRON_SECRET: '' }, NOW)).toBe(false)
    expect(isAuthorized(req({ cookie: `${COOKIE}=${mintSession('', NOW)}` }), {}, NOW)).toBe(false)
  })
})

describe('login guard', () => {
  it('blocks after repeated failures and forgets them after the window', () => {
    const g = createLoginGuard(3, 1000)
    for (let i = 0; i < 3; i++) g.fail(NOW)
    expect(g.blocked(NOW + 10)).toBe(true)
    expect(g.blocked(NOW + 1001)).toBe(false)
  })
})

/** Drive the handler with a plain object standing in for the response. */
async function call(handler: ReturnType<typeof createAuthHandler>, method: string, body?: unknown, headers: Record<string, string> = {}) {
  const out = { status: 0, headers: {} as Record<string, string>, json: undefined as unknown }
  const res = {
    statusCode: 0,
    setHeader(k: string, v: string) { out.headers[k.toLowerCase()] = v },
    end(text: string) { out.status = (res as unknown as { statusCode: number }).statusCode; out.json = JSON.parse(text) },
  } as unknown as ServerResponse
  await handler(req({ host: 'app.test', ...headers }, { method, body } as Partial<IncomingMessage>), res)
  return out
}

describe('auth endpoint', () => {
  it('signs in with the right password, setting an HttpOnly, SameSite=Strict cookie that then authorizes', async () => {
    const h = createAuthHandler({ ...env, VERCEL: '1' }, 0)
    const r = await call(h, 'POST', { password: 'correct horse' })
    expect(r.status).toBe(200)
    const set = r.headers['set-cookie']
    expect(set).toMatch(/HttpOnly/)
    expect(set).toMatch(/SameSite=Strict/)
    expect(set).toMatch(/Secure/)
    const cookie = set.split(';')[0]
    expect(isAuthorized(req({ cookie }), env)).toBe(true)
    expect((await call(h, 'GET', undefined, { cookie })).json).toEqual({ configured: true, signedIn: true })
  })
  it('refuses a wrong password and a cross-origin sign-in, and reports when no password is configured', async () => {
    const h = createAuthHandler(env, 0)
    const wrong = await call(h, 'POST', { password: 'nope' })
    expect(wrong.status).toBe(401)
    expect(wrong.headers['set-cookie']).toBeUndefined()
    expect((await call(h, 'POST', { password: 'correct horse' }, { origin: 'https://evil.test' })).status).toBe(403)
    expect((await call(createAuthHandler({}, 0), 'POST', { password: 'x' })).status).toBe(503)
    expect((await call(createAuthHandler({}, 0), 'GET')).json).toEqual({ configured: false, signedIn: false })
  })
  it('locks out after repeated wrong passwords, even for the right one', async () => {
    const h = createAuthHandler(env, 0)
    for (let i = 0; i < 8; i++) await call(h, 'POST', { password: 'nope' })
    expect((await call(h, 'POST', { password: 'correct horse' })).status).toBe(429)
  })
  it('signs out by expiring the cookie', async () => {
    const r = await call(createAuthHandler(env, 0), 'DELETE')
    expect(r.headers['set-cookie']).toMatch(/Max-Age=0/)
  })
})
