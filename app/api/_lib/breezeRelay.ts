import https from 'node:https'
import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Relay for ICICI Breeze, which a browser cannot call directly: its login is a GET with a JSON body and its data host
 * sends no CORS headers. The same code runs in the Vite dev/preview server and as Vercel functions (`api/breeze/*`),
 * so what is tested locally is what is deployed.
 *
 * It is stateless and holds no credentials: the caller's own app key and session token pass through to ICICI and are
 * never stored or logged. Because a deployed copy is a public URL, it is deliberately narrow: two fixed ICICI
 * endpoints, whitelisted parameters, same-origin callers only, and an optional shared access code.
 *
 * The underscore folder keeps Vercel from exposing this file as a route.
 */
const SESSION = { hostname: 'api.icicidirect.com', path: '/breezeapi/api/v1/customerdetails' }
const DATA = { hostname: 'breezeapi.icicidirect.com', path: '/api/v2/historicalcharts' }

/** Vercel's default function limit is 10 s; stay under it so errors come from us, not a platform timeout. */
const TIMEOUT_MS = 9000
const MAX_BODY = 4096
const MAX_RESPONSE = 5_000_000
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

const HISTORY_PARAMS = new Set(['interval', 'stock_code', 'exch_code', 'from_date', 'to_date', 'product_type', 'expiry_date', 'right', 'strike_price'])
const PARAM_VALUE = /^[A-Za-z0-9:.+\-_ ]{0,64}$/
/** App keys, session codes and the base64 session token. */
const CREDENTIAL = /^[A-Za-z0-9+/=_.\-]{1,512}$/

export interface RelayOptions {
  /** Shared secret callers must send as X-Relay-Code. Unset means no code is required. */
  accessCode?: string
  /** Dev servers only: also require a loopback Host header, which blocks DNS-rebinding attacks. */
  loopbackOnly?: boolean
  /** Injectable for tests. */
  request?: typeof https.request
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

/** Refusals from the relay itself carry `relayError`, which the app uses to tell them apart from ICICI's own errors. */
const refuse = (res: ServerResponse, status: number, relayError: 'origin' | 'code' | 'request' | 'method', message: string) =>
  send(res, status, { relayError, message })

const header = (req: IncomingMessage, name: string) => {
  const v = req.headers[name]
  return typeof v === 'string' ? v : undefined
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  // On Vercel the platform may already have parsed the body; elsewhere it is still a stream.
  const pre = (req as { body?: unknown }).body
  if (typeof pre === 'string') return JSON.parse(pre)
  if (Buffer.isBuffer(pre)) return JSON.parse(pre.toString('utf8'))
  if (pre !== undefined && pre !== null) return pre
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch (e) { reject(e) } })
    req.on('error', reject)
  })
}

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', reject)
  })
}

export function createRelay(o: RelayOptions = {}) {
  const request = o.request ?? https.request

  /** Only this app's own pages may use the relay; a website open in another tab must not. */
  function allowed(req: IncomingMessage, res: ServerResponse, checkCode: boolean): boolean {
    const host = header(req, 'host') ?? ''
    if (o.loopbackOnly && !LOOPBACK.has(host.replace(/:\d+$/, ''))) { refuse(res, 403, 'origin', 'The relay only answers local requests.'); return false }
    if (header(req, 'x-breeze-helper') !== '1') { refuse(res, 403, 'origin', 'Missing relay header.'); return false }
    const site = header(req, 'sec-fetch-site')
    if (site && site !== 'same-origin' && site !== 'none') { refuse(res, 403, 'origin', 'Cross-site requests are not allowed.'); return false }
    const origin = header(req, 'origin')
    if (origin) {
      let originHost = ''
      try { originHost = new URL(origin).host } catch { /* opaque origins ("null") fall through and are refused */ }
      if (originHost !== host) { refuse(res, 403, 'origin', 'Cross-origin requests are not allowed.'); return false }
    }
    if (checkCode && o.accessCode && !sameSecret(header(req, 'x-relay-code') ?? '', o.accessCode)) {
      refuse(res, 403, 'code', 'This relay needs its access code.')
      return false
    }
    return true
  }

  /** Forward to ICICI and return its status and JSON body. Cookies and other upstream headers are dropped. */
  function forward(res: ServerResponse, options: https.RequestOptions, body?: string): Promise<void> {
    return new Promise(resolve => {
      let done = false
      const finish = (fn: () => void) => { if (!done) { done = true; fn(); resolve() } }
      const out = request({ ...options, timeout: TIMEOUT_MS }, up => {
        const chunks: Buffer[] = []
        let size = 0
        up.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_RESPONSE) { up.destroy(); finish(() => send(res, 502, { Success: null, Status: 502, Error: 'ICICI response was too large.' })) } else chunks.push(c)
        })
        up.on('end', () => finish(() => {
          res.statusCode = up.statusCode ?? 502
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.setHeader('x-content-type-options', 'nosniff')
          res.end(Buffer.concat(chunks))
        }))
        up.on('error', () => finish(() => send(res, 502, { Success: null, Status: 502, Error: 'ICICI connection dropped.' })))
      })
      out.on('timeout', () => out.destroy(new Error('timeout')))
      out.on('error', e => finish(() => send(res, 502, { Success: null, Status: 502, Error: `Could not reach ICICI: ${e.message}` })))
      if (body !== undefined) out.write(body)
      out.end()
    })
  }

  const ping: Handler = async (req, res) => {
    if (req.method !== 'GET') return refuse(res, 405, 'method', 'Use GET.')
    if (!allowed(req, res, false)) return
    send(res, 200, { helper: 'breeze-relay', needsCode: !!o.accessCode })
  }

  const session: Handler = async (req, res) => {
    if (req.method !== 'POST') return refuse(res, 405, 'method', 'Use POST.')
    if (!allowed(req, res, true)) return
    let parsed: { appKey?: unknown; apiSession?: unknown }
    try { parsed = (await readJson(req)) as typeof parsed } catch { return refuse(res, 400, 'request', 'Invalid request body.') }
    const { appKey, apiSession } = parsed ?? {}
    if (typeof appKey !== 'string' || typeof apiSession !== 'string' || !CREDENTIAL.test(appKey) || !CREDENTIAL.test(apiSession)) {
      return refuse(res, 400, 'request', 'appKey and apiSession are required.')
    }
    // Breeze wants compact JSON in the body of a GET.
    const payload = JSON.stringify({ SessionToken: apiSession, AppKey: appKey })
    await forward(res, { ...SESSION, method: 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, payload)
  }

  const history: Handler = async (req, res) => {
    if (req.method !== 'GET') return refuse(res, 405, 'method', 'Use GET.')
    if (!allowed(req, res, true)) return
    const token = header(req, 'x-sessiontoken')
    const apikey = header(req, 'apikey')
    if (!token || !apikey || !CREDENTIAL.test(token) || !CREDENTIAL.test(apikey)) return refuse(res, 400, 'request', 'Session headers are required.')
    const out = new URLSearchParams()
    for (const [k, v] of new URL(req.url ?? '', 'http://relay').searchParams) {
      if (!HISTORY_PARAMS.has(k) || !PARAM_VALUE.test(v)) return refuse(res, 400, 'request', `Unsupported parameter: ${k}`)
      out.set(k, v)
    }
    if (!out.get('stock_code')) return refuse(res, 400, 'request', 'stock_code is required.')
    await forward(res, { hostname: DATA.hostname, path: `${DATA.path}?${out}`, method: 'GET', headers: { 'Content-Type': 'application/json', 'X-SessionToken': token, apikey } })
  }

  /**
   * ICICI returns the browser to the redirect URL with a POST (a static page answers that with HTTP 405), carrying the
   * one-time code as `apisession` in the query string and possibly the form body. Take the code from either, and send
   * the browser on to the app with a plain GET under a different parameter name so a rewrite cannot loop.
   * It only ever redirects to this app's own root, and a malformed code just lands on the app without one.
   */
  const callback: Handler = async (req, res) => {
    let code: string | null = null
    const take = (params: URLSearchParams) => {
      for (const [k, v] of params) if (!code && k.toLowerCase().replace(/_/g, '') === 'apisession' && v) code = v
    }
    take(new URL(req.url ?? '', 'http://relay').searchParams)
    if (!code && req.method === 'POST') {
      try {
        const pre = (req as { body?: unknown }).body
        if (typeof pre === 'string') take(new URLSearchParams(pre))
        else if (pre && typeof pre === 'object') take(new URLSearchParams(Object.entries(pre as Record<string, unknown>).filter(([, v]) => typeof v === 'string') as [string, string][]))
        else take(await readForm(req))
      } catch { /* no usable body */ }
    }
    res.statusCode = 303
    res.setHeader('location', code && CREDENTIAL.test(code) ? `/?breeze_session=${encodeURIComponent(code)}` : '/')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('referrer-policy', 'no-referrer')
    res.end()
  }

  return { ping, session, history, callback }
}
