import { describe, expect, it, vi } from 'vitest'
import { sessionOpen } from './domain/time'
import type { Candle } from './domain/types'
import { INDEX_ORDER, indexLevel, isGauge, sortLevels } from './indices'
import { UNIVERSE } from './providers/universe'
import { BREEZE_CODES, BREEZE_INDICES, lookupCode, registerExtra } from './providers/breeze/codes'
import { adoptRow, loadMaster, rankMatches } from './providers/breeze/master'
import { BreezeStream, parseIndexTick, tokenFor } from './providers/breeze/stream'
import type { BreezeSession } from './providers/breeze/session'

const ist = (s: string) => Date.parse(`${s}:00+05:30`)
const bar = (date: string, c: number): Candle => ({ t: sessionOpen(date), o: c, h: c, l: c, c, v: 0, closed: true })

describe('stock search ranking', () => {
  const rows = [
    { symbol: 'RELIANCE', name: 'Reliance Industries' }, { symbol: 'RELAXO', name: 'Relaxo Footwears' },
    { symbol: 'TCS', name: 'Tata Consultancy Services' }, { symbol: 'TATASTEEL', name: 'Tata Steel' }, { symbol: 'TATAMOTORS', name: 'Tata Motors' },
    { symbol: 'ITC', name: 'ITC Limited' }, { symbol: 'AXISBANK', name: 'Axis Bank' },
  ]
  const rank = (q: string, n = 8) => rankMatches(rows, q, r => r.symbol, r => r.name, n).map(r => r.symbol)

  it('puts an exact symbol first, then prefixes, shorter symbols before longer', () => {
    expect(rank('tcs')[0]).toBe('TCS')
    expect(rank('rel')).toEqual(['RELAXO', 'RELIANCE'])
    expect(rank('tata')).toEqual(['TATASTEEL', 'TATAMOTORS', 'TCS'])
  })
  it('matches on a word of the company name', () => {
    expect(rank('steel')).toContain('TATASTEEL')
    expect(rank('consultancy')).toEqual(['TCS'])
  })
  it('does not flood a one-letter query, and ignores blanks and punctuation', () => {
    expect(rank('a')).toEqual(['AXISBANK'])
    expect(rank('')).toEqual([])
    expect(rank('  ')).toEqual([])
    expect(rank('tata-steel!')).toContain('TATASTEEL')
  })
  it('honours the limit', () => { expect(rank('t', 2)).toHaveLength(2) })
})

describe('Breeze instrument master', () => {
  it('lists the whole NSE equity market and agrees with the tracked-stock map', async () => {
    const master = await loadMaster()
    expect(master.length).toBeGreaterThan(2000)
    const bySymbol = new Map(master.map(r => [r.symbol, r]))
    for (const i of UNIVERSE) {
      const row = bySymbol.get(i.symbol)
      expect(row, i.symbol).toBeDefined()
      expect({ code: row!.code, token: row!.token }, i.symbol).toEqual(BREEZE_CODES[i.symbol])
    }
    expect(new Set(master.map(r => r.symbol)).size).toBe(master.length)
  })

  it('makes a searched stock usable by the provider and the stream, without touching the tracked map', async () => {
    const row = (await loadMaster()).find(r => !BREEZE_CODES[r.symbol])!
    expect(lookupCode(row.symbol)).toBeUndefined()
    const inst = adoptRow(row)
    expect(inst).toMatchObject({ id: `NSE:${row.symbol}`, exchange: 'NSE', kind: 'equity' })
    expect(lookupCode(row.symbol)).toEqual({ code: row.code, token: row.token })
    expect(tokenFor(inst)).toBe(row.token)
    expect(BREEZE_CODES[row.symbol]).toBeUndefined()
    registerExtra(row.symbol, { code: row.code, token: row.token }) // idempotent
  })
})

describe('index levels', () => {
  const eod = [bar('2026-10-22', 24000), bar('2026-10-23', 24100), bar('2026-10-26', 24200)]
  const now = ist('2026-10-27T11:00')

  it('is empty without data, and shows the last daily close when there is no live tick', () => {
    expect(indexLevel('i', 'Nifty', undefined, undefined, now)).toBeNull()
    expect(indexLevel('i', 'Nifty', [], undefined, now)).toBeNull()
    expect(indexLevel('i', 'Nifty', eod, undefined, now)).toMatchObject({ ltp: 24200, prevClose: 24100, live: false })
  })
  it('prefers a live tick from today, using its own previous close when present', () => {
    expect(indexLevel('i', 'Nifty', eod, { ltp: 24300, prevClose: 24210, at: ist('2026-10-27T10:59') }, now)).toMatchObject({ ltp: 24300, prevClose: 24210, live: true })
  })
  it("falls back to the last close dated before today when the tick has no previous close", () => {
    expect(indexLevel('i', 'Nifty', eod, { ltp: 24300, prevClose: null, at: ist('2026-10-27T10:59') }, now)?.prevClose).toBe(24200)
  })
  it("skips today's still-forming daily bar when choosing the reference close", () => {
    const withToday = [...eod, bar('2026-10-27', 24290)]
    expect(indexLevel('i', 'Nifty', withToday, { ltp: 24300, prevClose: null, at: ist('2026-10-27T10:59') }, now)?.prevClose).toBe(24200)
  })
  it('ignores a live tick that is not from today', () => {
    expect(indexLevel('i', 'Nifty', eod, { ltp: 99999, prevClose: 1, at: ist('2026-10-26T15:00') }, now)).toMatchObject({ ltp: 24200, live: false })
  })
})

describe('index ticks', () => {
  const byToken = new Map(BREEZE_INDICES.map(i => [i.token, i.id]))
  const tick = (len: number, over: Record<number, unknown> = {}) => {
    const t: unknown[] = new Array(len).fill(0)
    Object.assign(t, { 0: '4.1!NIFTY 50', 1: 24000, 2: 24250.5, 3: 24300, 4: 23990 }, over)
    return t
  }

  it('maps the index token, with the previous close when the array is long enough', () => {
    expect(parseIndexTick(tick(21, { 19: ist('2026-10-27T10:59') / 1000, 20: 24100 }), byToken, 0)).toEqual({ id: 'NSE:NIFTY50', ltp: 24250.5, prevClose: 24100, at: ist('2026-10-27T10:59') })
  })
  it('does not invent a previous close for short ticks', () => {
    expect(parseIndexTick(tick(8), byToken, 5)).toEqual({ id: 'NSE:NIFTY50', ltp: 24250.5, prevClose: null, at: 5 })
  })
  it('ignores untracked tokens, bad prices and junk', () => {
    expect(parseIndexTick(tick(21, { 0: '4.1!NIFTY JUNK' }), byToken, 0)).toBeNull()
    expect(parseIndexTick(tick(21, { 2: 0 }), byToken, 0)).toBeNull()
    expect(parseIndexTick('junk', byToken, 0)).toBeNull()
    expect(parseIndexTick([1, 2], byToken, 0)).toBeNull()
  })
  it('every tracked index has a distinct id, token and history code', () => {
    for (const k of ['id', 'token', 'code'] as const) expect(new Set(BREEZE_INDICES.map(i => i[k])).size).toBe(BREEZE_INDICES.length)
  })
})

describe('BreezeStream with indices and added stocks', () => {
  const session: BreezeSession = { appKey: 'K', sessionToken: 'x', userId: 'U', streamToken: 'T', obtainedAt: 0, expiresAt: Number.MAX_SAFE_INTEGER }
  const reliance = UNIVERSE.find(i => i.symbol === 'RELIANCE')!

  function harness() {
    const handlers: Record<string, (...a: unknown[]) => void> = {}
    const emitted: [string, unknown][] = []
    const socket = { on: (e: string, h: (...a: unknown[]) => void) => { handlers[e] = h; return socket }, emit: (e: string, p: unknown) => { emitted.push([e, p]) }, removeAllListeners: vi.fn(), disconnect: vi.fn() }
    const factory = vi.fn(() => socket) as unknown as ConstructorParameters<typeof BreezeStream>[2]
    const stream = new BreezeStream(session, [reliance], factory, () => 0)
    return { handlers, emitted, stream }
  }

  it('joins stock and index channels together, and keeps their ticks apart', () => {
    const { handlers, emitted, stream } = harness()
    stream.watchIndices(BREEZE_INDICES)
    stream.start()
    handlers.connect()
    expect(emitted).toHaveLength(1)
    const joined = emitted[0][1] as string[]
    expect(joined).toContain('4.1!2885')
    expect(joined).toContain('4.1!NIFTY 50')
    expect(joined).toContain('4.1!NIFTY BANK')

    const idx = new Array(21).fill(0); Object.assign(idx, { 0: '4.1!NIFTY 50', 2: 24250 })
    const stk = new Array(21).fill(0); Object.assign(stk, { 0: '4.1!2885', 2: 1200 })
    handlers.stock([idx, stk])
    expect(stream.latest().map(q => q.instrumentId)).toEqual([reliance.id])
    expect(stream.latestIndices().map(i => i.id)).toEqual(['NSE:NIFTY50'])
    expect(stream.ticksReceived).toBe(1)
    expect(stream.indexTicksReceived).toBe(1)
  })

  it('joins a stock added after connecting, once, and only for stocks it can map', () => {
    const { handlers, emitted, stream } = harness()
    stream.start()
    handlers.connect()
    emitted.length = 0
    const tcs = UNIVERSE.find(i => i.symbol === 'TCS')!
    stream.add(tcs)
    stream.add(tcs)
    stream.add({ ...tcs, id: 'NSE:NOPE', symbol: 'NOPE' })
    expect(emitted).toEqual([['join', ['4.1!11536']]])
  })
})

describe('index display order', () => {
  it('puts the headline indices first, the volatility gauge last, and unknown ones at the end, whatever order they arrive in', () => {
    const ids = ['NSE:INDIAVIX', 'NSE:XYZ', 'BSE:SENSEX', 'NSE:NIFTYBANK', 'NSE:NIFTY50', 'BSE:BSE500', 'NSE:NIFTY500']
    expect(sortLevels(ids.map(id => ({ id }))).map(x => x.id)).toEqual(['NSE:NIFTY50', 'BSE:SENSEX', 'NSE:NIFTYBANK', 'NSE:NIFTY500', 'BSE:BSE500', 'NSE:INDIAVIX', 'NSE:XYZ'])
    expect(INDEX_ORDER[0]).toBe('NSE:NIFTY50')
    expect(INDEX_ORDER.at(-1)).toBe('NSE:INDIAVIX')
  })
  it('does not mutate its input, and treats only the VIX as a gauge', () => {
    const input = [{ id: 'NSE:INDIAVIX' }, { id: 'NSE:NIFTY50' }]
    sortLevels(input)
    expect(input[0].id).toBe('NSE:INDIAVIX')
    expect(isGauge('NSE:INDIAVIX')).toBe(true)
    expect(isGauge('NSE:NIFTY50')).toBe(false)
  })
})
