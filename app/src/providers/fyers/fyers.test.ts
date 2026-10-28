import { describe, expect, it, vi } from 'vitest'
import { isDailyBarClosed, isMarketOpen, istDate, lastSessionClose, nextTokenExpiry, sessionOpen } from '../../domain/time'
import type { Candle, CandleSet, Instrument } from '../../domain/types'
import { BENCHMARK, DEMO_UNIVERSE } from '../universe'
import type { MarketDataProvider, Quote } from '../types'
import { exchangeAuthCode, loginUrl, sha256Hex } from './auth'
import { applyQuote, finalizeCandles, mergeCandles, parseDailyCandles } from './candles'
import { FyersClient, FyersError, RateLimiter, toFyersError } from './client'
import { FyersProvider, toSymbol } from './provider'
import { loadMarket, type CandleCache } from '../loader'

/** IST wall-clock → epoch ms. 2026-10-26 is a Monday. */
const ist = (s: string) => Date.parse(`${s}:00+05:30`)
const epochS = (s: string) => ist(s) / 1000

const bar = (date: string, c: number, closed = true): Candle => ({ t: sessionOpen(date), o: c - 1, h: c + 1, l: c - 2, c, v: 1000, closed })

describe('session time', () => {
  it('knows when the cash session is open', () => {
    expect(isMarketOpen(ist('2026-10-26T10:00'))).toBe(true)
    expect(isMarketOpen(ist('2026-10-26T09:14'))).toBe(false)
    expect(isMarketOpen(ist('2026-10-26T15:30'))).toBe(false)
    expect(isMarketOpen(ist('2026-10-24T11:00'))).toBe(false) // Saturday
  })
  it('treats a daily bar as final only after the close settles', () => {
    expect(isDailyBarClosed('2026-10-26', ist('2026-10-26T15:34'))).toBe(false)
    expect(isDailyBarClosed('2026-10-26', ist('2026-10-26T15:35'))).toBe(true)
    expect(isDailyBarClosed('2026-10-26', ist('2026-10-27T09:00'))).toBe(true)
  })
  it('finds the latest finalised session, skipping weekends', () => {
    expect(lastSessionClose(ist('2026-10-26T10:00'))).toBe(ist('2026-10-23T15:35')) // Mon morning → Fri
    expect(lastSessionClose(ist('2026-10-24T12:00'))).toBe(ist('2026-10-23T15:35')) // Saturday → Fri
    expect(lastSessionClose(ist('2026-10-26T16:00'))).toBe(ist('2026-10-26T15:35'))
  })
  it('expires FYERS tokens at the next 06:30 IST', () => {
    expect(nextTokenExpiry(ist('2026-10-26T05:00'))).toBe(ist('2026-10-26T06:30'))
    expect(nextTokenExpiry(ist('2026-10-26T07:00'))).toBe(ist('2026-10-27T06:30'))
    expect(istDate(sessionOpen('2026-10-26'))).toBe('2026-10-26')
  })
})

describe('candle parsing', () => {
  const now = ist('2026-10-27T11:00')
  it('re-stamps bars by IST date whatever time-of-day FYERS reports', () => {
    const rows = [
      [epochS('2026-10-23T00:00'), 10, 12, 9, 11, 500],
      [Date.parse('2026-10-26T00:00:00Z') / 1000, 11, 13, 10, 12, 600], // midnight UTC variant
    ]
    const out = parseDailyCandles(rows, now)
    expect(out.map(c => istDate(c.t))).toEqual(['2026-10-23', '2026-10-26'])
    expect(out.every(c => c.t === sessionOpen(istDate(c.t)))).toBe(true)
  })
  it('drops malformed rows, dedupes dates, and flags the forming bar', () => {
    const out = parseDailyCandles(
      [
        [epochS('2026-10-26T00:00'), 10, 12, 9, 11, 500],
        [epochS('2026-10-26T00:00'), 10, 12, 9, 13, 700], // duplicate date: later row wins
        [epochS('2026-10-27T00:00'), 13, 14, 12, 13.5, 100], // today, market open → forming
        [epochS('2026-10-25T00:00'), 10, 8, 9, 9, 1], // high < low
        [epochS('2026-10-22T00:00'), 0, 5, 4, 4, 1], // zero price
        [epochS('2026-10-21T00:00'), 'x', 5, 4, 4, 1],
        'junk',
      ],
      now,
    )
    expect(out.map(c => [istDate(c.t), c.c, c.closed])).toEqual([['2026-10-26', 13, true], ['2026-10-27', 13.5, false]])
    expect(parseDailyCandles(undefined, now)).toEqual([])
  })
  it('merges with fresh data winning, and recomputes closed from the clock', () => {
    const merged = mergeCandles([bar('2026-10-23', 10), bar('2026-10-26', 11, false)], [bar('2026-10-26', 12), bar('2026-10-27', 13, false)])
    expect(merged.map(c => c.c)).toEqual([10, 12, 13])
    const fin = finalizeCandles([bar('2026-10-27', 13, true)], ist('2026-10-27T11:00'))
    expect(fin[0].closed).toBe(false)
  })
})

describe('applyQuote', () => {
  const now = ist('2026-10-27T11:00')
  const q = (over: Partial<Quote>): Quote => ({ instrumentId: 'NSE:X', ltp: 105, prevClose: 100, at: ist('2026-10-27T10:59'), source: 'fyers', ...over })
  it("updates today's forming bar in place", () => {
    const base = [bar('2026-10-26', 100), { ...bar('2026-10-27', 101, false), o: 100, h: 102, l: 99 }]
    const out = applyQuote(base, q({ high: 106, low: 98, volume: 5000 }), now)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ o: 100, h: 106, l: 98, c: 105, v: 5000, closed: false })
  })
  it('opens a new forming bar when the history has none for today', () => {
    const out = applyQuote([bar('2026-10-26', 100)], q({ open: 101, high: 106, low: 100.5, volume: 900 }), now)
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ o: 101, h: 106, l: 100.5, c: 105, closed: false })
  })
  it('ignores a quote older than the latest bar', () => {
    const base = [bar('2026-10-26', 100)]
    expect(applyQuote(base, q({ at: ist('2026-10-23T15:00') }), now)).toBe(base)
  })
})

describe('FYERS client', () => {
  it('maps documented auth codes, rate limits and generic failures', () => {
    for (const code of [-8, -15, -16, -17]) expect(toFyersError({ s: 'error', code }, 200).kind).toBe('auth')
    expect(toFyersError({ code: -429 }, 200).kind).toBe('rate')
    expect(toFyersError(null, 429).kind).toBe('rate')
    expect(toFyersError(null, 401).kind).toBe('auth')
    expect(toFyersError({ code: -300, message: 'bad symbol' }, 400)).toMatchObject({ kind: 'api', message: 'bad symbol' })
  })

  it('sends Authorization as app_id:token with encoded query params and surfaces errors', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ s: 'ok', candles: [] }), { status: 200 }))
    const client = new FyersClient(() => ({ appId: 'APP-100', accessToken: 'tok' }), new RateLimiter(100, 1000), fetchFn)
    await client.get('/data/quotes', { symbols: 'NSE:M&M-EQ,NSE:TCS-EQ' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api-t1.fyers.in/data/quotes?symbols=NSE%3AM%26M-EQ%2CNSE%3ATCS-EQ')
    expect((init.headers as Record<string, string>).Authorization).toBe('APP-100:tok')

    const bad = new FyersClient(() => ({ appId: 'a', accessToken: 'b' }), new RateLimiter(100, 1000), async () => new Response(JSON.stringify({ s: 'error', code: -16, message: 'x' }), { status: 401 }))
    await expect(bad.get('/data/history', {})).rejects.toMatchObject({ kind: 'auth', code: -16 })
    const down = new FyersClient(() => ({ appId: 'a', accessToken: 'b' }), new RateLimiter(100, 1000), async () => { throw new TypeError('Failed to fetch') })
    await expect(down.get('/x', {})).rejects.toMatchObject({ kind: 'network' })
  })

  it('rate limiter spaces calls to respect per-second and per-minute caps', async () => {
    let clock = 0
    const waits: number[] = []
    const limiter = new RateLimiter(2, 3, () => clock, async ms => { waits.push(ms); clock += ms })
    for (let i = 0; i < 4; i++) await limiter.take()
    // 3rd call waits out the 1s window; 4th waits for the 60s minute window to roll.
    expect(waits.length).toBeGreaterThanOrEqual(2)
    expect(clock).toBeGreaterThanOrEqual(60_000)
    expect(clock).toBeLessThan(61_000)
  })
})

describe('FYERS auth', () => {
  it('hashes with SHA-256 (known vector)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('builds the login URL from the documented parameters', () => {
    const u = new URL(loginUrl('APP-100', 'http://localhost:5173/', 'st4te'))
    expect(u.origin + u.pathname).toBe('https://api-t1.fyers.in/api/v3/generate-authcode')
    expect(Object.fromEntries(u.searchParams)).toEqual({ client_id: 'APP-100', redirect_uri: 'http://localhost:5173/', response_type: 'code', state: 'st4te' })
  })
  it('exchanges the auth code with appIdHash = sha256(app_id:secret) and never needs the secret afterwards', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ s: 'ok', code: 200, access_token: 'AT', refresh_token: 'RT' })))
    const now = ist('2026-10-26T10:00')
    const session = await exchangeAuthCode('APP-100', 's3cret', 'AUTH', now, fetchFn)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api-t1.fyers.in/api/v3/validate-authcode')
    expect(JSON.parse(init.body as string)).toEqual({ grant_type: 'authorization_code', appIdHash: await sha256Hex('APP-100:s3cret'), code: 'AUTH' })
    expect(session).toEqual({ appId: 'APP-100', accessToken: 'AT', obtainedAt: now, expiresAt: ist('2026-10-27T06:30') })
    expect(JSON.stringify(session)).not.toContain('s3cret')
    expect(JSON.stringify(session)).not.toContain('RT') // refresh token is deliberately dropped
  })
  it('reports a rejected code with FYERS own message', async () => {
    await expect(exchangeAuthCode('a', 'b', 'bad', Date.now(), async () => new Response(JSON.stringify({ s: 'error', code: -437, message: 'invalid auth code' }), { status: 400 })))
      .rejects.toMatchObject({ kind: 'auth', message: 'FYERS login failed: invalid auth code' })
  })
})

describe('FyersProvider', () => {
  const now = ist('2026-10-27T11:00')
  const fakeClient = (handler: (path: string, params: Record<string, string>) => unknown) => {
    const get = vi.fn(async (path: string, params: Record<string, string>) => handler(path, params))
    return { client: { get } as unknown as FyersClient, get }
  }

  it('maps instruments to FYERS symbols', () => {
    expect(toSymbol(DEMO_UNIVERSE.find(i => i.symbol === 'M&M')!)).toBe('NSE:M&M-EQ')
    expect(toSymbol(BENCHMARK)).toBe('NSE:NIFTY50-INDEX')
  })

  it('splits a long history gap into windows the endpoint accepts', async () => {
    const { client, get } = fakeClient(() => ({ s: 'ok', candles: [[epochS('2026-10-23T00:00'), 10, 12, 9, 11, 5]] }))
    const p = new FyersProvider(client, () => now)
    await p.getCandlesSince(DEMO_UNIVERSE[0], '1D', now - 500 * 86_400_000)
    expect(get).toHaveBeenCalledTimes(2)
    for (const [, params] of get.mock.calls as unknown as [string, Record<string, string>][]) {
      const span = (Date.parse(params.range_to) - Date.parse(params.range_from)) / 86_400_000
      expect(span).toBeLessThanOrEqual(366)
      expect(params).toMatchObject({ resolution: 'D', date_format: '1', symbol: 'NSE:RELIANCE-EQ' })
    }
  })

  it('a year of bars needs exactly one history call', async () => {
    const { client, get } = fakeClient(() => ({ s: 'ok', candles: [] }))
    await new FyersProvider(client, () => now).getHistoricalCandles(DEMO_UNIVERSE[0], '1D', 250)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('rejects non-daily intervals instead of returning wrong data', async () => {
    const { client } = fakeClient(() => ({}))
    await expect(new FyersProvider(client, () => now).getCandlesSince(DEMO_UNIVERSE[0], '15m', now)).rejects.toBeInstanceOf(FyersError)
  })

  it('batches quotes by 50 and skips symbols FYERS flagged as errors', async () => {
    const { client, get } = fakeClient((_p, params) => ({
      s: 'ok',
      d: params.symbols.split(',').map((n, i) => (i === 1
        ? { n, s: 'error', v: {} }
        : { n, s: 'ok', v: { lp: 100 + i, prev_close_price: 99, open_price: 98, high_price: 102, low_price: 97, volume: 12345, tt: String(epochS('2026-10-27T10:59')) } })),
    }))
    const quotes = await new FyersProvider(client, () => now).getQuotes([...DEMO_UNIVERSE, BENCHMARK])
    expect(get).toHaveBeenCalledTimes(2) // 51 symbols → 50 + 1
    expect(quotes.find(q => q.instrumentId === DEMO_UNIVERSE[1].id)).toBeUndefined()
    expect(quotes[0]).toMatchObject({ instrumentId: DEMO_UNIVERSE[0].id, ltp: 100, prevClose: 99, open: 98, high: 102, low: 97, volume: 12345, at: ist('2026-10-27T10:59') })
  })
})

describe('cache-first loader', () => {
  const now = ist('2026-10-27T11:00') // Tuesday; latest finalised session is Monday 15:35
  const insts: Instrument[] = DEMO_UNIVERSE.slice(0, 3)
  const dates = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26']
  const history = (): Candle[] => dates.map((d, i) => bar(d, 100 + i))

  const memCache = (seed: Record<string, { candles: Candle[]; fetchedAt: number }> = {}) => {
    const m = new Map(Object.entries(seed))
    const cache: CandleCache = { get: async id => m.get(id), put: async (id, candles, fetchedAt) => { m.set(id, { candles, fetchedAt }) } }
    return { cache, m }
  }
  const fakeProvider = (over: Partial<MarketDataProvider> = {}) => {
    const getHistoricalCandles = vi.fn(async (instrument: Instrument): Promise<CandleSet> => ({ instrument, timeframe: '1D', candles: history(), source: 'fyers', asOf: 0 }))
    const getCandlesSince = vi.fn(async () => [bar('2026-10-26', 150), bar('2026-10-27', 151, false)])
    return { provider: { getHistoricalCandles, getCandlesSince, ...over } as unknown as MarketDataProvider, getHistoricalCandles, getCandlesSince }
  }
  const base = { source: 'fyers' as const, instruments: insts, benchmark: BENCHMARK, bars: 250, now }

  it('fetches everything on first run and caches it', async () => {
    const { cache, m } = memCache()
    const { provider, getHistoricalCandles } = fakeProvider()
    const r = await loadMarket({ ...base, provider, cache })
    expect(getHistoricalCandles).toHaveBeenCalledTimes(4) // 3 stocks + benchmark
    expect(r.sets.size).toBe(3)
    expect(r.benchmark).not.toBeNull()
    expect(r.stale).toBe(false)
    expect(m.size).toBe(4)
  })

  it('makes zero API calls when the cache is newer than the last session close', async () => {
    const seed = Object.fromEntries([...insts, BENCHMARK].map(i => [i.id, { candles: history(), fetchedAt: ist('2026-10-26T16:00') }]))
    const { provider, getHistoricalCandles, getCandlesSince } = fakeProvider()
    const r = await loadMarket({ ...base, provider, cache: memCache(seed).cache })
    expect(getHistoricalCandles).not.toHaveBeenCalled()
    expect(getCandlesSince).not.toHaveBeenCalled()
    expect(r.sets.size).toBe(3)
    expect(r.stale).toBe(false)
  })

  it('extends an out-of-date cache with only the missing days, and marks today forming', async () => {
    const seed = Object.fromEntries([...insts, BENCHMARK].map(i => [i.id, { candles: history(), fetchedAt: ist('2026-10-26T10:00') }]))
    const { provider, getHistoricalCandles, getCandlesSince } = fakeProvider()
    const r = await loadMarket({ ...base, provider, cache: memCache(seed).cache })
    expect(getHistoricalCandles).not.toHaveBeenCalled()
    expect(getCandlesSince).toHaveBeenCalledTimes(4)
    const candles = r.sets.get(insts[0].id)!.candles
    expect(candles.map(c => c.c)).toEqual([100, 101, 102, 150, 151])
    expect(candles[candles.length - 1].closed).toBe(false)
  })

  it('stops calling after the token is rejected and serves the cache, flagged stale', async () => {
    const seed = Object.fromEntries([...insts, BENCHMARK].map(i => [i.id, { candles: history(), fetchedAt: ist('2026-10-26T10:00') }]))
    const getCandlesSince = vi.fn(async () => { throw new FyersError('Session expired', 'auth', -16) })
    const { provider } = fakeProvider({ getCandlesSince })
    const r = await loadMarket({ ...base, provider, cache: memCache(seed).cache })
    expect(getCandlesSince).toHaveBeenCalledTimes(1)
    expect(r.authExpired).toBe(true)
    expect(r.stale).toBe(true)
    expect(r.sets.size).toBe(3) // cached data still shown
  })

  it('a single failing symbol does not block the rest', async () => {
    let n = 0
    const getHistoricalCandles = vi.fn(async (instrument: Instrument): Promise<CandleSet> => {
      if (n++ === 1) throw new FyersError('no such symbol', 'api', -300)
      return { instrument, timeframe: '1D', candles: history(), source: 'fyers', asOf: 0 }
    })
    const { provider } = fakeProvider({ getHistoricalCandles })
    const r = await loadMarket({ ...base, provider, cache: memCache().cache })
    expect(r.sets.size).toBe(2)
    expect(r.stale).toBe(true)
    expect(r.warnings.join(' ')).toContain('1 of 3 stocks have no data')
  })

  it('offline mode (no provider) serves the cache without any network', async () => {
    const seed = Object.fromEntries([...insts, BENCHMARK].map(i => [i.id, { candles: history(), fetchedAt: ist('2026-10-20T16:00') }]))
    const r = await loadMarket({ ...base, provider: null, cache: memCache(seed).cache })
    expect(r.sets.size).toBe(3)
    expect(r.stale).toBe(true)
    expect(r.authExpired).toBe(false)
  })

  it('returns nothing, not fake data, when there is no cache and no connection', async () => {
    const r = await loadMarket({ ...base, provider: null, cache: memCache().cache })
    expect(r.sets.size).toBe(0)
    expect(r.benchmark).toBeNull()
  })
})
