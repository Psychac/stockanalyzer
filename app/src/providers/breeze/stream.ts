import { io, type Socket } from 'socket.io-client'
import type { Instrument } from '../../domain/types'
import type { Quote } from '../types'
import type { BreezeSession } from './session'
import { BREEZE_BENCHMARK, BREEZE_CODES } from './codes'

export const LIVESTREAM_URL = 'https://livestream.icicidirect.com'

/** NSE equity quote feed: exchange prefix `4.` + type `1!` + numeric token, per the official SDK. */
export const streamToken = (token: string) => `4.1!${token}`

export const tokenFor = (i: Instrument): string | null =>
  i.kind === 'index' ? BREEZE_BENCHMARK.token : BREEZE_CODES[i.symbol]?.token ?? null

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

export type StreamState = 'idle' | 'connecting' | 'connected' | 'error'

type IoFactory = typeof io

/** Keeps the latest tick per instrument. The app polls `latest()` once a minute rather than re-rendering per tick. */
export class BreezeStream {
  private socket: Socket | null = null
  private ticks = new Map<string, Quote>()
  private byToken = new Map<string, Instrument>()
  state: StreamState = 'idle'
  message: string | null = null
  ticksReceived = 0

  constructor(private session: BreezeSession, instruments: Instrument[], private ioFactory: IoFactory = io, private now: () => number = () => Date.now()) {
    for (const i of instruments) {
      const t = tokenFor(i)
      if (t) this.byToken.set(t, i)
    }
  }

  start() {
    this.state = 'connecting'
    // A browser cannot set User-Agent, which the official client sends. If Breeze insists on it, this reports an error.
    this.socket = this.ioFactory(LIVESTREAM_URL, { transports: ['websocket'], auth: { user: this.session.userId, token: this.session.streamToken }, reconnection: true })
    const join = () => { this.socket?.emit('join', [...this.byToken.keys()].map(streamToken)) }
    this.socket.on('connect', () => { this.state = 'connected'; this.message = null; join() })
    this.socket.on('connect_error', e => { this.state = 'error'; this.message = `Breeze live feed refused the connection: ${e.message}` })
    this.socket.on('disconnect', reason => { this.state = 'error'; this.message = `Breeze live feed disconnected (${reason})` })
    this.socket.on('stock', (data: unknown) => {
      const batch = Array.isArray(data) && Array.isArray(data[0]) ? (data as unknown[]) : [data]
      for (const d of batch) {
        const q = parseTick(d, this.byToken, this.now())
        if (q) { this.ticks.set(q.instrumentId, q); this.ticksReceived++ }
      }
    })
  }

  latest(): Quote[] { return [...this.ticks.values()] }

  stop() {
    this.socket?.removeAllListeners()
    this.socket?.disconnect()
    this.socket = null
    this.state = 'idle'
  }
}
