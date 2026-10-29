import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { advance, realDeps } from '../_lib/data/ingest.js'
import { blobStore } from '../_lib/data/store.js'
import { STATE_FILE, checkThrottle, modeOf, recordRun, waitText, type ThrottleState } from '../_lib/data/throttle.js'

/**
 * Daily market-data ingest. Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`; run it by hand the same way to
 * backfill (call again if the response says it stopped on the time budget). Refuses to run when CRON_SECRET is not set.
 *
 * Manual calls are rate limited: after a fully successful run the same kind of run is refused with 429 for a while (see
 * throttle.ts). The scheduled cron is exempt, so a manual run can never make it skip a day.
 */
export const config = { maxDuration: 300 }

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
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
    // ?refreshMeta=1 re-fetches company metadata (ISIN, names, industries) and rewrites the snapshots even with no new day.
    const params = new URL(req.url ?? '', 'http://x').searchParams
    const refreshMeta = params.get('refreshMeta') === '1'
    const rebuild = params.get('rebuild') === '1'
    const mode = modeOf({ rebuild, refreshMeta })
    const store = blobStore()
    const isCron = String(req.headers['user-agent'] ?? '').startsWith('vercel-cron')
    // A missing or unreadable state file must not block ingesting, so reads fail open.
    const state = await store.getJson<ThrottleState>(STATE_FILE).catch(() => null)
    const verdict = isCron ? { limited: false as const } : checkThrottle(state, mode, Date.now())
    if (verdict.limited) {
      const secs = Math.ceil(verdict.retryAfterMs / 1000)
      return send(res, 429, {
        limited: true, mode: verdict.mode, retryAfterSec: secs,
        error: `Rate limited: a ${verdict.mode === 'update' ? 'normal update' : verdict.mode === 'refreshMeta' ? 'company-info refresh' : 'rebuild'} already finished successfully recently. Try again in ${waitText(verdict.retryAfterMs)}.`,
      }, { 'retry-after': String(secs) })
    }
    const r = await advance(realDeps(store), { budgetMs: 240_000, refreshMeta, rebuild })
    await store.putJson(STATE_FILE, recordRun(state, mode, r, Date.now())).catch(() => { /* losing the record only loosens the limit */ })
    send(res, 200, r)
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) })
  }
}
