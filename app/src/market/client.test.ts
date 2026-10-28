import { describe, expect, it } from 'vitest'
import { applyDay, emptyHistory, type DayRow, type Exchange, type History } from '../../api/_lib/data/history'
import { runScannerLazy, newGroup, newRule, fieldOperand as f, valueOperand as val, type ScannerConfig } from '../domain/scanner'
import { fetchIndexBars, syncExchange, toCandleSet, type Manifest, type MarketCache, type Net } from './client'

const row = (ex: Exchange, sym: string, c: number, pc = c, v = 1_000_000): DayRow => ({ id: `${ex}:${sym}`, ex, sym, o: c, h: c, l: c, c, pc, v })
const days = ['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28']

/** A server-side picture: a snapshot up to `snapAt`, then one delta per later day. Returns the manifest and a fake network. */
function publish(ex: Exchange, snapAt: string, upTo: string, price: (d: string) => number = d => 10000 + days.indexOf(d) * 100, prevClose?: (d: string) => number | undefined) {
  const files = new Map<string, unknown>()
  const h = emptyHistory()
  const deltas: Manifest['deltas'] = []
  for (const d of days.filter(x => x <= upTo)) {
    const prev = days[days.indexOf(d) - 1]
    const rows = [row(ex, 'AAA', price(d), prevClose?.(d) ?? (prev ? price(prev) : price(d)))]
    applyDay(h, d, rows)
    if (d > snapAt) { files.set(`delta-${ex}-${d}`, rows); deltas.push({ file: `delta-${ex}-${d}`, date: d, ex }) }
    if (d === snapAt) files.set(`snap-${ex}`, JSON.parse(JSON.stringify(h)))
  }
  const urls: Record<string, string> = {}
  for (const k of files.keys()) urls[k] = `u://${k}`
  const manifest: Manifest = { latestDate: upTo, snapshots: { [ex]: { file: `snap-${ex}`, date: snapAt } }, deltas, indices: null, urls, updatedAt: '' }
  const fetched: string[] = []
  const net: Net = {
    async json<T>() { return manifest as T },
    async gz<T>(url: string) { fetched.push(url); return JSON.parse(JSON.stringify(files.get(url.slice(4)))) as T },
  }
  return { manifest, net, fetched }
}

const memCache = (seed: Partial<Record<Exchange, { history: History; date: string }>> = {}): MarketCache & { data: typeof seed } => {
  const data = { ...seed }
  return { data, get: async ex => data[ex], put: async (ex, history, date) => { data[ex] = { history, date } } }
}

describe('market sync', () => {
  it('downloads the snapshot (plus later deltas) on first use and caches it', async () => {
    const { manifest, net, fetched } = publish('NSE', '2026-10-26', '2026-10-28')
    const cache = memCache()
    const r = (await syncExchange('NSE', manifest, cache, net))!
    expect(r.kind).toBe('snapshot')
    expect(r.history.dates).toEqual(['2026-10-23', '2026-10-26', '2026-10-27', '2026-10-28'])
    expect(r.history.stocks['NSE:AAA'].c).toEqual([10000, 10100, 10200, 10300])
    expect(fetched).toEqual(['u://snap-NSE', 'u://delta-NSE-2026-10-27', 'u://delta-NSE-2026-10-28'])
    expect(cache.data.NSE!.date).toBe('2026-10-28')
  })

  it('makes no downloads when the cache is current, and only fetches new daily files when slightly behind', async () => {
    const first = publish('NSE', '2026-10-26', '2026-10-27')
    const cache = memCache()
    await syncExchange('NSE', first.manifest, cache, first.net)

    const same = await syncExchange('NSE', first.manifest, cache, first.net)
    expect(same!.kind).toBe('none')

    const later = publish('NSE', '2026-10-26', '2026-10-28')
    const r = (await syncExchange('NSE', later.manifest, cache, later.net))!
    expect(r.kind).toBe('deltas')
    expect(later.fetched).toEqual(['u://delta-NSE-2026-10-28']) // just the one new day
    expect(r.history.stocks['NSE:AAA'].c).toEqual([10000, 10100, 10200, 10300])
  })

  it('re-downloads the snapshot when the cache predates it (the server rolled a new one)', async () => {
    const old = publish('NSE', '2026-10-23', '2026-10-26')
    const cache = memCache()
    await syncExchange('NSE', old.manifest, cache, old.net)
    const rolled = publish('NSE', '2026-10-28', '2026-10-28')
    const r = (await syncExchange('NSE', rolled.manifest, cache, rolled.net))!
    expect(r.kind).toBe('snapshot')
    expect(rolled.fetched).toEqual(['u://snap-NSE'])
  })

  it('reports an exchange that is not published, and a manifest address that is missing', async () => {
    const { manifest, net } = publish('NSE', '2026-10-26', '2026-10-27')
    expect(await syncExchange('BSE', manifest, memCache(), net)).toBeNull()
    delete manifest.urls['snap-NSE']
    await expect(syncExchange('NSE', manifest, memCache(), net)).rejects.toThrow(/no address/)
  })

  it('applying deltas client-side gives the same history as the server built', async () => {
    // On the 28th the stock halves (a 1:2 split). The exchange reports the ADJUSTED previous close (5000), which no longer
    // matches the 10000 we stored, and that mismatch is what triggers the back-adjustment.
    const { manifest, net } = publish('NSE', '2026-10-23', '2026-10-28', d => (d === '2026-10-28' ? 5000 : 10000), d => (d === '2026-10-28' ? 5000 : undefined))
    const r = (await syncExchange('NSE', manifest, memCache(), net))!
    expect(r.history.dates).toHaveLength(4)
    expect(r.history.stocks['NSE:AAA'].c).toEqual([5000, 5000, 5000, 5000]) // earlier bars were back-adjusted, as on the server
  })
})

describe('turning history into scannable stocks', () => {
  it('converts paise to rupees, skips non-trading days, and names BSE stocks from the file or NSE ones from a lookup', () => {
    const h = emptyHistory()
    applyDay(h, '2026-10-26', [{ ...row('BSE', 'ABB', 654200), name: 'ABB INDIA LIMITED' }, row('NSE', 'TCS', 300000)])
    applyDay(h, '2026-10-27', [row('NSE', 'TCS', 301000, 300000)])
    const bse = toCandleSet(h, 'BSE:ABB', undefined)!
    expect(bse.instrument).toMatchObject({ exchange: 'BSE', symbol: 'ABB', name: 'ABB INDIA LIMITED' })
    expect(bse.candles.map(c => c.c)).toEqual([6542]) // absent on the 27th
    const nse = toCandleSet(h, 'NSE:TCS', new Map([['TCS', 'Tata Consultancy Services']]))!
    expect(nse.instrument.name).toBe('Tata Consultancy Services')
    expect(nse.candles.map(c => c.c)).toEqual([3000, 3010])
    expect(nse.candles.every(c => c.closed)).toBe(true)
    expect(toCandleSet(h, 'NSE:NOPE')).toBeNull()
  })

  it('turns published index files into candles', async () => {
    const m = { indices: { file: 'ix', date: '2026-10-27' }, urls: { ix: 'u://ix' } } as unknown as Manifest
    const net: Net = { json: async () => ({}) as never, gz: async () => ({ date: '2026-10-27', items: [{ id: 'BSE:SENSEX', name: 'Sensex', bars: [['2026-10-26', 1, 2, 0.5, 1.5], ['2026-10-27', 1.5, 3, 1, 2.5]] }] }) as never }
    const out = await fetchIndexBars(m, net)
    expect(out[0]).toMatchObject({ id: 'BSE:SENSEX', name: 'Sensex' })
    expect(out[0].candles.map(c => c.c)).toEqual([1.5, 2.5])
    expect(await fetchIndexBars({ indices: null } as Manifest, net)).toEqual([])
  })
})

describe('chunked market scan', () => {
  const cfg: ScannerConfig = {
    id: 't', name: 'above 100', description: '', timeframe: '1D', version: 1, requires: null,
    universe: { minPrice: null, maxPrice: null, minAvgTradedValueCr: null, sectors: [] },
    ranking: { trend: 1, relStrength: 1, volume: 1, momentum: 1 },
    root: newGroup('ALL', [newRule({ left: f('close'), op: 'above', right: val(100) })]),
  }

  it('looks at every stock in chunks, keeps only matches ranked, reports progress and yields between chunks', async () => {
    const h = emptyHistory()
    const rows: DayRow[] = []
    for (let i = 0; i < 25; i++) rows.push(row('NSE', `S${i}`, i % 2 ? 20000 : 5000)) // odd ones are above Rs 100
    for (const d of ['2026-10-26', '2026-10-27']) applyDay(h, d, rows)
    const ids = Object.keys(h.stocks)
    const progress: number[] = []
    const run = (await runScannerLazy(cfg, { ids, make: id => toCandleSet(h, id), benchmarkFor: () => null, label: 'All NSE', source: 'market', onProgress: d => progress.push(d) }, 10))!
    expect(run.universeSize).toBe(25)
    expect(run.results).toHaveLength(12)
    expect(run.matchesOnly).toBe(true)
    expect(run.universe).toBe('All NSE')
    expect(run.results.every(r => r.matched)).toBe(true)
    expect(progress).toEqual([10, 20, 25])
  })

  it('stops early and returns nothing when cancelled', async () => {
    const h = emptyHistory()
    applyDay(h, '2026-10-26', [row('NSE', 'A', 20000)]); applyDay(h, '2026-10-27', [row('NSE', 'A', 20000)])
    const out = await runScannerLazy(cfg, { ids: ['NSE:A'], make: id => toCandleSet(h, id), benchmarkFor: () => null, label: 'x', source: 'market', cancelled: () => true })
    expect(out).toBeNull()
  })
})
