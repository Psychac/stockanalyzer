import { ProviderError as FyersError } from '../errors'
import { RateLimiter } from '../rateLimiter'
import { FYERS_API } from './types'

export { FyersError, RateLimiter }

/** Documented FYERS codes for an expired or invalid token. */
const AUTH_CODES = new Set([-8, -15, -16, -17])

export function toFyersError(body: { s?: string; code?: number; message?: string } | null, status: number): FyersError {
  const code = typeof body?.code === 'number' ? body.code : null
  const message = body?.message || `FYERS request failed (HTTP ${status})`
  if (status === 429 || code === -429) return new FyersError('FYERS rate limit hit. Wait a minute before refreshing again.', 'rate', code)
  if ((code !== null && AUTH_CODES.has(code)) || status === 401) return new FyersError('Session expired or invalid. Reconnect FYERS in Settings.', 'auth', code)
  return new FyersError(message, 'api', code)
}

const sharedLimiter = new RateLimiter()

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export class FyersClient {
  constructor(
    private auth: () => { appId: string; accessToken: string },
    private limiter: RateLimiter = sharedLimiter,
    private fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  async get<T extends { s?: string }>(path: string, params: Record<string, string>): Promise<T> {
    await this.limiter.take()
    const { appId, accessToken } = this.auth()
    let res: Response
    try {
      res = await this.fetchFn(`${FYERS_API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `${appId}:${accessToken}` } })
    } catch {
      throw new FyersError('Could not reach FYERS. Check your connection.', 'network')
    }
    const body = (await res.json().catch(() => null)) as (T & { code?: number; message?: string }) | null
    if (!res.ok || body === null || body.s === 'error') throw toFyersError(body, res.status)
    return body
  }
}
