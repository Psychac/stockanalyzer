import { describe, expect, it } from 'vitest'
import { afterClose, needsRefresh } from './refresh'

const ist = (iso: string) => Date.parse(`${iso}+05:30`)

describe('refresh gate', () => {
  it('is closed before the close and on weekends', () => {
    expect(afterClose(ist('2026-10-29T15:44:00'))).toBe(false)
    expect(afterClose(ist('2026-10-29T15:45:00'))).toBe(true)
    expect(afterClose(ist('2026-10-31T18:00:00'))).toBe(false) // Saturday
  })

  it('asks when stocks or indices are older than today, after the close', () => {
    const now = ist('2026-10-29T16:00:00')
    expect(needsRefresh({ latestDate: '2026-10-28', indices: { date: '2026-10-28' } }, now)).toBe(true)
    expect(needsRefresh({ latestDate: '2026-10-29', indices: { date: '2026-10-28' } }, now)).toBe(true) // indices lag
    expect(needsRefresh({ latestDate: '2026-10-29', indices: { date: '2026-10-29' } }, now)).toBe(false)
    expect(needsRefresh(null, now)).toBe(true)
  })

  it('does not ask during the session, whatever is published', () => {
    expect(needsRefresh({ latestDate: '2026-10-28', indices: null }, ist('2026-10-29T11:00:00'))).toBe(false)
  })
})
