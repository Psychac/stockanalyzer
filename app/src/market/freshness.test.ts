import { describe, expect, it } from 'vitest'
import { sessionsBehind, staleNote } from './freshness'

const at = (d: string, h = 12) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00+05:30`)

describe('data freshness', () => {
  it('counts weekdays after the data date up to yesterday, ignoring today and weekends', () => {
    expect(sessionsBehind('2026-10-28', at('2026-10-29'))).toBe(0) // Wed data, Thu now: today not due yet
    expect(sessionsBehind('2026-10-27', at('2026-10-29'))).toBe(1)
    expect(sessionsBehind('2026-10-23', at('2026-10-26'))).toBe(0) // Fri data on Monday: the weekend is not missed sessions
    expect(sessionsBehind('2026-10-23', at('2026-10-29'))).toBe(3)
  })
  it('warns only from two missed sessions', () => {
    expect(staleNote('2026-10-27', at('2026-10-29'))).toBeNull()
    expect(staleNote('2026-10-26', at('2026-10-29'))).toMatch(/2 trading days old/)
    expect(staleNote(null)).toBeNull()
  })
})
