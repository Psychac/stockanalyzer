import { splitCsv } from './parse.js'
import type { DayRow, History } from './history.js'

/**
 * Company metadata that the exchange price files do not carry: NSE ISIN codes and full names (from Upstox's public instrument
 * master) and an industry per ISIN (from the Nifty Total Market list, about 750 companies). BSE files already carry ISIN and name.
 * ISIN is what links an NSE listing to its BSE twin, and the only free industry list covers roughly a third of liquid stocks.
 */
export interface Meta {
  date: string
  /** NSE symbol -> [ISIN, company name] */
  nse: Record<string, [string, string]>
  /** ISIN -> industry */
  sector: Record<string, string>
}

export const UPSTOX_NSE_MASTER = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz'
export const INDUSTRY_LISTS = ['https://www.niftyindices.com/IndexConstituent/ind_niftytotalmarket_list.csv']

/** Equity rows only: the NSE_EQ segment also holds bonds, G-secs and ETFs. EQ wins over BE if a symbol is in both. */
export function parseUpstoxNse(rows: unknown): Meta['nse'] {
  const out: Meta['nse'] = {}
  if (!Array.isArray(rows)) return out
  const rank: Record<string, number> = {}
  for (const r of rows as { segment?: string; instrument_type?: string; trading_symbol?: string; isin?: string; name?: string }[]) {
    if (r?.segment !== 'NSE_EQ' || (r.instrument_type !== 'EQ' && r.instrument_type !== 'BE') || !r.trading_symbol || !r.isin) continue
    const rk = r.instrument_type === 'EQ' ? 2 : 1
    if ((rank[r.trading_symbol] ?? 0) >= rk) continue
    rank[r.trading_symbol] = rk
    out[r.trading_symbol] = [r.isin, r.name ?? r.trading_symbol]
  }
  return out
}

/** ISIN -> industry from a Nifty index constituent CSV. Null when the columns are not the expected ones. */
export function parseIndustryCsv(csv: string): Meta['sector'] | null {
  const lines = csv.split(/\r?\n/).filter(l => l.trim())
  const head = splitCsv(lines[0] ?? '')
  const iIsin = head.indexOf('ISIN Code')
  const iInd = head.indexOf('Industry')
  if (iIsin < 0 || iInd < 0) return null
  const out: Meta['sector'] = {}
  for (const l of lines.slice(1)) {
    const c = splitCsv(l)
    if (c[iIsin] && c[iInd]) out[c[iIsin]] = c[iInd]
  }
  return out
}

/** Fill in ISIN, company name and industry on a day's row. Never overwrites what the exchange file already gave. */
export function enrichRow(r: DayRow, meta: Meta | null): DayRow {
  if (!meta) return r
  let isin = r.isin
  let name = r.name
  if (r.ex === 'NSE') {
    const m = meta.nse[r.sym]
    if (m) { isin ??= m[0]; name ??= m[1] }
  }
  const sector = isin ? meta.sector[isin] : undefined
  return isin === r.isin && name === r.name && sector === r.sector ? r : { ...r, isin, name, ...(sector ? { sector } : {}) }
}

/** Apply metadata to stocks already in history. Returns how many changed. */
export function enrichHistory(h: History, meta: Meta): number {
  let n = 0
  for (const s of Object.values(h.stocks)) {
    const before = `${s.isin}|${s.name}|${s.sector}`
    if (s.ex === 'NSE') {
      const m = meta.nse[s.sym]
      if (m) { s.isin ??= m[0]; s.name ??= m[1] }
    }
    const sec = s.isin ? meta.sector[s.isin] : undefined
    if (sec) s.sector = sec
    if (`${s.isin}|${s.name}|${s.sector}` !== before) n++
  }
  return n
}

export type SearchItem = [id: string, symbol: string, name: string, isin: string, sector: string]
export interface SearchIndex { date: string; items: SearchItem[] }

/** Tiny list of every stock in the history, so a device can search without downloading any price data. */
export function buildSearchIndex(h: History): SearchIndex {
  const items = Object.values(h.stocks).map((s): SearchItem => [s.id, s.sym, s.name ?? '', s.isin ?? '', s.sector ?? ''])
  items.sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))
  return { date: h.dates[h.dates.length - 1] ?? '', items }
}
