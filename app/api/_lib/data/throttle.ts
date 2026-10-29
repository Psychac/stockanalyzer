/**
 * Rate limit for the ingest endpoint, shared by the server (enforces it) and the app (mirrors it so buttons pause). Pure, so
 * it can be tested without Blob. Only a fully successful run starts a cooldown, so a failed or partial run can be retried.
 */
export type IngestMode = 'update' | 'refreshMeta' | 'rebuild'

export const COOLDOWN_MS: Record<IngestMode, number> = { update: 30 * 60_000, refreshMeta: 60 * 60_000, rebuild: 60 * 60_000 }

export const STATE_FILE = 'ingest-state.json'
const BUDGET_STOP = 'time budget'

export interface ThrottleState {
  /** When each kind of run last finished fully successfully (epoch ms). */
  done: Partial<Record<IngestMode, number>>
  /** The last run ran out of time and the caller is expected to call again; that continuation must not be refused. */
  pending?: boolean
}

export type Verdict = { limited: false } | { limited: true; mode: IngestMode; retryAfterMs: number }

export const modeOf = (q: { rebuild: boolean; refreshMeta: boolean }): IngestMode => (q.rebuild ? 'rebuild' : q.refreshMeta ? 'refreshMeta' : 'update')

export function checkThrottle(state: ThrottleState | null, mode: IngestMode, now: number): Verdict {
  if (!state) return { limited: false }
  // A rebuild or catch-up takes several calls; the follow-ups are plain runs and have to get through.
  if (state.pending && mode === 'update') return { limited: false }
  const left = (state.done[mode] ?? 0) + COOLDOWN_MS[mode] - now
  return left > 0 ? { limited: true, mode, retryAfterMs: left } : { limited: false }
}

/** "Fully successful": it reached the end of what the exchanges have published, with nothing failing along the way. */
export const isFullSuccess = (r: { stopped?: string | null; metaError?: string }) =>
  !r.metaError && (!r.stopped || /not published yet/.test(r.stopped))

/** The state after a run that returned `r` for `mode`. */
export function recordRun(state: ThrottleState | null, mode: IngestMode, r: { stopped?: string | null; metaError?: string }, now: number): ThrottleState {
  const next: ThrottleState = { done: { ...(state?.done ?? {}) } }
  if (r.stopped?.includes(BUDGET_STOP)) next.pending = true
  // A rebuild is spread over several calls and only its first carries the flag, so it counts as soon as it has started.
  if (mode === 'rebuild' || isFullSuccess(r)) next.done[mode] = now
  return next
}

export const waitText = (ms: number) => (ms >= 60_000 ? `${Math.ceil(ms / 60_000)} min` : `${Math.ceil(ms / 1000)} s`)
