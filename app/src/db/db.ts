import Dexie, { type Table } from 'dexie'
import { scannerSchema, type ScannerConfig, type ScanRun } from '../domain/scanner'
import type { Candle, DataSource } from '../domain/types'
import type { FyersCredentials, FyersSession } from '../providers/fyers/types'
import type { BreezeSession } from '../providers/breeze/session'
import type { CandleCache } from '../providers/loader'
import type { Exchange, History } from '../../api/_lib/data/history'
import type { MarketCache } from '../market/client'

export type ShortlistStatus = 'watching' | 'researching' | 'ready' | 'rejected'
export const STATUSES: { key: ShortlistStatus; label: string }[] = [
  { key: 'watching', label: 'Watching' },
  { key: 'researching', label: 'Researching' },
  { key: 'ready', label: 'Ready to plan' },
  { key: 'rejected', label: 'Rejected' },
]

export interface ShortlistItem {
  instrumentId: string
  status: ShortlistStatus
  note: string
  addedAt: number
  /** Where it came from, e.g. the scanner name. */
  source: string
}

export interface Settings {
  capital: number
  riskPct: number
  maxPositionPct: number
  roundTripCostPct: number
  rr1: number
  rr2: number
}

export const DEFAULT_SETTINGS: Settings = { capital: 500000, riskPct: 1, maxPositionPct: 25, roundTripCostPct: 0.3, rr1: 2, rr2: 3 }

/** Secrets live here, in their own table, and are never read by export. */
export interface StoredCredentials extends FyersCredentials { session?: FyersSession }
/** Breeze needs no secret: the app key identifies the app and the daily session proves the login. */
export interface StoredBreeze { appKey: string; session?: BreezeSession }

class AppDB extends Dexie {
  candles!: Table<{ id: string; candles: Candle[]; fetchedAt: number }, string>
  credentials!: Table<{ key: string } & Record<string, unknown>, string>
  market!: Table<{ ex: string; history: History; date: string; rev?: number }, string>
  scanners!: Table<ScannerConfig, string>
  shortlist!: Table<ShortlistItem, string>
  settings!: Table<{ key: string; value: unknown }, string>
  scanRuns!: Table<ScanRun & { id: string }, string>

  constructor() {
    super('stock-analyzer')
    this.version(1).stores({
      scanners: 'id, name',
      shortlist: 'instrumentId, status, addedAt',
      settings: 'key',
      // One cached run per scanner (id = scannerId) so results are available offline.
      scanRuns: 'id, ranAt',
    })
    // v2: market-data cache and provider credentials (additive; v1 data is untouched).
    this.version(2).stores({ candles: 'id, fetchedAt', credentials: 'key' })
    // v3: market-wide history downloaded from the shared backend, one row per exchange (additive).
    this.version(3).stores({ market: 'ex' })
  }
}

export const db = new AppDB()

/** Candles are cached per provider: FYERS and Breeze adjust and stamp bars differently, so they must never mix. */
export const cacheFor = (source: DataSource): CandleCache => ({
  get: async id => db.candles.get(`${source}:${id}`),
  put: async (id, candles, fetchedAt) => { await db.candles.put({ id: `${source}:${id}`, candles, fetchedAt }) },
})

/** Not part of export/import: it is public market data that can be re-downloaded. */
export const marketCache: MarketCache = {
  get: async (ex: Exchange) => { const r = await db.market.get(ex); return r ? { history: r.history, date: r.date, rev: r.rev } : undefined },
  put: async (ex, history, date, rev) => {
    await db.market.put({ ex, history, date, rev })
    // A small summary for Settings, so it does not have to read megabytes to say what is on the device.
    await db.settings.put({ key: `marketMeta:${ex}`, value: { date, rev: rev ?? 0, stocks: Object.keys(history.stocks).length, at: Date.now() } })
  },
}

export interface MarketMeta { date: string; rev: number; stocks: number; at: number }
export async function loadMarketMeta(): Promise<Partial<Record<Exchange, MarketMeta>>> {
  const out: Partial<Record<Exchange, MarketMeta>> = {}
  for (const ex of ['NSE', 'BSE'] as const) {
    const r = await db.settings.get(`marketMeta:${ex}`)
    if (r) out[ex] = r.value as MarketMeta
  }
  return out
}
export async function clearMarketCache() {
  await db.market.clear()
  await db.settings.bulkDelete(['marketMeta:NSE', 'marketMeta:BSE'])
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const row = await db.credentials.get('fyers')
  if (!row) return null
  const { key: _key, ...rest } = row
  return rest as unknown as StoredCredentials
}
export const saveCredentials = (c: StoredCredentials) => db.credentials.put({ key: 'fyers', ...c })

export async function loadBreeze(): Promise<StoredBreeze | null> {
  const row = await db.credentials.get('breeze')
  if (!row) return null
  const { key: _key, ...rest } = row
  return rest as unknown as StoredBreeze
}
export const saveBreeze = (c: StoredBreeze) => db.credentials.put({ key: 'breeze', ...c })
export const clearSession = async () => {
  const c = await loadCredentials()
  if (c) await saveCredentials({ appId: c.appId, secret: c.secret })
}

export async function loadDataSource(): Promise<DataSource> {
  const v = (await db.settings.get('dataSource'))?.value
  return v === 'fyers' || v === 'breeze' ? v : 'demo'
}
export const saveDataSource = (v: DataSource) => db.settings.put({ key: 'dataSource', value: v })

export async function loadSettings(): Promise<Settings> {
  const row = await db.settings.get('settings')
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) }
}
export const saveSettings = (s: Settings) => db.settings.put({ key: 'settings', value: s })

/** Export user data only. Credentials are never stored here, so nothing secret can leak. */
export async function exportData() {
  return {
    app: 'stock-analyzer', schema: 1, exportedAt: new Date().toISOString(),
    scanners: await db.scanners.toArray(),
    shortlist: await db.shortlist.toArray(),
    settings: await loadSettings(),
  }
}

export async function importData(raw: unknown): Promise<{ scanners: number; shortlist: number }> {
  const d = raw as { app?: string; scanners?: unknown[]; shortlist?: ShortlistItem[]; settings?: Settings }
  if (d?.app !== 'stock-analyzer') throw new Error('Not a Stock Analyzer export')
  const scanners = (d.scanners ?? []).map(s => scannerSchema.parse(s) as ScannerConfig)
  await db.transaction('rw', db.scanners, db.shortlist, db.settings, async () => {
    await db.scanners.bulkPut(scanners)
    await db.shortlist.bulkPut(d.shortlist ?? [])
    if (d.settings) await saveSettings({ ...DEFAULT_SETTINGS, ...d.settings })
  })
  return { scanners: scanners.length, shortlist: d.shortlist?.length ?? 0 }
}
