import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'

/**
 * Dev-only bridge for ICICI Breeze, which a browser cannot call directly:
 *  - the session exchange is a GET with a JSON body (browsers cannot send one), and
 *  - the data host returns no CORS headers.
 * This runs inside `vite` / `vite preview` on the user's own machine and is absent from any build output, so an
 * installed or hosted copy has no Breeze access. It holds no credentials and logs no request bodies.
 */
const SESSION_HOST = 'api.icicidirect.com'
const SESSION_PATH = '/breezeapi/api/v1/customerdetails'
const DATA_HOST = 'breezeapi.icicidirect.com'
const TIMEOUT_MS = 20_000
const MAX_BODY = 4096

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Only this machine's own pages may use the helper; a website open in another tab must not. */
function allowed(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '')
  if (!LOCAL_HOSTS.has(host)) return false
  if (req.headers['x-breeze-helper'] !== '1') return false
  const origin = req.headers.origin
  return !origin || new URL(origin).host === req.headers.host
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function relay(res: ServerResponse, upstream: https.RequestOptions, body?: string) {
  const out = https.request({ ...upstream, timeout: TIMEOUT_MS }, up => {
    const chunks: Buffer[] = []
    up.on('data', c => chunks.push(c))
    up.on('end', () => {
      res.statusCode = up.statusCode ?? 502
      res.setHeader('content-type', up.headers['content-type'] ?? 'application/json')
      res.setHeader('cache-control', 'no-store')
      res.end(Buffer.concat(chunks))
    })
  })
  out.on('timeout', () => out.destroy(new Error('timeout')))
  out.on('error', e => send(res, 502, { Success: null, Status: 502, Error: `Could not reach ICICI: ${e.message}` }))
  if (body !== undefined) out.write(body)
  out.end()
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const handler: Connect.NextHandleFunction = async (req, res, next) => {
  const url = req.url ?? ''
  if (!url.startsWith('/__breeze/')) return next()
  if (!allowed(req)) return send(res, 403, { error: 'forbidden' })
  const u = new URL(url, 'http://localhost')

  if (u.pathname === '/__breeze/ping') return send(res, 200, { helper: 'breeze-dev-proxy' })

  if (u.pathname === '/__breeze/session' && req.method === 'POST') {
    try {
      const { appKey, apiSession } = JSON.parse(await readBody(req)) as { appKey?: unknown; apiSession?: unknown }
      if (typeof appKey !== 'string' || typeof apiSession !== 'string' || !appKey || !apiSession) return send(res, 400, { Success: null, Status: 400, Error: 'appKey and apiSession are required' })
      // Breeze wants compact JSON in a GET body.
      const payload = JSON.stringify({ SessionToken: apiSession, AppKey: appKey })
      return relay(res, { hostname: SESSION_HOST, path: SESSION_PATH, method: 'GET', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, payload)
    } catch {
      return send(res, 400, { Success: null, Status: 400, Error: 'invalid request' })
    }
  }

  if (u.pathname === '/__breeze/v2/historicalcharts' && req.method === 'GET') {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    for (const h of ['x-sessiontoken', 'apikey']) {
      const v = req.headers[h]
      if (typeof v === 'string') headers[h] = v
    }
    return relay(res, { hostname: DATA_HOST, path: `/api/v2/historicalcharts${u.search}`, method: 'GET', headers })
  }

  return send(res, 404, { error: 'not found' })
}

export function breezeHelper(): Plugin {
  return {
    name: 'breeze-helper',
    configureServer: server => { server.middlewares.use(handler) },
    configurePreviewServer: server => { server.middlewares.use(handler) },
  }
}
