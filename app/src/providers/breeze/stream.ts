import { io, type Socket } from 'socket.io-client'
import type { Instrument } from '../../domain/types'
import type { Quote } from '../types'
import type { BreezeSession } from './session'
import { BREEZE_BENCHMARK, lookupCode } from './codes'

export const LIVESTREAM_URL = 'https://livestream.icicidirect.com'

/** NSE equity quote feed: exchange prefix `4.` + type `1!` + numeric token, per the official SDK. */
export const streamToken = (token: string) => `4.1!${token}`

export const tokenFor = (i: Instrument): string | null =>
  i.kind === 'index' ? BREEZE_BENCHMARK.token : lookupCode(i.symbol)?.token ?? null

const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * NSE quote tick (21 fields), from the SDK's parse_data:
 * [0]=`4.1!token` [1]=open [2]=last [3]=high [4]=low [10]=ltq [12]=total traded qty [19]=ltt (epoch s) [20]=prev close.
 */
export function parseTick(data: unknown, byToken: Map<string, Instrument>, now: number): Quote | null {
  if (!Array.isArray(data) || data.length < 21 || typeof data[0] !== 'string') return null
  const [, tok] = data[0].split('!')
  const inst = tok ? byToken.get(tok) : undefined
  const ltp = num(data[2])
  if (!inst || ltp === null || ltp <= 0) return null
  const ltt = num(data[19])
  return {
    instrumentId: inst.id, ltp, prevClose: num(data[20]) ?? ltp,
    open: num(data[1]) ?? undefined, high: num(data[3]) ?? undefined, low: num(data[4]) ?? undefined, volume: num(data[12]) ?? undefined,
    at: ltt && ltt > 1e9 ? ltt * 1000 : now, source: 'breeze',
  }
}

export interface IndexTick {
  id: string
  ltp: number
  /** Null when the tick did not carry a previous close, so no change is shown rather than a made-up one. */
  prevClose: number | null
  at: number
}

/**
 * Index ticks use the same `4.1!<token>` channel with the index's string token (e.g. `4.1!NIFTY 50`). The field layout for
 * indices is not documented, so only last price is trusted; previous close is read from the equity layout's slot when the
 * array is long enough. Unverified against a live index feed: the connection test reports whether any index tick arrived.
 */
export function parseIndexTick(data: unknown, byToken: Map<string, string>, now: number): IndexTick | null {
  if (!Array.isArray(data) || data.length < 3 || typeof data[0] !== 'string') return null
  const tok = data[0].slice(data[0].indexOf('!') + 1)
  const id = byToken.get(tok)
  const ltp = num(data[2])
  if (!id || ltp === null || ltp <= 0) return null
  const prev = data.length >= 21 ? num(data[20]) : null
  const ltt = data.length >= 21 ? num(data[19]) : null
  return { id, ltp, prevClose: prev && prev > 0 ? prev : null, at: ltt && ltt > 1e9 ? ltt * 1000 : now }
}

export type StreamState = 'idle' | 'connecting' | 'connected' | 'error'

type IoFactory = typeof io

/** Keeps the latest tick per instrument. The app polls `latest()` once a minute rather than re-rendering per tick. */
export class BreezeStream {
  private socket: Socket | null = null
  private ticks = new Map<string, Quote>()
  private byToken = new Map<string, Instrument>()
  private indexByToken = new Map<string, string>()
  private indexTicks = new Map<string, IndexTick>()
  state: StreamState = 'idle'
  message: string | null = null
  ticksReceived = 0
  indexTicksReceived = 0

  constructor(private session: BreezeSession, instruments: Instrument[], private ioFactory: IoFactory = io, private now: () => number = () => Date.now()) {
    for (const i of instruments) {
      const t = tokenFor(i)
      if (t) this.byToken.set(t, i)
    }
  }

  /** Also stream these indices. Call before `start()`. */
  watchIndices(list: readonly { id: string; token: string }[]) {
    for (const i of list) this.indexByToken.set(i.token, i.id)
  }

  /** Add a stock to the live feed, e.g. one opened from search. Joins at once if already connected. */
  add(i: Instrument) {
    const t = tokenFor(i)
    if (!t || this.byToken.has(t)) return
    this.byToken.set(t, i)
    if (this.state === 'connected') this.socket?.emit('join', [streamToken(t)])
  }

  start() {
    this.state = 'connecting'
    // A browser cannot set User-Agent, which the official client sends. If Breeze insists on it, this reports an error.
    this.socket = this.ioFactory(LIVESTREAM_URL, { transports: ['websocket'], auth: { user: this.session.userId, token: this.session.streamToken }, reconnection: true })
    const join = () => { this.socket?.emit('join', [...this.byToken.keys(), ...this.indexByToken.keys()].map(streamToken)) }
    this.socket.on('connect', () => { this.state = 'connected'; this.message = null; join() })
    this.socket.on('connect_error', e => { this.state = 'error'; this.message = `Breeze live feed refused the connection: ${e.message}` })
    this.socket.on('disconnect', reason => { this.state = 'error'; this.message = `Breeze live feed disconnected (${reason})` })
    this.socket.on('stock', (data: unknown) => {
      const batch = Array.isArray(data) && Array.isArray(data[0]) ? (data as unknown[]) : [data]
      for (const d of batch) {
        const now = this.now()
        const q = parseTick(d, this.byToken, now)
        if (q) { this.ticks.set(q.instrumentId, q); this.ticksReceived++; continue }
        const ix = parseIndexTick(d, this.indexByToken, now)
        if (ix) { this.indexTicks.set(ix.id, ix); this.indexTicksReceived++ }
      }
    })
  }

  latest(): Quote[] { return [...this.ticks.values()] }
  latestIndices(): IndexTick[] { return [...this.indexTicks.values()] }

  stop() {
    this.socket?.removeAllListeners()
    this.socket?.disconnect()
    this.socket = null
    this.state = 'idle'
  }
}
