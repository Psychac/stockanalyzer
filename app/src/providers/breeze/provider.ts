import type { Candle, CandleSet, Instrument, Timeframe } from '../../domain/types'
import { istDate } from '../../domain/time'
import { UNIVERSE } from '../universe'
import { ProviderError } from '../errors'
import type { ConnectionStatus, MarketDataProvider, Quote } from '../types'
import { mergeCandles } from '../candles'
import type { BreezeClient } from './client'
import { parseBreezeCandles } from './candles'
import { BREEZE_BENCHMARK, BREEZE_INDICES, lookupCode } from './codes'
import { BreezeStream } from './stream'
import type { BreezeSession } from './session'

const DAY = 86_400_000
/** Keep each request to a year so it stays well inside any row cap. */
const MAX_SPAN_DAYS = 365

export const codeFor = (i: Instrument): string | null => (i.kind === 'index' ? BREEZE_BENCHMARK.code : lookupCode(i.symbol)?.code ?? null)

export class BreezeProvider implements MarketDataProvider {
  readonly id = 'breeze' as const
  readonly label = 'ICICI Breeze'
  readonly isLive = true
  private status: ConnectionStatus = { state: 'disconnected', note: 'Not connected' }
  stream: BreezeStream | null = null

  constructor(private client: BreezeClient, private session: BreezeSession, private now: () => number = () => Date.now()) {}

  /**
   * One real history call proves the session works. Breeze reports every bad session as a generic server error,
   * so a failure here is treated as an auth problem; otherwise every symbol in a load would fail the same opaque way.
   */
  async connect() {
    try {
      await this.fetchRange(UNIVERSE[0], this.now() - 10 * DAY, this.now())
      this.status = { state: 'connected', since: this.now() }
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'api') {
        e = new ProviderError('Breeze rejected the request. The session has probably expired or the app key is wrong. Log in again.', 'auth', e.code)
      }
      this.status = { state: 'error', message: e instanceof Error ? e.message : String(e) }
      throw e
    }
  }

  async disconnect() { this.stopStream(); this.status = { state: 'disconnected', note: 'Disconnected' } }
  getConnectionStatus() { return this.status }
  async getInstruments() { return UNIVERSE.filter(i => codeFor(i)) }

  private async fetchRange(instrument: Instrument, fromMs: number, toMs: number): Promise<Candle[]> {
    const code = codeFor(instrument)
    if (!code) throw new ProviderError(`No Breeze code for ${instrument.symbol}.`, 'api')
    return this.fetchCode(code, fromMs, toMs)
  }

  /** Daily bars for an NSE index by its Breeze stock_code (e.g. CNXBAN). */
  getIndexCandles(code: string, sinceMs: number): Promise<Candle[]> {
    return this.fetchCode(code, sinceMs, this.now())
  }

  private async fetchCode(code: string, fromMs: number, toMs: number): Promise<Candle[]> {
    const rows = await this.client.history({
      interval: '1day', stock_code: code, exch_code: 'NSE', product_type: 'cash',
      from_date: `${istDate(fromMs)}T00:00:00.000Z`, to_date: `${istDate(toMs)}T23:59:59.000Z`,
    })
    return parseBreezeCandles(rows, this.now())
  }

  async getCandlesSince(instrument: Instrument, interval: Timeframe, sinceMs: number): Promise<Candle[]> {
    if (interval !== '1D') throw new ProviderError('Only daily candles are supported so far.', 'api')
    const now = this.now()
    const out: Candle[] = []
    let from = sinceMs
    while (from <= now) {
      const to = Math.min(now, from + MAX_SPAN_DAYS * DAY)
      out.push(...(await this.fetchRange(instrument, from, to)))
      from = to + DAY
    }
    return mergeCandles([], out)
  }

  async getHistoricalCandles(instrument: Instrument, interval: Timeframe, bars: number): Promise<CandleSet> {
    const now = this.now()
    const since = now - Math.ceil(bars * 1.4 + 10) * DAY
    const candles = (await this.getCandlesSince(instrument, interval, since)).slice(-bars)
    return { instrument, timeframe: interval, candles, source: 'breeze', asOf: candles[candles.length - 1]?.t ?? now }
  }

  startStream(instruments: Instrument[]) {
    this.stopStream()
    this.stream = new BreezeStream(this.session, instruments)
    this.stream.watchIndices(BREEZE_INDICES)
    this.stream.start()
  }

  /** Latest live index ticks, if the socket is delivering any. */
  liveIndices() { return this.stream?.latestIndices() ?? [] }

  /** Add a stock opened from search to the live feed. */
  watch(i: Instrument) { this.stream?.add(i) }

  stopStream() { this.stream?.stop(); this.stream = null }

  /** Whatever the live feed has delivered so far. Empty until the market is open and the socket is connected. */
  async getQuotes(_instruments: Instrument[]): Promise<Quote[]> { return this.stream?.latest() ?? [] }
}
