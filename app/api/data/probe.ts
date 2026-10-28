import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Reachability probe for the planned market-data ingest: can this deployment's network download the public NSE and BSE
 * end-of-day files and Upstox candles? It reads only response headers and then drops the body, sends no credentials, and
 * returns status, size and timing per source. Safe to leave deployed; delete once the ingest job exists.
 */
const UA = 'Mozilla/5.0 (compatible; stock-analyzer-probe)'
const pad = (n: number) => String(n).padStart(2, '0')

function recentDays(count = 5): Date[] {
  const out: Date[] = []
  const d = new Date()
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() - 1)
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.push(new Date(d))
  }
  return out
}

async function head(url: string) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(8000) })
    const len = res.headers.get('content-length')
    await res.body?.cancel()
    return { status: res.status, bytes: len ? Number(len) : null, ms: Date.now() - t0 }
  } catch (e) {
    return { status: 0, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }
  }
}

/** First recent trading day whose file exists; exchange holidays return 404, which is normal. */
async function firstAvailable(make: (d: Date) => string) {
  const tried: { date: string; status: number }[] = []
  for (const d of recentDays()) {
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    const r = await head(make(d))
    tried.push({ date, status: r.status })
    if (r.status === 200) return { ok: true, date, ...r, tried }
    if (r.status === 0) return { ok: false, ...r, tried }
  }
  return { ok: false, tried }
}

export default async function handler(_req: IncomingMessage, res: ServerResponse) {
  const ddmmyyyy = (d: Date) => `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`
  const yyyymmdd = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
  const [nse, bse, upstoxSensex, upstoxBseEq] = await Promise.all([
    firstAvailable(d => `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${ddmmyyyy(d)}.csv`),
    firstAvailable(d => `https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_${yyyymmdd(d)}_F_0000.CSV`),
    head('https://api.upstox.com/v3/historical-candle/BSE_INDEX%7CSENSEX/days/1/2026-10-27/2026-10-20'),
    head('https://api.upstox.com/v3/historical-candle/BSE_EQ%7CINE002A01018/days/1/2026-10-27/2026-10-20'),
  ])
  res.statusCode = 200
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify({ region: process.env.VERCEL_REGION ?? null, at: new Date().toISOString(), nse, bse, upstoxSensex, upstoxBseEq }, null, 2))
}
