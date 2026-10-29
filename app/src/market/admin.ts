/**
 * Runs the backend ingest from the app instead of curl. The endpoint wants `Authorization: Bearer $CRON_SECRET`, so the
 * secret is kept on this device (local storage, never in backups) and sent only to this app's own origin.
 */
import { COOLDOWN_MS, waitText, type IngestMode } from '../../api/_lib/data/throttle'
export { COOLDOWN_MS, waitText }
export type { IngestMode }

export interface IngestReply { limited?: boolean; retryAfterSec?: number; applied?: string[]; skipped?: string[]; stopped?: string | null; latestDate?: string | null; rebuilt?: boolean; metaError?: string; error?: string }
export type Post = (url: string, secret: string) => Promise<{ status: number; json: unknown }>

const KEY = 'ingestSecret'
const BUDGET_STOP = 'time budget'
/** One run covers about four minutes of work, so even a full rebuild finishes well inside this. */
const MAX_RUNS = 8

export const loadIngestSecret = (): string => { try { return localStorage.getItem(KEY) ?? '' } catch { return '' } }
export function saveIngestSecret(secret: string) {
  try { if (secret) localStorage.setItem(KEY, secret); else localStorage.removeItem(KEY) } catch { /* not persisted */ }
}

export const realPost: Post = async (url, secret) => {
  const r = await fetch(url, { method: 'GET', headers: { authorization: `Bearer ${secret}` }, cache: 'no-store' })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}

/**
 * `updated`: new days were published. `current`: nothing new because the data is already as fresh as the exchanges allow
 * (today's file is not out yet). `partial`: it stopped on a problem or ran out of runs, so trying again is reasonable.
 */
export type IngestStatus = 'updated' | 'current' | 'partial'
/** The server refused the run because the same kind of run finished successfully a short while ago. */
export class IngestLimited extends Error {
  constructor(message: string, readonly retryAfterMs: number) { super(message) }
}

export interface IngestSummary { runs: number; days: string[]; latestDate: string | null; rebuilt: boolean; note: string | null; status: IngestStatus }

/** The server enforces the same cooldowns (see api/_lib/data/throttle.ts); the app mirrors them so buttons pause instead of failing. */
const doneKey = (mode: IngestMode) => `ingestDone:${mode}`

export function lastIngestSuccess(mode: IngestMode): number {
  try { return Number(localStorage.getItem(doneKey(mode))) || 0 } catch { return 0 }
}
export function markIngestSuccess(mode: IngestMode, now = Date.now()) {
  try { localStorage.setItem(doneKey(mode), String(now)) } catch { /* the cooldown then only lasts until reload */ }
}
/** Milliseconds until `mode` may run again; 0 when it may run now. */
/** Make the local cooldown match one the server reported, so the button pauses for the right time. */
export const adoptServerCooldown = (mode: IngestMode, retryAfterMs: number, now = Date.now()) => markIngestSuccess(mode, now + retryAfterMs - COOLDOWN_MS[mode])
export const cooldownLeft = (mode: IngestMode, now = Date.now(), last = lastIngestSuccess(mode)) => Math.max(0, last + COOLDOWN_MS[mode] - now)

/** Calls the endpoint until it stops on something other than the time budget. A rebuild flag is only sent on the first run. */
export async function runIngest(secret: string, mode: IngestMode, post: Post = realPost, onRun?: (n: number) => void): Promise<IngestSummary> {
  const out: IngestSummary = { runs: 0, days: [], latestDate: null, rebuilt: false, note: null, status: 'partial' }
  for (let i = 0; i < MAX_RUNS; i++) {
    onRun?.(i + 1)
    const first = i === 0
    const q = first && mode === 'rebuild' ? '?rebuild=1' : first && mode === 'refreshMeta' ? '?refreshMeta=1' : ''
    const { status, json } = await post(`/api/data/ingest${q}`, secret)
    const r = json as IngestReply
    if (status === 429) throw new IngestLimited(r.error ?? 'Rate limited by the server.', Math.max(1, r.retryAfterSec ?? 60) * 1000)
    if (status === 401) throw new Error('The ingest secret was rejected. Check it matches CRON_SECRET on the deployment.')
    if (status !== 200) throw new Error(r.error ?? `The ingest failed (HTTP ${status}).`)
    out.runs++
    out.days.push(...(r.applied ?? []))
    out.latestDate = r.latestDate ?? out.latestDate
    out.rebuilt ||= !!r.rebuilt
    if (r.metaError) out.note = `Company metadata could not be refreshed: ${r.metaError}`
    if (!r.stopped?.includes(BUDGET_STOP)) {
      const waiting = !!r.stopped && /not published yet/.test(r.stopped)
      // "Not published yet" is a normal state. Anything else that stopped the run is a problem worth retrying.
      const problem = !!out.note || (!!r.stopped && !waiting)
      if (r.stopped && !out.note) out.note = waiting ? 'Today\'s exchange files are not published yet; the data is as fresh as it can be.' : r.stopped
      out.status = problem ? 'partial' : out.days.length || out.rebuilt ? 'updated' : 'current'
      return out
    }
  }
  out.note = 'Still catching up after several runs. Run it again to continue.'
  return out
}
