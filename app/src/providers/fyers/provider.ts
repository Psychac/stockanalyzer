import type { Candle, CandleSet, Instrument, Timeframe } from '../../domain/types'
import { istDate } from '../../domain/time'
import { BENCHMARK } from '../universe'
import type { ConnectionStatus, MarketDataProvider, Quote } from '../types'
import { FyersError, type FyersClient } from './client'
import { mergeCandles, parseDailyCandles } from './candles'

const DAY = 86_400_000
/** FYERS allows up to 366 days per daily-history request; stay one under. */
const MAX_SPAN_DAYS = 365
const QUOTE_BATCH = 50

/** FYERS cash-equity symbol: NSE:RELIANCE-EQ. The only index we need is the Nifty 50 benchmark. */
export function toSymbol(i: Instrument): string {
  return i.kind === 'index' ? 'NSE:NIFTY50-INDEX' : `NSE:${i.symbol}-EQ`
}

interface HistoryBody { s?: string; candles?: unknown[] }
interface QuoteBody {
  s?: string
  d?: { n?: string; s?: string; v?: Record<string, unknown> }[]
}

const numOf = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined
}

export class FyersProvider implements MarketDataProvider {
  readonly id = 'fyers' as const
  readonly label = 'FYERS'
  readonly isLive = true
  private status: ConnectionStatus = { state: 'disconnected', note: 'Not connected' }

  constructor(private client: FyersClient, private now: () => number = () => Date.now()) {}

  /** Cheapest authenticated call: proves the token works before a long load starts. */
  async connect() {
    try {
      await this.client.get('/data/quotes', { symbols: toSymbol(BENCHMARK) })
      this.status = { state: 'connected', since: this.now() }
    } catch (e) {
      this.status = { state: 'error', message: e instanceof Error ? e.message : String(e) }
      throw e
    }
  }

  async disconnect() { this.status = { state: 'disconnected', note: 'Disconnected' } }
  getConnectionStatus() { return this.status }

  async getCandlesSince(instrument: Instrument, interval: Timeframe, sinceMs: number): Promise<Candle[]> {
    if (interval !== '1D') throw new FyersError('Only daily candles are supported so far.', 'api')
    const now = this.now()
    const out: Candle[] = []
    // Walk forward in windows the endpoint accepts, so a long gap costs a few calls, not an error.
    let from = sinceMs
    while (from <= now) {
      const to = Math.min(now, from + MAX_SPAN_DAYS * DAY)
      const body = await this.client.get<HistoryBody>('/data/history', {
        symbol: toSymbol(instrument), resolution: 'D', date_format: '1',
        range_from: istDate(from), range_to: istDate(to), cont_flag: '1',
      })
      out.push(...parseDailyCandles(body.candles, now))
      from = to + DAY
    }
    return mergeCandles([], out)
  }

  async getHistoricalCandles(instrument: Instrument, interval: Timeframe, bars: number): Promise<CandleSet> {
    const now = this.now()
    // ~5 trading days per 7 calendar days, plus slack for holidays.
    const since = now - Math.ceil(bars * 1.4 + 10) * DAY
    const candles = (await this.getCandlesSince(instrument, interval, since)).slice(-bars)
    return { instrument, timeframe: interval, candles, source: 'fyers', asOf: candles[candles.length - 1]?.t ?? now }
  }

  async getQuotes(instruments: Instrument[]): Promise<Quote[]> {
    const bySymbol = new Map(instruments.map(i => [toSymbol(i), i]))
    const symbols = [...bySymbol.keys()]
    const out: Quote[] = []
    for (let i = 0; i < symbols.length; i += QUOTE_BATCH) {
      const body = await this.client.get<QuoteBody>('/data/quotes', { symbols: symbols.slice(i, i + QUOTE_BATCH).join(',') })
      for (const row of body.d ?? []) {
        const inst = row.n ? bySymbol.get(row.n) : undefined
        const v = row.v
        const ltp = numOf(v?.lp)
        if (!inst || row.s !== 'ok' || !v || ltp === undefined || ltp <= 0) continue
        const tt = numOf(v.tt)
        out.push({
          instrumentId: inst.id, ltp, prevClose: numOf(v.prev_close_price) ?? ltp,
          open: numOf(v.open_price), high: numOf(v.high_price), low: numOf(v.low_price), volume: numOf(v.volume),
          at: tt ? tt * 1000 : this.now(), source: 'fyers',
        })
      }
    }
    return out
  }
}
