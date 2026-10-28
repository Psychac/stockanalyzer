import { applyDay, type DayRow, type Exchange, type History } from '../../api/_lib/data/history'
import type { Candle, CandleSet, Instrument } from '../domain/types'
import { sessionOpen } from '../domain/time'

/** What `GET /api/data/manifest` returns. Mirrors the server's type (which cannot be imported: it pulls in Node modules). */
export interface Manifest {
  latestDate: string | null
  snapshots: Partial<Record<Exchange, { file: string; date: string; rev?: number }>>
  deltas: { file: string; date: string; ex: Exchange }[]
  indices: { file: string; date: string } | null
  search?: { file: string; date: string; rev?: number } | null
  pulse?: { file: string; date: string; rev?: number } | null
  rev?: number
  urls: Record<string, string>
  updatedAt: string
}

import type { Pulse } from '../../api/_lib/data/pulse'
export type { Pulse, ExchangePulse, PulseMover } from '../../api/_lib/data/pulse'

export interface IndexFile { date: string; items: { id: string; name: string; bars: [string, number, number, number, number][] }[] }

/** How the browser reaches the network. Replaced in tests. */
export interface Net {
  json<T>(url: string): Promise<T>
  gz<T>(url: string, onBytes?: (loaded: number, total: number) => void): Promise<T>
}

export interface MarketCache {
  get(ex: Exchange): Promise<{ history: History; date: string; rev?: number } | undefined>
  put(ex: Exchange, history: History, date: string, rev?: number): Promise<void>
}

export class MarketUnavailable extends Error {}

export const realNet: Net = {
  async json<T>(url: string) {
    const r = await fetch(url)
    if (r.status === 404) throw new MarketUnavailable('The shared market data has not been published yet.')
    if (!r.ok) throw new MarketUnavailable(`The market data service answered HTTP ${r.status}.`)
    return (await r.json()) as T
  },
  async gz<T>(url: string, onBytes?: (loaded: number, total: number) => void) {
    const r = await fetch(url)
    if (!r.ok || !r.body) throw new MarketUnavailable(`A market data file could not be downloaded (HTTP ${r.status}).`)
    const total = Number(r.headers.get('content-length')) || 0
    let loaded = 0
    // Files are gzipped bytes served as opaque data, so they are inflated here. Progress counts compressed bytes.
    const counter = new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, c) { loaded += chunk.length; onBytes?.(loaded, total); c.enqueue(chunk) } })
    return (await new Response(r.body.pipeThrough(counter).pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).json()) as T
  },
}

export const fetchManifest = (net: Net = realNet) => net.json<Manifest>('/api/data/manifest')

export type SyncKind = 'snapshot' | 'deltas' | 'none'

/**
 * Bring one exchange up to the manifest's latest day: reuse the cache if it is current, apply the small daily files if the
 * cache is only a few days behind, and otherwise download the snapshot again. Null if the exchange is not published.
 */
export async function syncExchange(
  ex: Exchange, m: Manifest, cache: MarketCache, net: Net, onBytes?: (loaded: number, total: number) => void,
): Promise<{ history: History; date: string; kind: SyncKind } | null> {
  const snap = m.snapshots[ex]
  if (!snap || !m.latestDate) return null
  const cached = await cache.get(ex)
  const url = (file: string) => {
    const u = m.urls[file]
    if (!u) throw new MarketUnavailable(`The manifest has no address for ${file}.`)
    return u
  }
  const days = (after: string) => [...new Set(m.deltas.filter(d => d.ex === ex && d.date > after).map(d => d.date))].sort()
  const applyDeltas = async (h: History, after: string) => {
    for (const date of days(after)) {
      const rows: DayRow[] = []
      for (const d of m.deltas) if (d.ex === ex && d.date === date) rows.push(...(await net.gz<DayRow[]>(url(d.file))))
      applyDay(h, date, rows)
    }
  }

  // A snapshot rewritten with the same date (new metadata) has a higher rev: a cache built from an older rev must not be reused.
  const current = !!cached && (cached.rev ?? 0) >= (snap.rev ?? 0)
  if (cached && current && cached.date === m.latestDate) return { history: cached.history, date: cached.date, kind: 'none' }
  // Deltas continue from the snapshot, so a cache at or after the snapshot date can be brought forward with them alone.
  if (cached && current && cached.date >= snap.date) {
    const h = cached.history
    await applyDeltas(h, cached.date)
    const date = h.dates[h.dates.length - 1] ?? cached.date
    await cache.put(ex, h, date, snap.rev ?? 0)
    return { history: h, date, kind: 'deltas' }
  }
  const h = await net.gz<History>(url(snap.file), onBytes)
  await applyDeltas(h, snap.date)
  const date = h.dates[h.dates.length - 1] ?? snap.date
  await cache.put(ex, h, date, snap.rev ?? 0)
  return { history: h, date, kind: 'snapshot' }
}

export async function fetchIndexBars(m: Manifest, net: Net = realNet): Promise<{ id: string; name: string; candles: Candle[] }[]> {
  if (!m.indices) return []
  const f = await net.gz<IndexFile>(m.urls[m.indices.file])
  return f.items.map(i => ({
    id: i.id, name: i.name,
    candles: i.bars.map(([d, o, h, l, c]) => ({ t: sessionOpen(d), o, h, l, c, v: 0, closed: true })),
  }))
}

/** Whole-market breadth, 52-week highs and lows, and top movers for the latest session. Null when not published yet. */
export async function fetchPulse(m: Manifest, net: Net = realNet): Promise<Pulse | null> {
  const f = m.pulse?.file
  return f && m.urls[f] ? net.gz<Pulse>(m.urls[f]) : null
}

export type SearchItem = [id: string, symbol: string, name: string, isin: string, sector: string]
export interface SearchIndex { date: string; items: SearchItem[] }

/** The list of every market stock (a few tens of KB). Null when the backend has not published one. */
export async function fetchSearchIndex(m: Manifest, net: Net = realNet): Promise<SearchIndex | null> {
  const f = m.search?.file
  return f && m.urls[f] ? net.gz<SearchIndex>(m.urls[f]) : null
}

/** One stock's bars as the app's candle set. Prices come back from integer paise to rupees; non-trading days are skipped. */
export function toCandleSet(h: History, id: string, names?: Map<string, string>): CandleSet | null {
  const s = h.stocks[id]
  if (!s) return null
  const candles: Candle[] = []
  for (let i = 0; i < h.dates.length; i++) {
    if (s.c[i] > 0) candles.push({ t: sessionOpen(h.dates[i]), o: s.o[i] / 100, h: s.h[i] / 100, l: s.l[i] / 100, c: s.c[i] / 100, v: s.v[i], closed: true })
  }
  if (!candles.length) return null
  const inst: Instrument = { id, exchange: s.ex, symbol: s.sym, name: s.name ?? names?.get(s.sym) ?? s.sym, sector: s.sector ?? UNCLASSIFIED, kind: 'equity' }
  return { instrument: inst, timeframe: '1D', candles, source: 'market', asOf: candles[candles.length - 1].t }
}

/** The broad index each exchange's stocks are measured against for relative strength. */
/** The free industry list covers only about a third of liquid stocks; the rest are shown as this. */
export const UNCLASSIFIED = 'Unclassified'

export const BENCHMARK_FOR: Record<Exchange, string> = { NSE: 'NSE:NIFTY500', BSE: 'BSE:BSE500' }
