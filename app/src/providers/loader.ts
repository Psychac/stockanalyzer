import type { Candle, CandleSet, DataSource, Instrument } from '../domain/types'
import { lastSessionClose } from '../domain/time'
import { finalizeCandles, mergeCandles } from './candles'
import { ProviderError } from './errors'
import type { MarketDataProvider } from './types'

export interface CandleCache {
  get(id: string): Promise<{ candles: Candle[]; fetchedAt: number } | undefined>
  put(id: string, candles: Candle[], fetchedAt: number): Promise<void>
}

export interface LoadOptions {
  /** Labels the resulting candle sets. */
  source: DataSource
  /** Null means read-only: serve whatever is cached and make no network calls. */
  provider: MarketDataProvider | null
  instruments: Instrument[]
  benchmark: Instrument
  bars: number
  now: number
  cache: CandleCache
  onProgress?: (done: number, total: number) => void
}

export interface LoadResult {
  sets: Map<string, CandleSet>
  benchmark: CandleSet | null
  /** Some instruments are served from cache because their refresh failed or was not attempted. */
  stale: boolean
  /** The token was rejected; no further calls were made. */
  authExpired: boolean
  warnings: string[]
}

const DAY = 86_400_000

/**
 * Cache-first load. A cached series is reused outright if it was fetched after the latest session closed;
 * otherwise only the gap is requested. This keeps routine startups to zero API calls.
 */
export async function loadMarket(o: LoadOptions): Promise<LoadResult> {
  const needFetchedAfter = lastSessionClose(o.now)
  const all = [...o.instruments, o.benchmark]
  const sets = new Map<string, CandleSet>()
  const warnings: string[] = []
  let provider = o.provider
  let stale = false
  let authExpired = false
  let done = 0

  for (const inst of all) {
    const cached = await o.cache.get(inst.id)
    let candles = cached?.candles ?? []
    const upToDate = !!cached && cached.fetchedAt >= needFetchedAfter
    if (!upToDate && provider) {
      try {
        const fresh = candles.length && provider.getCandlesSince
          ? mergeCandles(candles, await provider.getCandlesSince(inst, '1D', candles[candles.length - 1].t - 5 * DAY))
          : (await provider.getHistoricalCandles(inst, '1D', o.bars)).candles
        candles = fresh.slice(-o.bars)
        await o.cache.put(inst.id, candles, o.now)
      } catch (e) {
        stale = true
        if (e instanceof ProviderError && (e.kind === 'auth' || e.kind === 'rate')) {
          // Retrying only digs the hole deeper: an expired token fails every call, and a rate block gets worse.
          authExpired = e.kind === 'auth'
          warnings.push(e.message)
          provider = null
        } else {
          warnings.push(`${inst.symbol}: ${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } else if (!upToDate) {
      stale = true
    }
    if (candles.length >= 2) {
      const finalized = finalizeCandles(candles, o.now)
      sets.set(inst.id, { instrument: inst, timeframe: '1D', candles: finalized, source: o.source, asOf: finalized[finalized.length - 1].t })
    }
    o.onProgress?.(++done, all.length)
  }

  const benchmark = sets.get(o.benchmark.id) ?? null
  sets.delete(o.benchmark.id)
  const missing = o.instruments.length - sets.size
  if (missing > 0) warnings.push(`${missing} of ${o.instruments.length} stocks have no data`)
  return { sets, benchmark, stale, authExpired, warnings }
}
