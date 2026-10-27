import type { Candle, CandleSet, DataSource, Instrument, Timeframe } from '../domain/types'

export type ConnectionStatus =
  | { state: 'demo'; note: string }
  | { state: 'disconnected'; note: string }
  | { state: 'connected'; since: number }
  | { state: 'error'; message: string }

export interface Quote {
  instrumentId: string
  ltp: number
  prevClose: number
  /** Today's session so far, when the provider supplies it. */
  open?: number
  high?: number
  low?: number
  volume?: number
  /** Epoch ms of the last tick or bar this price came from. */
  at: number
  source: DataSource
}

/**
 * Provider-independent market-data contract (spec §5.3).
 * The MVP is pull-based: history plus polled quotes. Streaming subscriptions come later.
 */
export interface MarketDataProvider {
  readonly id: DataSource
  readonly label: string
  /** True only for real market data. Demo data must never claim this. */
  readonly isLive: boolean
  connect(): Promise<void>
  disconnect(): Promise<void>
  getConnectionStatus(): ConnectionStatus
  getInstruments(): Promise<Instrument[]>
  getHistoricalCandles(instrument: Instrument, interval: Timeframe, bars: number): Promise<CandleSet>
  /** Candles from `sinceMs` onwards. Lets callers extend a cache instead of refetching everything. */
  getCandlesSince?(instrument: Instrument, interval: Timeframe, sinceMs: number): Promise<Candle[]>
  getQuotes(instruments: Instrument[]): Promise<Quote[]>
}

export type { Candle }
