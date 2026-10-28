import type { Instrument } from '../../domain/types'
import { registerExtra } from './codes'

/** One NSE cash-equity row from ICICI's instrument master: NSE symbol, Breeze stock_code, stream token, company name. */
export interface MasterRow { symbol: string; code: string; token: string; name: string }

let loading: Promise<MasterRow[]> | null = null

/**
 * The whole NSE equity list (about 3,000 stocks, ~170 KB). It is a separate chunk, fetched only when the user first
 * searches on Breeze. The source is `SecurityMaster.zip`, which sends no CORS header, so it is a build-time snapshot.
 */
export function loadMaster(): Promise<MasterRow[]> {
  loading ??= import('./master.json').then(m =>
    (m.default as unknown as [string, string, string, string][]).map(([symbol, code, token, name]) => ({ symbol, code, token, name })),
  )
  return loading
}

export const instrumentFromRow = (r: MasterRow): Instrument => ({
  id: `NSE:${r.symbol}`, exchange: 'NSE', symbol: r.symbol, name: r.name, sector: 'Other', kind: 'equity',
})

/** Make any NSE stock from the master usable by the Breeze provider and stream. */
export function adoptRow(r: MasterRow): Instrument {
  registerExtra(r.symbol, { code: r.code, token: r.token })
  return instrumentFromRow(r)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Best matches first: exact symbol, symbol prefix, a word of the name starting with the query, then substrings.
 * Short queries only match symbol prefixes, so typing "t" does not return half the market.
 */
export function rankMatches<T>(items: T[], query: string, symbolOf: (t: T) => string, nameOf: (t: T) => string, limit = 8): T[] {
  const q = norm(query)
  if (!q) return []
  const scored: { item: T; score: number }[] = []
  for (const item of items) {
    const sym = symbolOf(item).toLowerCase()
    const name = norm(nameOf(item))
    let score = 0
    if (sym === q) score = 100
    else if (sym.startsWith(q)) score = 80 - Math.min(sym.length - q.length, 20)
    else if (q.length >= 2 && name.split(' ').some(w => w.startsWith(q))) score = 60
    else if (q.length >= 3 && sym.includes(q)) score = 40
    else if (q.length >= 3 && name.includes(q)) score = 30
    if (score) scored.push({ item, score })
  }
  return scored.sort((a, b) => b.score - a.score || symbolOf(a.item).length - symbolOf(b.item).length).slice(0, limit).map(s => s.item)
}
