/**
 * When published data is behind the market, shared by the server (enforces it) and the app (decides whether to ask). Pure, so it
 * can be tested without Blob. Everything is by IST date and clock, never by an exchange's own close time: a special session
 * (Muhurat trading) just produces a bar dated that day, which is all the checks look at.
 */
const IST = 5.5 * 3600_000
/** Daily bars are final a little after the 15:30 close. */
const CLOSE_MINUTES = 15 * 60 + 45
/** Between automatic attempts, however many people open the app. */
export const REFRESH_COOLDOWN_MS = 10 * 60_000
export const REFRESH_STATE_FILE = 'refresh-state.json'

export const istDate = (now: number) => new Date(now + IST).toISOString().slice(0, 10)

/** A weekday, from shortly after the close. Holidays are not known here; they just find nothing new. */
export function afterClose(now: number): boolean {
  const d = new Date(now + IST)
  const w = d.getUTCDay()
  return w !== 0 && w !== 6 && d.getUTCHours() * 60 + d.getUTCMinutes() >= CLOSE_MINUTES
}

export interface Published { latestDate: string | null; indices: { date: string } | null }

/** After the close, anything published before today may have a newer version waiting. */
export function needsRefresh(m: Published | null, now: number): boolean {
  if (!afterClose(now)) return false
  const today = istDate(now)
  return !m || (m.latestDate ?? '') < today || (m.indices?.date ?? '') < today
}
