import http from 'node:http'
import type https from 'node:https'
import { PassThrough } from 'node:stream'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createRelay, type RelayOptions } from './breezeRelay'

/** A stand-in for ICICI: records what the relay sent and replies with a canned response. */
function fakeUpstream(reply: { status?: number; body?: string; headers?: Record<string, string>; fail?: boolean } = {}) {
  const calls: { options: https.RequestOptions; body: string }[] = []
  const request = ((options: https.RequestOptions, cb: (res: unknown) => void) => {
    let body = ''
    const handlers: Record<string, (...a: unknown[]) => void> = {}
    const req = {
      write: (c: string) => { body += c },
      on: (e: string, h: (...a: unknown[]) => void) => { handlers[e] = h; return req },
      destroy: () => {},
      end: () => {
        calls.push({ options, body })
        if (reply.fail) return handlers.error?.(new Error('ECONNRESET'))
        const up = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> }
        up.statusCode = reply.status ?? 200
        up.headers = reply.headers ?? {}
        cb(up)
        up.end(reply.body ?? '{"Success":null,"Status":5,"Error":"Public Key does not exist."}')
      },
    }
    return req
  }) as unknown as typeof https.request
  return { request, calls }
}

const servers: http.Server[] = []
afterEach(() => { for (const s of servers.splice(0)) s.close() })

/** Real HTTP server wired the way the Vite plugin and Vercel wire it. */
async function start(opts: RelayOptions = {}, upstream = fakeUpstream()) {
  const relay = createRelay({ ...opts, request: upstream.request })
  const server = http.createServer((req, res) => {
    const path = new URL(req.url ?? '', 'http://x').pathname
    if (path === '/api/breeze/ping') return void relay.ping(req, res)
    if (path === '/api/breeze/session') return void relay.session(req, res)
    if (path === '/api/breeze/history') return void relay.history(req, res)
    if (path === '/api/breeze/callback') return void relay.callback(req, res)
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  const port = (server.address() as AddressInfo).port
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: string) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any; text: string }>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method, path, headers: { 'x-breeze-helper': '1', ...headers } }, res => {
        let text = ''
        res.on('data', c => { text += c })
        res.on('end', () => { let json: unknown = null; try { json = JSON.parse(text) } catch { /* not JSON */ } resolve({ status: res.statusCode ?? 0, headers: res.headers, json, text }) })
      })
      req.on('error', reject)
      if (body !== undefined) req.write(body)
      req.end()
    })
  return { call, upstream, port }
}

const goodSession = JSON.stringify({ appKey: 'KEY123', apiSession: 'CODE456' })
const goodHistory = '/api/breeze/history?interval=1day&stock_code=RELIND&exch_code=NSE&product_type=cash&from_date=2026-10-01T00:00:00.000Z&to_date=2026-10-20T23:59:59.000Z'
const sessionHeaders = { 'x-sessiontoken': 'QUYyOTY3MTM6NjY5ODc5NzY=', apikey: 'KEY123' }

describe('relay: who may call it', () => {
  it('answers a same-origin ping and says whether a code is needed', async () => {
    const { call } = await start()
    const r = await call('GET', '/api/breeze/ping')
    expect(r.status).toBe(200)
    expect(r.json).toEqual({ helper: 'breeze-relay', needsCode: false })
    expect(r.headers['cache-control']).toBe('no-store')
  })

  it('refuses calls without the relay header, from other origins, or from other sites', async () => {
    const { call, upstream } = await start()
    const noHeader = await call('GET', '/api/breeze/ping', { 'x-breeze-helper': '' })
    expect(noHeader.status).toBe(403)
    expect(noHeader.json.relayError).toBe('origin')
    expect((await call('POST', '/api/breeze/session', { origin: 'https://evil.example' }, goodSession)).status).toBe(403)
    expect((await call('POST', '/api/breeze/session', { origin: 'null' }, goodSession)).status).toBe(403)
    expect((await call('GET', '/api/breeze/ping', { 'sec-fetch-site': 'cross-site' })).status).toBe(403)
    expect(upstream.calls).toHaveLength(0)
  })

  it('accepts its own origin and same-origin fetches', async () => {
    const { call, port } = await start()
    expect((await call('GET', '/api/breeze/ping', { origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  })

  it('on a dev server, also refuses non-loopback Host headers (DNS rebinding)', async () => {
    const { call } = await start({ loopbackOnly: true })
    expect((await call('GET', '/api/breeze/ping')).status).toBe(200)
    const rebound = await call('GET', '/api/breeze/ping', { host: 'attacker.example' })
    expect(rebound.status).toBe(403)
    expect(rebound.json.relayError).toBe('origin')
  })

  it('rejects the wrong HTTP method', async () => {
    const { call } = await start()
    expect((await call('POST', '/api/breeze/ping')).status).toBe(405)
    expect((await call('GET', '/api/breeze/session')).status).toBe(405)
    expect((await call('POST', '/api/breeze/history')).status).toBe(405)
  })
})

describe('relay: optional access code', () => {
  it('lets ping through without the code but blocks everything that reaches ICICI', async () => {
    const { call, upstream } = await start({ accessCode: 'letmein' })
    expect((await call('GET', '/api/breeze/ping')).json).toEqual({ helper: 'breeze-relay', needsCode: true })
    const none = await call('POST', '/api/breeze/session', {}, goodSession)
    expect(none.status).toBe(403)
    expect(none.json.relayError).toBe('code')
    expect((await call('POST', '/api/breeze/session', { 'x-relay-code': 'wrong' }, goodSession)).json.relayError).toBe('code')
    expect((await call('GET', goodHistory, { ...sessionHeaders, 'x-relay-code': 'letmein1' })).json.relayError).toBe('code')
    expect(upstream.calls).toHaveLength(0)
    expect((await call('POST', '/api/breeze/session', { 'x-relay-code': 'letmein' }, goodSession)).status).toBe(200)
    expect(upstream.calls).toHaveLength(1)
  })
})

describe('relay: session exchange', () => {
  it('sends ICICI the GET-with-body it requires, in compact JSON, to the fixed endpoint', async () => {
    const { call, upstream } = await start()
    const r = await call('POST', '/api/breeze/session', {}, goodSession)
    expect(r.status).toBe(200)
    expect(r.json.Error).toBe('Public Key does not exist.') // ICICI's own answer passes straight through
    const [c] = upstream.calls
    expect(c.options).toMatchObject({ hostname: 'api.icicidirect.com', path: '/breezeapi/api/v1/customerdetails', method: 'GET' })
    expect(c.body).toBe('{"SessionToken":"CODE456","AppKey":"KEY123"}')
    expect((c.options.headers as Record<string, unknown>)['Content-Length']).toBe(Buffer.byteLength(c.body))
  })

  it('never forwards the caller\'s own headers or cookies to ICICI', async () => {
    const { call, upstream } = await start()
    await call('POST', '/api/breeze/session', { cookie: 'a=1', authorization: 'Bearer x', 'x-forwarded-for': '1.2.3.4' }, goodSession)
    expect(Object.keys(upstream.calls[0].options.headers as object).sort()).toEqual(['Content-Length', 'Content-Type'])
  })

  it('drops ICICI cookies and forces a JSON content type', async () => {
    const { call } = await start({}, fakeUpstream({ headers: { 'set-cookie': 'sid=secret', 'content-type': 'text/html' }, body: '{"ok":1}' }))
    const r = await call('POST', '/api/breeze/session', {}, goodSession)
    expect(r.headers['set-cookie']).toBeUndefined()
    expect(r.headers['content-type']).toContain('application/json')
    expect(r.headers['x-content-type-options']).toBe('nosniff')
  })

  it('validates input before contacting ICICI', async () => {
    const { call, upstream } = await start()
    for (const body of [
      'not json', '{}', JSON.stringify({ appKey: 'k' }), JSON.stringify({ appKey: 'k', apiSession: 42 }),
      JSON.stringify({ appKey: 'k"x', apiSession: 'c' }), JSON.stringify({ appKey: 'k', apiSession: 'c\nSecond: header' }),
      JSON.stringify({ appKey: 'a'.repeat(600), apiSession: 'c' }), 'x'.repeat(10_000),
    ]) {
      const r = await call('POST', '/api/breeze/session', {}, body).catch(() => ({ status: 0, json: null }))
      expect([400, 0]).toContain(r.status) // 0 = connection cut off for an oversized body
    }
    expect(upstream.calls).toHaveLength(0)
  })

  it('accepts a body the platform already parsed (Vercel passes req.body)', async () => {
    const upstream = fakeUpstream()
    const relay = createRelay({ request: upstream.request })
    const out: { status?: number; body?: string } = {}
    const res = { setHeader() {}, end(b: string) { out.body = b }, set statusCode(v: number) { out.status = v }, get statusCode() { return out.status ?? 200 } }
    for (const pre of [{ appKey: 'KEY123', apiSession: 'CODE456' }, goodSession]) {
      await relay.session({ method: 'POST', headers: { 'x-breeze-helper': '1', host: 'app.example' }, body: pre } as never, res as never)
    }
    expect(upstream.calls.map(c => c.body)).toEqual(Array(2).fill('{"SessionToken":"CODE456","AppKey":"KEY123"}'))
  })
})

describe('relay: history', () => {
  it('forwards only whitelisted params and the two session headers, to the fixed data endpoint', async () => {
    const { call, upstream } = await start({}, fakeUpstream({ body: '{"Success":[],"Status":200,"Error":null}' }))
    const r = await call('GET', goodHistory, sessionHeaders)
    expect(r.status).toBe(200)
    const [c] = upstream.calls
    expect(c.options).toMatchObject({ hostname: 'breezeapi.icicidirect.com', method: 'GET' })
    const url = new URL(`https://x${c.options.path}`)
    expect(url.pathname).toBe('/api/v2/historicalcharts')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ interval: '1day', stock_code: 'RELIND', exch_code: 'NSE', product_type: 'cash' })
    expect(c.options.headers).toEqual({ 'Content-Type': 'application/json', 'X-SessionToken': 'QUYyOTY3MTM6NjY5ODc5NzY=', apikey: 'KEY123' })
  })

  it('rejects unknown params, hostile values, and missing pieces without contacting ICICI', async () => {
    const { call, upstream } = await start()
    const bad = [
      ['/api/breeze/history?stock_code=X&evil=1', sessionHeaders],
      ['/api/breeze/history?stock_code=X%0D%0AHost:evil', sessionHeaders],
      ['/api/breeze/history?stock_code=' + 'A'.repeat(100), sessionHeaders],
      ['/api/breeze/history?interval=1day', sessionHeaders], // no stock_code
      [goodHistory, { apikey: 'KEY123' }], // no session token
      [goodHistory, { 'x-sessiontoken': 'bad token with spaces', apikey: 'K' }],
    ] as const
    for (const [path, headers] of bad) expect((await call('GET', path, headers)).status, path).toBe(400)
    expect(upstream.calls).toHaveLength(0)
  })

  it('passes ICICI errors through with their status, so the app can tell auth failures apart', async () => {
    const { call } = await start({}, fakeUpstream({ status: 401, body: '{"Error":"Invalid User Details","Status":401}' }))
    const r = await call('GET', goodHistory, sessionHeaders)
    expect(r.status).toBe(401)
    expect(r.json).toEqual({ Error: 'Invalid User Details', Status: 401 })
  })
})

describe('relay: upstream trouble', () => {
  it('turns an ICICI connection failure into a clean 502 without echoing credentials', async () => {
    const { call } = await start({}, fakeUpstream({ fail: true }))
    const r = await call('POST', '/api/breeze/session', {}, goodSession)
    expect(r.status).toBe(502)
    expect(r.json.Error).toContain('Could not reach ICICI')
    expect(r.text).not.toContain('CODE456')
    expect(r.text).not.toContain('KEY123')
  })
})

describe('relay: login return (ICICI POSTs the browser back)', () => {
  it("turns ICICI's POST with the code in the query into a 303 to the app root", async () => {
    const { call, upstream } = await start()
    const r = await call('POST', '/api/breeze/callback?apisession=ABC123%2Bxyz%3D', { 'x-breeze-helper': '' })
    expect(r.status).toBe(303)
    expect(r.headers.location).toBe('/?breeze_session=ABC123%2Bxyz%3D')
    expect(r.headers['cache-control']).toBe('no-store')
    expect(r.headers['referrer-policy']).toBe('no-referrer')
    expect(upstream.calls).toHaveLength(0) // never contacts ICICI
  })

  it('also takes the code from a form body, and from either spelling', async () => {
    const { call } = await start()
    const form = await call('POST', '/api/breeze/callback', { 'content-type': 'application/x-www-form-urlencoded' }, 'API_Session=FROMBODY')
    expect(form.headers.location).toBe('/?breeze_session=FROMBODY')
    expect((await call('GET', '/api/breeze/callback?API_Session=UPPER')).headers.location).toBe('/?breeze_session=UPPER')
  })

  it('only ever redirects to its own root, and drops anything malformed', async () => {
    const { call } = await start()
    for (const q of ['', '?apisession=', '?apisession=bad%20value', '?apisession=a%0D%0ALocation:%20https://evil', '?redirect=https://evil.example&x=1']) {
      const r = await call('POST', `/api/breeze/callback${q}`)
      expect(r.status).toBe(303)
      expect(r.headers.location, q).toBe('/')
    }
  })
})
