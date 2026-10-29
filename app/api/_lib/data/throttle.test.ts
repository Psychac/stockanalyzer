import { describe, expect, it } from 'vitest'
import { COOLDOWN_MS, checkThrottle, isFullSuccess, modeOf, recordRun, type ThrottleState } from './throttle.js'

const T = 1_800_000_000_000
const ok = { stopped: null }
const budget = { stopped: 'time budget reached; run again to continue' }

describe('ingest throttle', () => {
  it('lets the first run through, and blocks the same kind after a full success until the cooldown ends', () => {
    expect(checkThrottle(null, 'update', T)).toEqual({ limited: false })
    const s = recordRun(null, 'update', ok, T)
    expect(checkThrottle(s, 'update', T + 60_000)).toEqual({ limited: true, mode: 'update', retryAfterMs: COOLDOWN_MS.update - 60_000 })
    expect(checkThrottle(s, 'update', T + COOLDOWN_MS.update)).toEqual({ limited: false })
  })
  it('treats "today is not published yet" as a success, but not a failure, a metadata error or a time-budget stop', () => {
    expect(isFullSuccess({ stopped: 'today is not published yet' })).toBe(true)
    expect(isFullSuccess({ stopped: '2026-10-28: HTTP 503 for https://x' })).toBe(false)
    expect(isFullSuccess({ stopped: '2026-10-28: only one exchange has published so far' })).toBe(false)
    expect(isFullSuccess({ stopped: null, metaError: 'HTTP 503' })).toBe(false)
    expect(isFullSuccess(budget)).toBe(false)
  })
  it('does not start a cooldown after a partial run, so it can be retried straight away', () => {
    const s = recordRun(null, 'update', { stopped: '2026-10-28: only one exchange has published so far' }, T)
    expect(checkThrottle(s, 'update', T + 1000)).toEqual({ limited: false })
  })
  it('keeps kinds apart: a finished update does not block a company-info refresh', () => {
    const s = recordRun(null, 'update', ok, T)
    expect(checkThrottle(s, 'refreshMeta', T + 1000)).toEqual({ limited: false })
  })
  it('lets the follow-up calls of a long run through, even inside the cooldown of an earlier update', () => {
    let s: ThrottleState = recordRun(null, 'update', ok, T)
    s = recordRun(s, 'rebuild', budget, T + 5 * 60_000) // a rebuild starts and runs out of time
    expect(s.pending).toBe(true)
    expect(checkThrottle(s, 'update', T + 6 * 60_000)).toEqual({ limited: false }) // the continuation
    s = recordRun(s, 'update', ok, T + 10 * 60_000) // it finishes
    expect(s.pending).toBeUndefined()
    expect(checkThrottle(s, 'update', T + 11 * 60_000).limited).toBe(true)
  })
  it('blocks starting another rebuild soon after one began', () => {
    const s = recordRun(null, 'rebuild', budget, T)
    expect(checkThrottle(s, 'rebuild', T + 60_000).limited).toBe(true)
    expect(checkThrottle(s, 'rebuild', T + COOLDOWN_MS.rebuild).limited).toBe(false)
  })
  it('maps the query flags to a kind, rebuild first', () => {
    expect(modeOf({ rebuild: true, refreshMeta: true })).toBe('rebuild')
    expect(modeOf({ rebuild: false, refreshMeta: true })).toBe('refreshMeta')
    expect(modeOf({ rebuild: false, refreshMeta: false })).toBe('update')
  })
})
