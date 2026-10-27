import { ProviderError } from '../errors'
import { RateLimiter } from '../rateLimiter'
import { HELPER, HELPER_MISSING, helperHeaders, relayRefusal, type BreezeSession } from './session'

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** Breeze allows 100 calls a minute and 5,000 a day; leave headroom on both. */
const limiter = new RateLimiter(4, 80)

export interface BreezeRow {
  datetime: string
  stock_code?: string
  open: string
  high: string
  low: string
  close: string
  volume: string
}

export class BreezeClient {
  constructor(
    private session: () => BreezeSession,
    private lim: RateLimiter = limiter,
    private fetchFn: FetchFn = (i, init) => fetch(i, init),
  ) {}

  /** Historical charts v2: query-string GET with header auth (no checksum, no secret key). */
  async history(params: Record<string, string>): Promise<BreezeRow[]> {
    await this.lim.take()
    const s = this.session()
    let res: Response
    try {
      res = await this.fetchFn(`${HELPER}/history?${new URLSearchParams(params)}`, {
        headers: { 'X-SessionToken': s.sessionToken, apikey: s.appKey, ...helperHeaders() },
      })
    } catch {
      throw new ProviderError('Could not reach the Breeze relay or Breeze.', 'network')
    }
    const body = (await res.json().catch(() => null)) as { Success?: BreezeRow[] | null; Status?: number; Error?: string | null; relayError?: string; message?: string } | null
    if (body === null) throw new ProviderError(HELPER_MISSING, 'api')
    const refused = relayRefusal(body, res.status)
    if (refused) throw refused
    if (res.status === 429) throw new ProviderError('Breeze rate limit hit. Wait a minute before refreshing again.', 'rate')
    if (res.status === 401 || body.Status === 401 || /invalid user|session/i.test(body.Error ?? '')) {
      throw new ProviderError('Breeze rejected the session. It has expired or is not valid. Log in again.', 'auth', 401)
    }
    if (!res.ok || (body.Status !== undefined && body.Status !== 200) || body.Error) {
      // Some failures still come back as a generic 500 ("Something went wrong"); connect() treats those as auth too.
      throw new ProviderError(body.Error ? `Breeze: ${body.Error}` : `Breeze request failed (HTTP ${res.status})`, 'api', body.Status ?? res.status)
    }
    return body.Success ?? []
  }
}
