import type { IncomingMessage, ServerResponse } from 'node:http'
import { DATA_VERSION, advance, realDeps } from '../_lib/data/ingest.js'
import { REFRESH_COOLDOWN_MS, REFRESH_STATE_FILE, needsRefresh } from '../_lib/data/refresh.js'
import { blobStore } from '../_lib/data/store.js'

/**
 * Catch-up when the app is opened after the market has closed, so nobody waits for the nightly run to see today's close. No sign-in
 * is needed: it only republishes public exchange data, exits at once when the data is already current, and runs at most once
 * every few minutes however many people ask. A rebuild (changed data rules) is left to the nightly run.
 */
export const config = { maxDuration: 60 }

const send = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return send(res, 503, { error: 'No Blob store is connected to this project.' })
  try {
    const store = blobStore()
    const now = Date.now()
    const before = await store.getManifest()
    if (!before || before.dataVersion !== DATA_VERSION || !needsRefresh(before, now)) return send(res, 200, { ran: false, changed: false })
    const state = await store.getJson<{ at: number }>(REFRESH_STATE_FILE).catch(() => null)
    if (state && now - state.at < REFRESH_COOLDOWN_MS) return send(res, 200, { ran: false, changed: false, retryAfterSec: Math.ceil((state.at + REFRESH_COOLDOWN_MS - now) / 1000) })
    // Claimed before running, so people arriving together do not all start one.
    await store.putJson(REFRESH_STATE_FILE, { at: now }).catch(() => { /* losing it only loosens the limit */ })
    const r = await advance(realDeps(store), { budgetMs: 45_000 })
    const after = await store.getManifest()
    const changed = after?.latestDate !== before.latestDate || after?.indices?.date !== before.indices?.date
    send(res, 200, { ran: true, changed, applied: r.applied, stopped: r.stopped })
  } catch (e) {
    send(res, 500, { error: e instanceof Error ? e.message : String(e) })
  }
}
