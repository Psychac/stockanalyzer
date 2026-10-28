import { describe, expect, it } from 'vitest'
import { aggregate, isIntraday, weekStart } from './domain/timeframes'
import { istDate, sessionOpen } from './domain/time'
import type { Candle } from './domain/types'
import { UNIVERSE } from './providers/universe'
import { UNIVERSE_ISIN } from './providers/isin'
import { IntradayError, fetchIntraday, historyUrl, mergeBars, parseUpstoxCandles, todayUrl, upstoxKey } from './market/intraday'

const ist = (s: string) => Date.parse(`${s}:00+05:30`)
const day = (date: string, o: number, h: number, l: number, c: number, v = 100, closed = true): Candle => ({ t: sessionOpen(date), o, h, l, c, v, closed })

describe('weekly and monthly bars', () => {
  // Mon 19 Oct .. Fri 23 Oct, then Mon 26 .. Tue 27 Oct 2026
  const daily = [
    day('2026-10-19', 10, 12, 9, 11), day('2026-10-20', 11, 15, 10, 14), day('2026-10-21', 14, 14, 8, 9), day('2026-10-22', 9, 13, 9, 12), day('2026-10-23', 12, 16, 12, 15),
    day('2026-10-26', 15, 17, 14, 16), day('2026-10-27', 16, 20, 15, 19),
  ]
  const now = ist('2026-10-28T10:00')

  it('finds Monday of any weekday, including a Sunday', () => {
    expect(weekStart('2026-10-23')).toBe('2026-10-19') // Friday
    expect(weekStart('2026-10-19')).toBe('2026-10-19') // Monday
    expect(weekStart('2026-10-25')).toBe('2026-10-19') // Sunday belongs to the week before
  })

  it('rolls days into weeks: first open, highest high, lowest low, last close, summed volume', () => {
    const w = aggregate(daily, '1W', now)
    expect(w).toHaveLength(2)
    expect(w[0]).toMatchObject({ o: 10, h: 16, l: 8, c: 15, v: 500 })
    expect(istDate(w[0].t)).toBe('2026-10-19') // opens at the first session, so it lines up with the daily chart
    expect(w[1]).toMatchObject({ o: 15, h: 20, l: 14, c: 19, v: 200 })
  })

  it('marks a finished week closed and the current one forming', () => {
    const w = aggregate(daily, '1W', now)
    expect(w[0].closed).toBe(true) // ended on Friday
    expect(w[1].closed).toBe(false) // Tuesday: the week is not over
  })

  it('a week with a Friday holiday completes once the next week has begun', () => {
    const shortWeek = [day('2026-10-19', 1, 2, 1, 2), day('2026-10-22', 2, 3, 2, 3)] // no Friday session
    expect(aggregate(shortWeek, '1W', ist('2026-10-23T12:00'))[0].closed).toBe(false) // still that week
    expect(aggregate(shortWeek, '1W', ist('2026-10-26T10:00'))[0].closed).toBe(true)
  })

  it('a bar made from an unfinished day stays forming even if the week is over', () => {
    const w = aggregate([day('2026-10-23', 1, 2, 1, 2, 5, false)], '1W', ist('2026-10-30T10:00'))
    expect(w[0].closed).toBe(false)
  })

  it('rolls days into months and closes a month only once it is over', () => {
    const m = aggregate([day('2026-09-29', 5, 6, 4, 5), day('2026-09-30', 5, 8, 5, 7), day('2026-10-01', 7, 9, 6, 8), day('2026-10-27', 8, 10, 7, 9)], '1M', now)
    expect(m).toHaveLength(2)
    expect(m[0]).toMatchObject({ o: 5, h: 8, l: 4, c: 7 })
    expect(m[0].closed).toBe(true)
    expect(m[1]).toMatchObject({ o: 7, h: 10, l: 6, c: 9 })
    expect(m[1].closed).toBe(false)
  })

  it('does not alter its input and handles empty input', () => {
    const copy = JSON.stringify(daily)
    aggregate(daily, '1W', now)
    expect(JSON.stringify(daily)).toBe(copy)
    expect(aggregate([], '1M', now)).toEqual([])
  })

  it('knows which timeframes are intraday', () => {
    for (const tf of ['1m', '5m', '15m', '30m', '1h'] as const) expect(isIntraday(tf)).toBe(true)
    for (const tf of ['1D', '1W', '1M'] as const) expect(isIntraday(tf)).toBe(false)
  })
})

describe('intraday candles', () => {
  const now = ist('2026-10-27T11:00')
  // Upstox returns newest first, with +05:30 offsets
  const rows = [
    ['2026-10-27T10:55:00+05:30', 105, 107, 104, 106, 900, 0], // 5m bar still forming at 11:00? 10:55+5m = 11:00 <= now, so closed
    ['2026-10-27T11:00:00+05:30', 106, 108, 105, 107, 400, 0], // starts at 11:00: forming
    ['2026-10-27T09:15:00+05:30', 100, 104, 99, 103, 1500, 0],
    ['2026-10-27T09:15:00+05:30', 100, 104, 99, 103, 1500, 0], // duplicate
    ['garbage', 1, 1, 1, 1, 1, 0], ['2026-10-27T09:20:00+05:30', 0, 5, 4, 4, 1, 0], ['2026-10-27T09:25:00+05:30', 5, 4, 6, 5, 1, 0], // bad rows
  ]

  it('parses newest-first rows into oldest-first bars, drops duplicates and bad rows, and flags forming bars', () => {
    const bars = parseUpstoxCandles({ data: { candles: rows } }, '5m', now)
    expect(bars.map(b => [b.t, b.c, b.closed])).toEqual([
      [ist('2026-10-27T09:15'), 103, true],
      [ist('2026-10-27T10:55'), 106, true],
      [ist('2026-10-27T11:00'), 107, false],
    ])
    expect(bars[0].v).toBe(1500)
    expect(parseUpstoxCandles({ nope: 1 }, '5m', now)).toEqual([])
    expect(parseUpstoxCandles(null, '5m', now)).toEqual([])
  })

  it('merges two lists with the newer one winning on overlap', () => {
    const a = [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1, closed: true }, { t: 2, o: 1, h: 1, l: 1, c: 2, v: 1, closed: false }]
    const b = [{ t: 2, o: 1, h: 1, l: 1, c: 9, v: 1, closed: true }, { t: 3, o: 1, h: 1, l: 1, c: 3, v: 1, closed: false }]
    expect(mergeBars(a, b).map(x => [x.t, x.c])).toEqual([[1, 1], [2, 9], [3, 3]])
  })

  it('builds the documented URLs, with the pipe encoded and the date range inside the limits', () => {
    expect(todayUrl('NSE_EQ|INE002A01018', '5m')).toBe('https://api.upstox.com/v3/historical-candle/intraday/NSE_EQ%7CINE002A01018/minutes/5')
    expect(historyUrl('NSE_EQ|INE002A01018', '5m', ist('2026-10-27T11:00'))).toBe('https://api.upstox.com/v3/historical-candle/NSE_EQ%7CINE002A01018/minutes/5/2026-10-27/2026-09-27')
    expect(historyUrl('NSE_INDEX|Nifty 50', '1h', ist('2026-10-27T11:00'))).toContain('%7CNifty%2050/hours/1/2026-10-27/2026-07-29')
    expect(historyUrl('X|Y', '1m', ist('2026-10-27T11:00'))).toContain('/minutes/1/2026-10-27/2026-10-21') // six days, well within a month
  })

  it('picks the instrument key by exchange, or reports it cannot', () => {
    const nse = { id: 'NSE:RELIANCE', exchange: 'NSE' as const, kind: 'equity' as const }
    expect(upstoxKey(nse, 'INE002A01018')).toBe('NSE_EQ|INE002A01018')
    expect(upstoxKey({ ...nse, id: 'BSE:500325', exchange: 'BSE' }, 'INE002A01018')).toBe('BSE_EQ|INE002A01018')
    expect(upstoxKey(nse, undefined)).toBeNull()
    expect(upstoxKey({ id: 'BSE:SENSEX', exchange: 'BSE', kind: 'index' }, undefined)).toBe('BSE_INDEX|SENSEX')
    expect(upstoxKey({ id: 'NSE:UNKNOWN', exchange: 'NSE', kind: 'index' }, undefined)).toBeNull()
  })

  it('fetches history and today together and merges them; a refresh asks only for today', async () => {
    const urls: string[] = []
    const get = async (url: string) => {
      urls.push(url)
      return { status: 200, json: { data: { candles: url.includes('/intraday/') ? [['2026-10-27T11:00:00+05:30', 6, 7, 5, 6.5, 10, 0]] : [['2026-10-27T10:55:00+05:30', 5, 6, 4, 5.5, 10, 0], ['2026-10-26T15:25:00+05:30', 4, 5, 3, 4.5, 10, 0]] } } }
    }
    const full = await fetchIntraday('NSE_EQ|X', '5m', now, get)
    expect(urls).toHaveLength(2)
    expect(full.map(b => b.c)).toEqual([4.5, 5.5, 6.5])
    urls.length = 0
    const refresh = await fetchIntraday('NSE_EQ|X', '5m', now, get, true)
    expect(urls).toEqual([todayUrl('NSE_EQ|X', '5m')])
    expect(refresh).toHaveLength(1)
  })

  it('still returns what it has when only one of the two requests works', async () => {
    const get = async (url: string) => (url.includes('/intraday/') ? { status: 503, json: null } : { status: 200, json: { data: { candles: [['2026-10-26T15:25:00+05:30', 4, 5, 3, 4.5, 10, 0]] } } })
    expect((await fetchIntraday('K', '5m', now, get)).length).toBe(1)
  })

  it('throws a readable error when nothing comes back, never an empty chart or a crash', async () => {
    await expect(fetchIntraday('K', '5m', now, async () => ({ status: 503, json: null }))).rejects.toThrow(/HTTP 503/)
    await expect(fetchIntraday('K', '5m', now, async () => { throw new TypeError('offline') })).rejects.toThrow(/Could not reach/)
    await expect(fetchIntraday('K', '5m', now, async () => ({ status: 200, json: { data: { candles: [] } } }))).rejects.toBeInstanceOf(IntradayError)
  })
})

describe('tracked-stock ISINs', () => {
  it('covers every tracked stock with a well-formed ISIN', () => {
    for (const i of UNIVERSE) expect(UNIVERSE_ISIN[i.symbol], i.symbol).toMatch(/^INE[0-9A-Z]{9}$/)
    expect(UNIVERSE_ISIN.RELIANCE).toBe('INE002A01018')
  })
})
