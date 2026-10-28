/** Chart timeframes. Scanners and the live-price providers still work on daily bars (`1D`) only. */
export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '1D' | '1W' | '1M'

export type Exchange = 'NSE' | 'BSE'

/** Stable internal ID, e.g. "NSE:RELIANCE". NSE and BSE listings are distinct instruments. */
export interface Instrument {
  id: string
  exchange: Exchange
  symbol: string
  name: string
  sector: string
  kind: 'equity' | 'index'
}

/** `market` is end-of-day data from the shared backend (NSE and BSE bhavcopy). */
export type DataSource = 'demo' | 'fyers' | 'breeze' | 'market'

export interface Candle {
  /** Start of bar, UTC epoch milliseconds. */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
  /** Closed candles only feed final signals. */
  closed: boolean
}

export interface CandleSet {
  instrument: Instrument
  timeframe: Timeframe
  candles: Candle[]
  source: DataSource
  /** When the data was last refreshed (epoch ms). */
  asOf: number
}

export type Series = (number | null)[]
