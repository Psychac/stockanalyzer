import { describe, expect, it, vi } from 'vitest'
import { istDate, sessionOpen } from '../../domain/time'
import type { Instrument } from '../../domain/types'
import { BENCHMARK, DEMO_UNIVERSE } from '../universe'
import { ProviderError } from '../errors'
import { RateLimiter } from '../rateLimiter'
import { BreezeClient, type BreezeRow } from './client'
import { parseBreezeCandles } from './candles'
import { BREEZE_BENCHMARK, BREEZE_CODES } from './codes'
import { BreezeProvider, codeFor } from './provider'
import { HELPER_MISSING, apiSessionFromSearch, decodeSessionToken, exchangeSession, helperAvailable, loginUrl, type BreezeSession } from './session'
import { BreezeStream, parseTick, streamToken, tokenFor } from './stream'

const ist = (s: string) => Date.parse(`${s}:00+05:30`)
const b64 = btoa('AF296713:66987976') // the official docs' example token
const session: BreezeSession = { appKey: 'KEY', sessionToken: b64, userId: 'AF296713', streamToken: '66987976', obtainedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const row = (datetime: string, c: number): BreezeRow => ({ datetime, open: String(c - 1), high: String(c + 1), low: String(c - 2), close: String(c), volume: '1000' })
const fastLimiter = () => new RateLimiter(1000, 100000)

describe('Breeze session', () => {
  it('decodes the base64 session token into user id and stream token', () => {
    expect(decodeSessionToken(b64)).toEqual({ userId: 'AF296713', token: '66987976' })
    expect(() => decodeSessionToken('not base64!!')).toThrow(ProviderError)
    expect(() => decodeSessionToken(btoa('nocolon'))).toThrow(ProviderError)
  })

  it('reads the one-time code Breeze returns on the redirect, whatever the casing', () => {
    expect(apiSessionFromSearch('?API_Session=abc123&x=1')).toBe('abc123')
    expect(apiSessionFromSearch('?api_session=zzz')).toBe('zzz')
    expect(apiSessionFromSearch('?apisession=abc')).toBe('abc') // the spelling a real redirect used
    expect(apiSessionFromSearch('?apisession=')).toBeNull()
    expect(apiSessionFromSearch('?breeze_session=fwd')).toBe('fwd') // forwarded by the server-side callback
    expect(apiSessionFromSearch('?auth_code=fyers')).toBeNull()
    expect(apiSessionFromSearch('')).toBeNull()
  })

  it('builds the login URL with the app key encoded', () => {
    expect(loginUrl('a+b/c=')).toBe('https://api.icicidirect.com/apiuser/login?api_key=a%2Bb%2Fc%3D')
  })

  it('exchanges the code through the helper and never touches a secret key', async () => {
    const fetchFn = vi.fn(async () => json({ Success: { session_token: b64 }, Status: 200, Error: null }))
    const now = ist('2026-10-27T10:00')
    const s = await exchangeSession('KEY', 'CODE', now, fetchFn)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/breeze/session')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Breeze-Helper']).toBe('1')
    expect(JSON.parse(init.body as string)).toEqual({ appKey: 'KEY', apiSession: 'CODE' })
    expect(s).toMatchObject({ appKey: 'KEY', sessionToken: b64, userId: 'AF296713', streamToken: '66987976', expiresAt: ist('2026-10-28T06:30') })
  })

  it("maps Breeze's documented login errors to actionable messages", async () => {
    const fail = (Error: string) => exchangeSession('K', 'C', 0, async () => json({ Success: null, Status: 5, Error }))
    await expect(fail('Public Key does not exist.')).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('app key') })
    await expect(fail('Invalid session.')).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('log in again') })
    await expect(fail('Resource not available.')).rejects.toMatchObject({ kind: 'auth', message: expect.stringContaining('expired') })
  })

  it('says so plainly when there is no helper (a static host answers with HTML)', async () => {
    const html = async () => new Response('<!doctype html><title>app</title>', { status: 200 })
    await expect(exchangeSession('K', 'C', 0, html)).rejects.toMatchObject({ message: HELPER_MISSING })
    expect(await helperAvailable(html)).toBe(false)
    expect(await helperAvailable(async () => json({ helper: 'breeze-relay' }))).toBe(true)
    expect(await helperAvailable(async () => { throw new TypeError('offline') })).toBe(false)
  })
})

describe('Breeze history', () => {
  it('sends header auth (no checksum, no secret) through the helper', async () => {
    const fetchFn = vi.fn(async () => json({ Success: [row('2026-10-23 07:00:00', 10)], Status: 200, Error: null }))
    const rows = await new BreezeClient(() => session, fastLimiter(), fetchFn).history({ stock_code: 'RELIND', exch_code: 'NSE' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/breeze/history?stock_code=RELIND&exch_code=NSE')
    expect(init.headers).toMatchObject({ 'X-SessionToken': b64, apikey: 'KEY', 'X-Breeze-Helper': '1' })
    expect(JSON.stringify(init.headers)).not.toMatch(/checksum|secret/i)
    expect(rows).toHaveLength(1)
  })

  it('classifies Breeze failures', async () => {
    const call = (body: unknown, status = 200) => new BreezeClient(() => session, fastLimiter(), async () => json(body, status)).history({})
    await expect(call({ Error: 'Invalid User Details', Status: 401 }, 401)).rejects.toMatchObject({ kind: 'auth' })
    await expect(call({ Error: 'Something went wrong', Status: 500 }, 200)).rejects.toMatchObject({ kind: 'api' })
    await expect(call({}, 429)).rejects.toMatchObject({ kind: 'rate' })
    await expect(new BreezeClient(() => session, fastLimiter(), async () => { throw new TypeError('x') }).history({})).rejects.toMatchObject({ kind: 'network' })
    await expect(new BreezeClient(() => session, fastLimiter(), async () => new Response('<html>')).history({})).rejects.toMatchObject({ message: HELPER_MISSING })
  })
})

describe('Breeze candle parsing', () => {
  const now = ist('2026-10-27T11:00')
  it('uses the date only, converts string prices, and flags the forming bar', () => {
    const out = parseBreezeCandles([row('2026-10-23 07:00:00', 100), row('2026-10-26T00:00:00', 101), row('2026-10-27 07:00:00', 102)], now)
    expect(out.map(c => [istDate(c.t), c.c, c.closed])).toEqual([['2026-10-23', 100, true], ['2026-10-26', 101, true], ['2026-10-27', 102, false]])
    expect(out[0].t).toBe(sessionOpen('2026-10-23'))
    expect(out[0]).toMatchObject({ o: 99, h: 101, l: 98, v: 1000 })
  })
  it('drops malformed rows and keeps the last of duplicate dates', () => {
    const out = parseBreezeCandles(
      [row('2026-10-23 07:00:00', 100), row('2026-10-23 09:00:00', 105), { ...row('2026-10-26 07:00:00', 1), high: '0' }, { ...row('2026-10-26 07:00:00', 1), open: 'NaN' }, { datetime: 'bad', open: '1', high: '1', low: '1', close: '1', volume: '1' }, null],
      now,
    )
    expect(out.map(c => c.c)).toEqual([105])
    expect(parseBreezeCandles(undefined, now)).toEqual([])
  })
})

describe('Breeze symbol map', () => {
  it('covers every tracked stock with a code and token', () => {
    for (const i of DEMO_UNIVERSE) expect(BREEZE_CODES[i.symbol], i.symbol).toBeDefined()
    expect(codeFor(DEMO_UNIVERSE.find(i => i.symbol === 'RELIANCE')!)).toBe('RELIND') // Breeze's own code, not the NSE symbol
    expect(codeFor(BENCHMARK)).toBe(BREEZE_BENCHMARK.code)
    expect(streamToken(tokenFor(DEMO_UNIVERSE.find(i => i.symbol === 'RELIANCE')!)!)).toBe('4.1!2885')
  })
})

describe('BreezeProvider', () => {
  const now = ist('2026-10-27T11:00')
  const fakeClient = (history: (p: Record<string, string>) => Promise<BreezeRow[]>) => {
    const spy = vi.fn(history)
    return { client: { history: spy } as unknown as BreezeClient, spy }
  }

  it('asks for one daily range per year and formats the request for Breeze', async () => {
    const { client, spy } = fakeClient(async () => [row('2026-10-23 07:00:00', 10)])
    await new BreezeProvider(client, session, () => now).getCandlesSince(DEMO_UNIVERSE[0], '1D', now - 500 * 86_400_000)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[0][0]).toMatchObject({ interval: '1day', stock_code: 'RELIND', exch_code: 'NSE', product_type: 'cash' })
    expect(spy.mock.calls[0][0].from_date).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/)
    expect(spy.mock.calls[0][0].to_date).toMatch(/T23:59:59\.000Z$/)
  })

  it('a 250-bar load is a single call', async () => {
    const { client, spy } = fakeClient(async () => [])
    await new BreezeProvider(client, session, () => now).getHistoricalCandles(DEMO_UNIVERSE[0], '1D', 250)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('treats an opaque Breeze failure at connect time as a session problem', async () => {
    const { client } = fakeClient(async () => { throw new ProviderError('Breeze: Something went wrong', 'api', 500) })
    await expect(new BreezeProvider(client, session, () => now).connect()).rejects.toMatchObject({ kind: 'auth' })
    const ok = fakeClient(async () => [])
    await expect(new BreezeProvider(ok.client, session, () => now).connect()).resolves.toBeUndefined()
  })

  it('does not mislabel a network outage as an expired session', async () => {
    const { client } = fakeClient(async () => { throw new ProviderError('offline', 'network') })
    await expect(new BreezeProvider(client, session, () => now).connect()).rejects.toMatchObject({ kind: 'network' })
  })

  it('rejects intraday and unmapped symbols instead of guessing', async () => {
    const { client } = fakeClient(async () => [])
    const p = new BreezeProvider(client, session, () => now)
    await expect(p.getCandlesSince(DEMO_UNIVERSE[0], '15m', now)).rejects.toBeInstanceOf(ProviderError)
    const stranger: Instrument = { id: 'NSE:ZZZ', exchange: 'NSE', symbol: 'ZZZ', name: 'z', sector: 'x', kind: 'equity' }
    await expect(p.getCandlesSince(stranger, '1D', now)).rejects.toMatchObject({ message: 'No Breeze code for ZZZ.' })
  })
})

describe('Breeze live ticks', () => {
  const reliance = DEMO_UNIVERSE.find(i => i.symbol === 'RELIANCE')!
  const byToken = new Map([[BREEZE_CODES.RELIANCE.token, reliance]])
  // [0]=token [1]=open [2]=last [3]=high [4]=low [5]=change ... [10]=ltq [12]=ttq [19]=ltt [20]=prev close
  const tick = (over: Record<number, unknown> = {}) => {
    const t: unknown[] = new Array(21).fill(0)
    Object.assign(t, { 0: '4.1!2885', 1: 1190, 2: 1205.5, 3: 1210, 4: 1188, 10: 50, 12: 987654, 19: ist('2026-10-27T10:59') / 1000, 20: 1190.25 }, over)
    return t
  }

  it('maps the documented 21-field NSE quote layout', () => {
    expect(parseTick(tick(), byToken, 0)).toEqual({
      instrumentId: reliance.id, ltp: 1205.5, prevClose: 1190.25, open: 1190, high: 1210, low: 1188, volume: 987654,
      at: ist('2026-10-27T10:59'), source: 'breeze',
    })
  })
  it('ignores ticks it cannot trust', () => {
    expect(parseTick(tick({ 0: '4.1!99999999' }), byToken, 0)).toBeNull() // untracked token
    expect(parseTick(tick({ 2: 0 }), byToken, 0)).toBeNull() // zero price
    expect(parseTick(tick().slice(0, 12), byToken, 0)).toBeNull() // short / other record type
    expect(parseTick('junk', byToken, 0)).toBeNull()
    expect(parseTick(tick({ 19: 0 }), byToken, 123)?.at).toBe(123) // bad ltt falls back to now
  })

  it('joins the NSE quote channels on connect, collects ticks, and reports refusals', () => {
    const handlers: Record<string, (...a: unknown[]) => void> = {}
    const emitted: [string, unknown][] = []
    const socket = {
      on: (e: string, h: (...a: unknown[]) => void) => { handlers[e] = h; return socket },
      emit: (e: string, p: unknown) => { emitted.push([e, p]) },
      removeAllListeners: vi.fn(), disconnect: vi.fn(),
    }
    const ioFactory = vi.fn(() => socket) as unknown as ConstructorParameters<typeof BreezeStream>[2]
    const stream = new BreezeStream(session, [reliance], ioFactory, () => 0)
    stream.start()
    expect(ioFactory).toHaveBeenCalledWith('https://livestream.icicidirect.com', expect.objectContaining({ transports: ['websocket'], auth: { user: 'AF296713', token: '66987976' } }))
    expect(stream.state).toBe('connecting')

    handlers.connect()
    expect(stream.state).toBe('connected')
    expect(emitted).toEqual([['join', ['4.1!2885']]])

    handlers.stock(tick()) // single tick
    handlers.stock([tick({ 2: 1300 }), tick({ 0: '4.1!1' })]) // batch: one tracked, one not
    expect(stream.ticksReceived).toBe(2)
    expect(stream.latest()).toHaveLength(1)
    expect(stream.latest()[0].ltp).toBe(1300)

    handlers.connect_error(new Error('forbidden'))
    expect(stream.state).toBe('error')
    expect(stream.message).toContain('forbidden')

    stream.stop()
    expect(socket.disconnect).toHaveBeenCalled()
    expect(stream.state).toBe('idle')
  })
})
