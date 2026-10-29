import { describe, expect, it } from 'vitest'
import { COOLDOWN_MS, IngestLimited, cooldownLeft, runIngest, type Post } from './admin'

const script = (...replies: { status?: number; json: unknown }[]) => {
  const calls: { url: string; secret: string }[] = []
  const post: Post = async (url, secret) => { calls.push({ url, secret }); const r = replies[Math.min(calls.length - 1, replies.length - 1)]; return { status: r.status ?? 200, json: r.json } }
  return { post, calls }
}

describe('runIngest', () => {
  it('repeats while the server stops on its time budget, and sends the rebuild flag only once', async () => {
    const { post, calls } = script(
      { json: { applied: ['2026-10-26'], stopped: 'time budget reached; run again to continue', latestDate: '2026-10-26', rebuilt: true } },
      { json: { applied: ['2026-10-27', '2026-10-28'], stopped: null, latestDate: '2026-10-28' } },
    )
    const r = await runIngest('s3cret', 'rebuild', post)
    expect(calls.map(c => c.url)).toEqual(['/api/data/ingest?rebuild=1', '/api/data/ingest'])
    expect(calls.every(c => c.secret === 's3cret')).toBe(true)
    expect(r).toMatchObject({ runs: 2, days: ['2026-10-26', '2026-10-27', '2026-10-28'], latestDate: '2026-10-28', rebuilt: true })
  })
  it('treats "not published yet" as a normal stop, with a note', async () => {
    const { post, calls } = script({ json: { applied: [], stopped: 'today is not published yet', latestDate: '2026-10-28' } })
    const r = await runIngest('x', 'update', post)
    expect(calls).toHaveLength(1)
    expect(r.note).toMatch(/not published yet/)
    expect(r.status).toBe('current')
  })
  it('classifies the outcome: updated, current (waiting on the exchanges) or partial', async () => {
    expect((await runIngest('x', 'update', script({ json: { applied: ['2026-10-28'], stopped: null, latestDate: '2026-10-28' } }).post)).status).toBe('updated')
    const cur = await runIngest('x', 'update', script({ json: { applied: [], stopped: 'today is not published yet', latestDate: '2026-10-28' } }).post)
    expect(cur.status).toBe('current')
    expect((await runIngest('x', 'update', script({ json: { applied: ['2026-10-27'], stopped: '2026-10-28: only one exchange has published so far' } }).post)).status).toBe('partial')
    expect((await runIngest('x', 'update', script({ json: { applied: ['2026-10-28'], stopped: null, metaError: 'HTTP 503' } }).post)).status).toBe('partial')
    expect((await runIngest('x', 'update', script({ json: { stopped: 'time budget reached; run again to continue' } }).post)).status).toBe('partial')
  })
  it('blocks the same action until its cooldown passes, and only after a success', () => {
    const t = 1_800_000_000_000
    expect(cooldownLeft('update', t, 0)).toBe(0)
    expect(cooldownLeft('update', t + 60_000, t)).toBe(COOLDOWN_MS.update - 60_000)
    expect(cooldownLeft('update', t + COOLDOWN_MS.update, t)).toBe(0)
  })
  it('reports a server-side rate limit with how long to wait', async () => {
    const limited = script({ status: 429, json: { limited: true, retryAfterSec: 840, error: 'Rate limited: try again in 14 min.' } })
    const e = await runIngest('x', 'update', limited.post).catch(x => x)
    expect(e).toBeInstanceOf(IngestLimited)
    expect(e.retryAfterMs).toBe(840_000)
    expect(e.message).toMatch(/14 min/)
    expect(limited.calls).toHaveLength(1) // no retrying against a limit
  })
  it('says so when the secret is wrong or the server fails', async () => {
    await expect(runIngest('bad', 'update', script({ status: 401, json: { error: 'unauthorized' } }).post)).rejects.toThrow(/rejected/)
    await expect(runIngest('x', 'update', script({ status: 500, json: { error: 'boom' } }).post)).rejects.toThrow('boom')
  })
  it('gives up after a bounded number of runs', async () => {
    const { post, calls } = script({ json: { stopped: 'time budget reached; run again to continue' } })
    const r = await runIngest('x', 'update', post)
    expect(calls.length).toBe(8)
    expect(r.note).toMatch(/Run it again/)
  })
})
