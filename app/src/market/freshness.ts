const DAY = 86_400_000
const IST = 5.5 * 3600_000

/**
 * Weekdays strictly after `date` up to and including yesterday (IST), i.e. sessions whose files should already be out.
 * Today is left out because its file is published in the evening. Exchange holidays are not known here, so this can
 * overcount by a day or two around them; callers should allow some slack.
 */
export function sessionsBehind(date: string, now: number): number {
  const last = Date.parse(`${date}T00:00:00Z`)
  const yesterday = Math.floor((now + IST) / DAY) * DAY - DAY
  let n = 0
  for (let t = last + DAY; t <= yesterday; t += DAY) {
    const w = new Date(t).getUTCDay()
    if (w !== 0 && w !== 6) n++
  }
  return n
}

/** Two missed sessions, not one, so a holiday or a late cron run does not raise a false alarm. */
export const STALE_AFTER = 2

export function staleNote(date: string | null | undefined, now = Date.now()): string | null {
  if (!date) return null
  const n = sessionsBehind(date, now)
  return n >= STALE_AFTER ? `This data is ${n} trading days old (latest ${date}). The nightly update may be failing; run an update from Settings.` : null
}
