import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { advance, realDeps } from '../_lib/data/ingest.js'
import { blobStore } from '../_lib/data/store.js'

/**
 * Daily market-data ingest. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`; run it by hand the same way to
 * backfill (call again if the response says it stopped on the time budget). Refuses to run when CRON_SECRET is not set.
 */
export const config = { maxDuration: 300 }

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const secret = process.env.CRON_SECRET
  if (!secret) return send(res, 503, { error: 'CRON_SECRET is not set on this deployment.' })
  const given = Buffer.from(String(req.headers.authorization ?? ''))
  const want = Buffer.from(`Bearer ${secret}`)
  if (given.length !== want.length || !timingSafeEqual(given, want)) return send(res, 401, { error: 'unauthorized' })
  if (!process.env.BLOB_READ_WRITE_TOKEN) return send(res, 503, { error: 'No Blob store is connected to this project (BLOB_READ_WRITE_TOKEN is missing).' })
  try {
    const r = await advance(realDeps(blobStore()), { budgetMs: 240_000 })
    send(res, 200, r)
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) })
  }
}
