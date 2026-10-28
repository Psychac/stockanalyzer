import { admissible, applyDay, emptyHistory, mergeHistories, prune, sliceOf, type DayRow, type History } from './history'
import { parseBse, parseNse, type Parsed } from './parse'
import { emptyManifest, type Manifest, type Store } from './store'

/**
 * Daily ingest. One routine serves both the nightly cron (one new day) and the first-time backfill (about a year of days):
 * it advances the stored history day by day from wherever it stopped, so an interrupted run simply continues next time.
 *
 * Write budget on Vercel Hobby (2,000 uploads a month): a few new days are written as small delta files; a long catch-up, or a
 * week of deltas, is folded into one new snapshot. So a normal month costs roughly 40 uploads.
 */
export interface Fetched { status: number; text: string }
export interface Deps {
  store: Store
  fetchText: (url: string) => Promise<Fetched>
  fetchJson: (url: string) => Promise<{ status: number; json: unknown }>
  now: () => number
}

export interface Options {
  /** Stop starting new days after this many ms (leave headroom under the function limit). */
  budgetMs?: number
  /** First session to fetch when starting from nothing. */
  startDate?: string
  maxDays?: number
}

export interface Result {
  applied: string[]
  skipped: string[]
  /** Why it stopped early, if it did. */
  stopped: string | null
  latestDate: string | null
  wrote: string[]
}

const DAY = 86_400_000
const IST = 5.5 * 3600_000
export const istDay = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
const isWeekend = (d: string) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6 }
const ddmmyyyy = (d: string) => `${d.slice(8, 10)}${d.slice(5, 7)}${d.slice(0, 4)}`

export const nseUrl = (d: string) => `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`
export const bseUrl = (d: string) => `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${d.replaceAll('-', '')}_F_0000.CSV`

export const INDICES = [
  { id: 'NSE:NIFTY50', name: 'Nifty 50', key: 'NSE_INDEX|Nifty 50' },
  { id: 'NSE:NIFTYBANK', name: 'Bank Nifty', key: 'NSE_INDEX|Nifty Bank' },
  { id: 'NSE:NIFTYIT', name: 'Nifty IT', key: 'NSE_INDEX|Nifty IT' },
  { id: 'NSE:NIFTYFIN', name: 'Fin Services', key: 'NSE_INDEX|Nifty Fin Service' },
  { id: 'NSE:NIFTYMID', name: 'Midcap Select', key: 'NSE_INDEX|NIFTY MID SELECT' },
  { id: 'NSE:NIFTY500', name: 'Nifty 500', key: 'NSE_INDEX|Nifty 500' },
  { id: 'NSE:INDIAVIX', name: 'India VIX', key: 'NSE_INDEX|India VIX' },
  { id: 'BSE:SENSEX', name: 'Sensex', key: 'BSE_INDEX|SENSEX' },
  { id: 'BSE:BSE500', name: 'BSE 500', key: 'BSE_INDEX|BSE500' },
  { id: 'BSE:BANKEX', name: 'Bankex', key: 'BSE_INDEX|BANKEX' },
] as const

export interface IndexFile { date: string; items: { id: string; name: string; bars: [string, number, number, number, number][] }[] }

type Outcome = { kind: 'rows'; rows: DayRow[] } | { kind: 'missing' } | { kind: 'error'; why: string }

async function fetchDay(deps: Deps, url: string, parse: (t: string) => Parsed | null, date: string): Promise<Outcome> {
  let r: Fetched
  try { r = await deps.fetchText(url) } catch (e) { return { kind: 'error', why: e instanceof Error ? e.message : String(e) } }
  if (r.status === 404) return { kind: 'missing' }
  if (r.status !== 200) return { kind: 'error', why: `HTTP ${r.status} for ${url}` }
  const p = parse(r.text)
  // BSE answers a date with no file (a holiday or weekend) with a 200 and an HTML page rather than a 404.
  if (!p) return /^\s*</.test(r.text) ? { kind: 'missing' } : { kind: 'error', why: `unexpected columns in ${url}` }
  // A file for another date (a redirect, or an exchange serving a stale file) must never be filed under this date.
  if (p.date !== date) return { kind: 'missing' }
  return { kind: 'rows', rows: p.rows }
}

/** Rebuild history from the latest snapshot plus deltas. */
async function load(store: Store, m: Manifest): Promise<History> {
  const parts: History[] = []
  for (const ex of ['NSE', 'BSE'] as const) {
    const ref = m.snapshots[ex]
    const p = ref ? await store.getJson<History>(ref.file) : null
    if (p) parts.push(p)
  }
  const out = parts.length ? mergeHistories(parts) : emptyHistory()
  const dates = [...new Set(m.deltas.map(d => d.date))].sort()
  for (const date of dates) {
    const rows: DayRow[] = []
    for (const d of m.deltas) if (d.date === date) rows.push(...((await store.getJson<DayRow[]>(d.file)) ?? []))
    applyDay(out, date, rows)
  }
  return out
}

async function fetchIndices(deps: Deps, date: string): Promise<IndexFile> {
  const from = addDays(date, -400)
  const items: IndexFile['items'] = []
  for (const ix of INDICES) {
    const url = `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(ix.key)}/days/1/${date}/${from}`
    try {
      const r = await deps.fetchJson(url)
      const candles = ((r.json as { data?: { candles?: unknown[][] } })?.data?.candles ?? []) as [string, number, number, number, number][]
      if (r.status !== 200 || !candles.length) continue
      items.push({ id: ix.id, name: ix.name, bars: candles.map(c => [String(c[0]).slice(0, 10), c[1], c[2], c[3], c[4]] as [string, number, number, number, number]).reverse() })
    } catch { /* one index failing must not block the stocks */ }
  }
  return { date, items }
}

export async function advance(deps: Deps, opts: Options = {}): Promise<Result> {
  const t0 = deps.now()
  const budget = opts.budgetMs ?? 200_000
  const today = istDay(t0)
  const m = (await deps.store.getManifest()) ?? emptyManifest()
  const h = await load(deps.store, m)
  const res: Result = { applied: [], skipped: [], stopped: null, latestDate: m.latestDate, wrote: [] }
  const newDays: { date: string; rows: DayRow[] }[] = []

  let d = m.latestDate ? addDays(m.latestDate, 1) : opts.startDate ?? addDays(today, -380)
  for (; d <= today; d = addDays(d, 1)) {
    if (isWeekend(d)) continue
    if (deps.now() - t0 > budget || newDays.length >= (opts.maxDays ?? 400)) { res.stopped = 'time budget reached; run again to continue'; break }
    const [nse, bse] = await Promise.all([fetchDay(deps, nseUrl(d), parseNse, d), fetchDay(deps, bseUrl(d), parseBse, d)])
    const err = nse.kind === 'error' ? nse : bse.kind === 'error' ? bse : null
    if (err && err.kind === 'error') { res.stopped = `${d}: ${err.why}`; break }
    const rows = [...(nse.kind === 'rows' ? nse.rows : []), ...(bse.kind === 'rows' ? bse.rows : [])]
    const recent = d >= addDays(today, -1)
    if (!rows.length) {
      // Both missing: a holiday if it is past, or simply not published yet if it is today.
      if (d === today) { res.stopped = 'today is not published yet'; break }
      res.skipped.push(d)
      continue
    }
    if ((nse.kind !== 'rows' || bse.kind !== 'rows') && recent) { res.stopped = `${d}: only one exchange has published so far`; break }
    const kept = admissible(h, rows)
    applyDay(h, d, kept)
    newDays.push({ date: d, rows: kept })
    res.applied.push(d)
    res.latestDate = d
  }

  if (!newDays.length) return res

  const urls = { ...m.urls }
  const next: Manifest = { ...m, latestDate: res.latestDate, updatedAt: new Date(deps.now()).toISOString(), urls }
  const stale: string[] = []
  const foldIntoSnapshot = !m.snapshots.NSE || newDays.length > 3 || new Set(m.deltas.map(x => x.date)).size + newDays.length > 7
  if (foldIntoSnapshot) {
    prune(h)
    next.snapshots = {}
    for (const ex of ['NSE', 'BSE'] as const) {
      const file = `snapshot-${ex}-${res.latestDate}.json.gz`
      urls[file] = await deps.store.putJson(file, sliceOf(h, ex))
      res.wrote.push(file)
      next.snapshots[ex] = { file, date: res.latestDate! }
    }
    for (const r of Object.values(m.snapshots)) if (r) stale.push(r.file)
    stale.push(...m.deltas.map(x => x.file))
    next.deltas = []
  } else {
    next.deltas = [...m.deltas]
    for (const day of newDays) {
      for (const ex of ['NSE', 'BSE'] as const) {
        const rows = day.rows.filter(r => r.ex === ex)
        if (!rows.length) continue
        const file = `delta-${ex}-${day.date}.json.gz`
        urls[file] = await deps.store.putJson(file, rows)
        res.wrote.push(file)
        next.deltas.push({ file, date: day.date, ex })
      }
    }
  }

  const ix = await fetchIndices(deps, res.latestDate!)
  if (ix.items.length) {
    const file = `indices-${ix.date}.json.gz`
    urls[file] = await deps.store.putJson(file, ix)
    if (m.indices && m.indices.file !== file) stale.push(m.indices.file)
    res.wrote.push(file)
    next.indices = { file, date: ix.date }
  }

  for (const f of stale) delete urls[f]
  // Publish the manifest last: clients only ever see a complete set of files. Old files go after, so a client that
  // fetched the previous manifest a moment ago can still finish downloading.
  await deps.store.putManifest(next)
  res.wrote.push('manifest.json')
  await deps.store.remove(stale)
  return res
}

export const realDeps = (store: Store): Deps => ({
  store,
  now: () => Date.now(),
  fetchText: async url => {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; stock-analyzer-ingest)', accept: '*/*' }, signal: AbortSignal.timeout(20_000) })
    return { status: r.status, text: r.status === 200 ? await r.text() : (await r.body?.cancel(), '') }
  },
  fetchJson: async url => {
    const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) })
    return { status: r.status, json: await r.json().catch(() => null) }
  },
})
