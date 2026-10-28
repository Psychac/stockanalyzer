import type { IncomingMessage, ServerResponse } from 'node:http'
import { blobStore } from '../_lib/data/store.js'

/** Public: the current manifest (which data files exist, and where). Cached at the edge so clients cost almost no invocations. */
export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader('content-type', 'application/json')
  try {
    const m = process.env.BLOB_READ_WRITE_TOKEN ? await blobStore().getManifest() : null
    res.statusCode = m ? 200 : 404
    res.setHeader('cache-control', m ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' : 'no-store')
    res.end(JSON.stringify(m ?? { error: 'No market data has been published yet.' }))
  } catch (e) {
    res.statusCode = 502
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
  }
}
