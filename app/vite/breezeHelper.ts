import type { Connect, Plugin } from 'vite'
import { createRelay } from '../api/_lib/breezeRelay'

/**
 * Serves the same Breeze relay that Vercel runs from `api/breeze/*`, at the same `/api/breeze/*` paths, inside
 * `vite` and `vite preview`. The relay code lives in `api/_lib/breezeRelay.ts`; see it for what it accepts and why.
 * Locally it additionally refuses any request whose Host is not loopback.
 */
const relay = createRelay({ loopbackOnly: true })

const handler: Connect.NextHandleFunction = async (req, res, next) => {
  const u = new URL(req.url ?? '', 'http://local')
  const path = u.pathname
  // Same rule as vercel.json: a login return carrying the code goes through the callback, which fixes ICICI's POST.
  if (path === '/' && [...u.searchParams.keys()].some(k => k.toLowerCase().replace(/_/g, '') === 'apisession')) return relay.callback(req, res)
  if (!path.startsWith('/api/breeze/')) return next()
  switch (path) {
    case '/api/breeze/ping': return relay.ping(req, res)
    case '/api/breeze/session': return relay.session(req, res)
    case '/api/breeze/history': return relay.history(req, res)
    case '/api/breeze/callback': return relay.callback(req, res)
    default:
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ relayError: 'request', message: 'Not found.' }))
  }
}

export function breezeHelper(): Plugin {
  return {
    name: 'breeze-relay',
    configureServer: server => { server.middlewares.use(handler) },
    configurePreviewServer: server => { server.middlewares.use(handler) },
  }
}
