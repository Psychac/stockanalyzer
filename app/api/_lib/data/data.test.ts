import { describe, expect, it } from 'vitest'
import { MAX_SESSIONS, applyDay, candlesOf, emptyHistory, prune, type DayRow } from './history.js'
import { nseDate, parseBse, parseNse, splitCsv } from './parse.js'
import { INDICES, advance, bseUrl, nseUrl, type Deps } from './ingest.js'
import { memoryStore } from './store.js'

const NSE_CSV = (date: string, rows: string[]) => `SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER\n${rows.map(r => r.replace('DATE', date)).join('\n')}`
const BSE_HEAD = 'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4'
const bseRow = (date: string, id: string, sym: string, name: string, o: number, h: number, l: number, c: number, pc: number, v: number, tp = 'STK') =>
  `${date},${date},CM,BSE,${tp},${id},INE000A01000,${sym},A,,,,,${name},${o},${h},${l},${c},${c},${pc},,${c},,,${v},1,1,F1,1,,,,,`

const row = (id: string, c: number, pc: number, v = 1_000_000): DayRow => ({ id, ex: 'NSE', sym: id.slice(4), o: c, h: c, l: c, c, pc, v })

describe('parsers', () => {
  it('splits quoted CSV fields', () => {
    expect(splitCsv('a, "b, c" ,d,"e ""q"""')).toEqual(['a', 'b, c', 'd', 'e "q"'])
  })
  it('parses the NSE file: keeps EQ and BE, drops other series and bad rows, converts to paise', () => {
    const p = parseNse(NSE_CSV('27-Oct-2026', [
      'ABC, EQ, DATE, 100.00, 101.50, 105.25, 99.00, 104, 104.10, 103, 5000, 5.0, 10, 100, 50.0',
      'XYZ, BE, DATE, 10.00, 10.00, 10.50, 9.90, 10, 10.20, 10, 700, 1.0, 5, 1, 1',
      'SME, SM, DATE, 50, 50, 51, 49, 50, 50, 50, 10, 1, 1, 1, 1',
      'BAD, EQ, DATE, 5, -, 6, 4, 5, 5, 5, 10, 1, 1, 1, 1',
    ]))!
    expect(p.date).toBe('2026-10-27')
    expect(p.rows).toEqual([
      { id: 'NSE:ABC', ex: 'NSE', sym: 'ABC', o: 10150, h: 10525, l: 9900, c: 10410, pc: 10000, v: 5000 },
      { id: 'NSE:XYZ', ex: 'NSE', sym: 'XYZ', o: 1000, h: 1050, l: 990, c: 1020, pc: 1000, v: 700 },
    ])
    expect(nseDate('1-Jan-2026')).toBe('2026-01-01')
    expect(nseDate('garbage')).toBeNull()
  })
  it('rejects a file whose columns are not the expected ones', () => {
    expect(parseNse('foo,bar\n1,2')).toBeNull()
    expect(parseBse('foo,bar\n1,2')).toBeNull()
  })
  it('parses the BSE file keyed by scrip code, equity only', () => {
    const p = parseBse([BSE_HEAD, bseRow('2026-10-27', '500002', 'ABB', 'ABB INDIA LIMITED', 6371.5, 6542, 6340.65, 6542, 6350, 9990), bseRow('2026-10-27', '800001', 'DEBT', 'A BOND', 100, 100, 100, 100, 100, 5, 'DBT')].join('\n'))!
    expect(p.date).toBe('2026-10-27')
    expect(p.rows).toHaveLength(1)
    expect(p.rows[0]).toMatchObject({ id: 'BSE:500002', ex: 'BSE', sym: 'ABB', name: 'ABB INDIA LIMITED', c: 654200, pc: 635000, v: 9990 })
  })
})

describe('history', () => {
  it('aligns every stock to the shared dates and pads absences with zero', () => {
    const h = emptyHistory()
    applyDay(h, '2026-10-26', [row('NSE:A', 10000, 10000), row('NSE:B', 5000, 5000)])
    applyDay(h, '2026-10-27', [row('NSE:A', 10100, 10000), row('NSE:C', 700, 700)])
    expect(h.dates).toEqual(['2026-10-26', '2026-10-27'])
    expect(h.stocks['NSE:A'].c).toEqual([10000, 10100])
    expect(h.stocks['NSE:B'].c).toEqual([5000, 0])
    expect(h.stocks['NSE:C'].c).toEqual([0, 700])
    for (const s of Object.values(h.stocks)) expect(s.v).toHaveLength(2)
  })
  it('ignores a repeated or older day', () => {
    const h = emptyHistory()
    expect(applyDay(h, '2026-10-27', [row('NSE:A', 10000, 10000)])).toBe(true)
    expect(applyDay(h, '2026-10-27', [row('NSE:A', 99900, 10000)])).toBe(false)
    expect(applyDay(h, '2026-10-20', [row('NSE:A', 99900, 10000)])).toBe(false)
    expect(h.stocks['NSE:A'].c).toEqual([10000])
  })
  it('back-adjusts price and volume across a 1:2 split so it does not look like a crash', () => {
    const h = emptyHistory()
    applyDay(h, '2026-10-26', [row('NSE:S', 20000, 20000, 1_000_000)])
    applyDay(h, '2026-10-27', [row('NSE:S', 10200, 10000, 2_200_000)]) // pc is half of yesterday's close
    const s = h.stocks['NSE:S']
    expect(s.c).toEqual([10000, 10200])
    expect(s.v).toEqual([2_000_000, 2_200_000])
    expect(s.o[0]).toBe(10000)
  })
  it('adjusts for a bonus (ratio above one is impossible here, but a 1:1 bonus halves the price) and leaves normal moves alone', () => {
    const h = emptyHistory()
    applyDay(h, '2026-10-26', [row('NSE:A', 10000, 10000)])
    applyDay(h, '2026-10-27', [row('NSE:A', 10400, 10000)]) // +4% move, prev close matches
    expect(h.stocks['NSE:A'].c).toEqual([10000, 10400])
  })
  it('skips adjustment when the previous close is unknown or absurd', () => {
    const h = emptyHistory()
    applyDay(h, '2026-10-26', [row('NSE:A', 10000, 10000)])
    applyDay(h, '2026-10-27', [row('NSE:A', 10100, 0)])
    applyDay(h, '2026-10-28', [row('NSE:A', 10100, 1)]) // ratio 0.0001: ignore rather than destroy history
    expect(h.stocks['NSE:A'].c).toEqual([10000, 10100, 10100])
  })
  it('admits a new stock only when liquid enough, always tracks known ones, and prunes the persistently illiquid', () => {
    const h = emptyHistory()
    applyDay(h, '2026-10-26', [row('NSE:LIQ', 10000, 10000, 1_000_000), row('NSE:THIN', 10000, 10000, 10_000)])
    expect(Object.keys(h.stocks)).toEqual(['NSE:LIQ']) // THIN's turnover is Rs 10 lakh: not admitted
    applyDay(h, '2026-10-27', [row('NSE:LIQ', 10000, 10000, 1_000)]) // a quiet day for a known stock is still recorded
    expect(h.stocks['NSE:LIQ'].v).toEqual([1_000_000, 1_000])
    const quiet = emptyHistory()
    applyDay(quiet, '2026-10-26', [row('NSE:X', 10000, 10000, 55_000)]) // admitted at Rs 55 lakh
    applyDay(quiet, '2026-10-27', [row('NSE:X', 10000, 10000, 1_000)])
    applyDay(quiet, '2026-10-28', [row('NSE:X', 10000, 10000, 1_000)])
    expect(prune(quiet)).toBe(1) // average now far below the keep threshold
    expect(quiet.stocks['NSE:X']).toBeUndefined()
  })
  it('keeps only the last MAX_SESSIONS and drops stocks that vanish from the window', () => {
    const h = emptyHistory()
    applyDay(h, '2020-01-01', [row('NSE:OLD', 10000, 10000)])
    for (let i = 0; i < MAX_SESSIONS; i++) applyDay(h, `2021-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, [row('NSE:A', 10000, 10000)])
    expect(h.dates).toHaveLength(MAX_SESSIONS)
    expect(h.stocks['NSE:OLD']).toBeUndefined()
    expect(h.stocks['NSE:A'].c).toHaveLength(MAX_SESSIONS)
  })
  it('turns a stock into candles in rupees, skipping non-trading days', () => {
    const h = emptyHistory()
    applyDay(h, '2026-10-26', [row('NSE:A', 10050, 10050, 1_000_007)])
    applyDay(h, '2026-10-27', [])
    applyDay(h, '2026-10-28', [row('NSE:A', 10200, 10050, 1_000_009)])
    expect(candlesOf(h, 'NSE:A', d => Date.parse(`${d}T00:00:00Z`)).map(c => [c.c, c.v])).toEqual([[100.5, 1_000_007], [102, 1_000_009]])
  })
})

/** Fake exchanges: a map of date -> {nse, bse} availability, with a settable "now". */
function world(opts: { today: string; htmlHolidays?: string[]; holidays?: string[]; nseOnly?: string[]; stale?: string[]; fail?: string[] }) {
  const calls: string[] = []
  const nowMs = Date.parse(`${opts.today}T14:30:00Z`)
  const dateOf = (url: string) => {
    const m = /(\d{2})(\d{2})(\d{4})\.csv/.exec(url)
    return m ? `${m[3]}-${m[2]}-${m[1]}` : /(\d{4})(\d{2})(\d{2})_F_0000/.exec(url)!.slice(1).join('-')
  }
  const fetchText: Deps['fetchText'] = async url => {
    calls.push(url)
    const d = dateOf(url)
    const isNse = url.includes('nsearchives')
    if (opts.fail?.includes(d)) return { status: 503, text: '' }
    if (opts.holidays?.includes(d)) return { status: 404, text: '' }
    if (opts.htmlHolidays?.includes(d) && !isNse) return { status: 200, text: '<!DOCTYPE html><html><body>Not found</body></html>' }
    if (!isNse && opts.nseOnly?.includes(d)) return { status: 404, text: '' }
    const filed = opts.stale?.includes(d) ? '2020-01-02' : d
    const day = Number(d.slice(8))
    if (isNse) {
      const nd = `${String(Number(filed.slice(8))).padStart(2, '0')}-Oct-${filed.slice(0, 4)}`
      return { status: 200, text: NSE_CSV(nd, [`AAA, EQ, DATE, ${100 + day}, ${100 + day}, ${105 + day}, ${99 + day}, ${100 + day}, ${100 + day}, 1, 1000000, 1, 1, 1, 1`]) }
    }
    return { status: 200, text: [BSE_HEAD, bseRow(filed, '500001', 'BBB', 'B LTD', 50 + day, 55 + day, 49 + day, 50 + day, 50 + day, 4_000_000)].join('\n') }
  }
  const fetchJson: Deps['fetchJson'] = async url => {
    calls.push(url)
    return { status: 200, json: { data: { candles: [[`${opts.today}T00:00:00+05:30`, 1, 2, 0.5, 1.5, 0, 0], ['2026-01-02T00:00:00+05:30', 1, 2, 0.5, 1.2, 0, 0]] } } }
  }
  return { fetchText, fetchJson, calls, now: () => nowMs }
}

describe('ingest', () => {
  it('first run backfills every trading day, skipping weekends and holidays, and writes one snapshot', async () => {
    const store = memoryStore()
    const w = world({ today: '2026-10-28', holidays: ['2026-10-21'] })
    const r = await advance({ store, ...w }, { startDate: '2026-10-19' })
    expect(r.applied).toEqual(['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28'])
    expect(r.skipped).toEqual(['2026-10-21'])
    expect(r.stopped).toBeNull()
    expect(r.wrote.filter(f => f.startsWith('snapshot'))).toHaveLength(2) // one per exchange
    expect(r.wrote.some(f => f.startsWith('delta'))).toBe(false)
    const m = store.manifest()!
    expect(m).toMatchObject({ latestDate: '2026-10-28', deltas: [], snapshots: { NSE: { date: '2026-10-28' }, BSE: { date: '2026-10-28' } } })
    expect(m.indices?.file).toBe('indices-2026-10-28.json.gz')
    const idx = await store.getJson<{ items: { id: string; bars: unknown[][] }[] }>(m.indices!.file)
    expect(idx!.items).toHaveLength(INDICES.length)
    expect(idx!.items[0].bars[0][0]).toBe('2026-01-02') // oldest first
    // NSE and BSE both made it into one history
    expect(Object.keys((await store.getJson<{ stocks: object }>(m.snapshots.NSE!.file))!.stocks)).toEqual(['NSE:AAA'])
    expect(Object.keys((await store.getJson<{ stocks: object }>(m.snapshots.BSE!.file))!.stocks)).toEqual(['BSE:500001'])
  })

  it('a nightly run adds a small delta instead of rewriting the snapshot, and is a no-op when nothing is new', async () => {
    const store = memoryStore()
    await advance({ store, ...world({ today: '2026-10-27' }) }, { startDate: '2026-10-26' })
    const before = store.puts()
    const r = await advance({ store, ...world({ today: '2026-10-28' }) })
    expect(r.applied).toEqual(['2026-10-28'])
    expect(r.wrote).toEqual(['delta-NSE-2026-10-28.json.gz', 'delta-BSE-2026-10-28.json.gz', 'indices-2026-10-28.json.gz', 'manifest.json'])
    expect(store.puts() - before).toBe(4)
    expect(store.manifest()!.deltas.map(d => d.date)).toEqual(['2026-10-28', '2026-10-28'])
    expect(store.files.has('indices-2026-10-27.json.gz')).toBe(false) // previous indices file cleaned up

    const again = await advance({ store, ...world({ today: '2026-10-28' }) })
    expect(again.applied).toEqual([])
    expect(again.stopped).toBeNull()
    expect(store.puts() - before).toBe(4) // nothing written
  })

  it('rebuilds the same history from snapshot plus deltas as from scratch', async () => {
    const a = memoryStore()
    await advance({ store: a, ...world({ today: '2026-10-26' }) }, { startDate: '2026-10-19' })
    await advance({ store: a, ...world({ today: '2026-10-27' }) })
    await advance({ store: a, ...world({ today: '2026-10-28' }) })
    const b = memoryStore()
    await advance({ store: b, ...world({ today: '2026-10-28' }) }, { startDate: '2026-10-19' })
    const hist = async (s: typeof a) => { const m = s.manifest()!; return s.getJson<{ dates: string[] }>(m.snapshots.NSE!.file) }
    expect(a.manifest()!.deltas).toHaveLength(4) // two days, two exchanges
    expect((await hist(b))!.dates).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28'])
    // the incremental store's latest state, replayed, equals the from-scratch one
    const next = await advance({ store: a, ...world({ today: '2026-10-28' }) })
    expect(next.applied).toEqual([])
  })

  it('folds into a new snapshot when a week of deltas piles up', async () => {
    const store = memoryStore()
    await advance({ store, ...world({ today: '2026-10-05' }) }, { startDate: '2026-10-05' })
    const days = ['2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']
    for (const d of days) await advance({ store, ...world({ today: d }) })
    const m = store.manifest()!
    expect(new Set(m.deltas.map(d => d.date)).size).toBeLessThanOrEqual(7)
    expect(m.snapshots.NSE!.date >= '2026-10-13').toBe(true)
    expect([...store.files.keys()].filter(f => f.startsWith('snapshot'))).toHaveLength(2) // one per exchange, older ones removed
  })

  it('does not file a day until both exchanges have published it', async () => {
    const store = memoryStore()
    const r = await advance({ store, ...world({ today: '2026-10-28', nseOnly: ['2026-10-28'] }) }, { startDate: '2026-10-27' })
    expect(r.applied).toEqual(['2026-10-27'])
    expect(r.stopped).toContain('only one exchange')
    const later = await advance({ store, ...world({ today: '2026-10-28' }) })
    expect(later.applied).toEqual(['2026-10-28'])
  })

  it('accepts a one-exchange day once it is old enough to be a genuine exchange holiday', async () => {
    const r = await advance({ store: memoryStore(), ...world({ today: '2026-10-28', nseOnly: ['2026-10-20'] }) }, { startDate: '2026-10-20' })
    expect(r.applied[0]).toBe('2026-10-20')
  })

  it("treats BSE's HTML page for a missing day as no file, not as an error", async () => {
    const r = await advance({ store: memoryStore(), ...world({ today: '2026-10-28', htmlHolidays: ['2026-10-21'], holidays: [] }) }, { startDate: '2026-10-20' })
    expect(r.stopped).toBeNull()
    expect(r.applied).toContain('2026-10-21') // NSE has it; BSE had none, and the day is old enough to accept
  })

  it('treats an unpublished today as a clean stop, not an error', async () => {
    const r = await advance({ store: memoryStore(), ...world({ today: '2026-10-28', holidays: ['2026-10-28'] }) }, { startDate: '2026-10-27' })
    expect(r.applied).toEqual(['2026-10-27'])
    expect(r.stopped).toBe('today is not published yet')
  })

  it('never files a stale file under the requested date', async () => {
    const r = await advance({ store: memoryStore(), ...world({ today: '2026-10-28', stale: ['2026-10-26'] }) }, { startDate: '2026-10-26' })
    expect(r.applied).toEqual(['2026-10-27', '2026-10-28'])
    expect(r.skipped).toEqual(['2026-10-26'])
  })

  it('stops on a server error and resumes from there next time', async () => {
    const store = memoryStore()
    const r = await advance({ store, ...world({ today: '2026-10-28', fail: ['2026-10-27'] }) }, { startDate: '2026-10-26' })
    expect(r.applied).toEqual(['2026-10-26'])
    expect(r.stopped).toContain('2026-10-27')
    expect(store.manifest()!.latestDate).toBe('2026-10-26')
    const ok = await advance({ store, ...world({ today: '2026-10-28' }) })
    expect(ok.applied).toEqual(['2026-10-27', '2026-10-28'])
  })

  it('honours the time budget and day cap so a long backfill is resumable', async () => {
    const store = memoryStore()
    const r = await advance({ store, ...world({ today: '2026-10-28' }) }, { startDate: '2026-10-05', maxDays: 3 })
    expect(r.applied).toHaveLength(3)
    expect(r.stopped).toContain('run again')
    const rest = await advance({ store, ...world({ today: '2026-10-28' }) })
    expect(rest.applied[0]).toBe('2026-10-08')
    expect(rest.stopped).toBeNull()
  })

  it('uses the documented file URLs', () => {
    expect(nseUrl('2026-10-27')).toBe('https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_27102026.csv')
    expect(bseUrl('2026-10-27')).toBe('https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_20261027_F_0000.CSV')
  })
})
