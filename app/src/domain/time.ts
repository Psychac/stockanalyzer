/** Indian market time. IST is a fixed +05:30 offset with no DST, so plain arithmetic is exact. */
export const IST_OFFSET_MS = 5.5 * 3600 * 1000
const MIN = 60_000
const DAY = 24 * 60 * MIN

/** Regular NSE cash session, in minutes after IST midnight. */
const OPEN_MIN = 9 * 60 + 15
const CLOSE_MIN = 15 * 60 + 30
/** Wait this long after the bell before treating the daily bar as final (feed settling). */
const SETTLE_MIN = 5

/** YYYY-MM-DD in Asia/Kolkata. */
export function istDate(t: number): string {
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** Minutes after IST midnight and day of week (0 = Sunday). */
function istParts(t: number) {
  const d = new Date(t + IST_OFFSET_MS)
  return { min: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() }
}

/** UTC epoch ms of the IST wall-clock moment `minutes` after midnight on `date`. */
function istMoment(date: string, minutes: number): number {
  return Date.parse(`${date}T00:00:00Z`) - IST_OFFSET_MS + minutes * MIN
}

/** Canonical start-of-bar timestamp for a daily candle: the 09:15 IST open of that date. */
export const sessionOpen = (date: string) => istMoment(date, OPEN_MIN)

const isWeekday = (dow: number) => dow !== 0 && dow !== 6

/** True while the regular session is trading. Exchange holidays are not modelled. */
export function isMarketOpen(now: number): boolean {
  const { min, dow } = istParts(now)
  return isWeekday(dow) && min >= OPEN_MIN && min < CLOSE_MIN
}

/** Is the daily bar for `date` final at time `now`? */
export function isDailyBarClosed(date: string, now: number): boolean {
  return now >= istMoment(date, CLOSE_MIN + SETTLE_MIN)
}

/** When the most recent weekday session became final (epoch ms). */
export function lastSessionClose(now: number): number {
  let date = istDate(now)
  for (let i = 0; i < 8; i++) {
    const { dow } = istParts(istMoment(date, 12 * 60))
    const close = istMoment(date, CLOSE_MIN + SETTLE_MIN)
    if (isWeekday(dow) && close <= now) return close
    date = istDate(Date.parse(`${date}T00:00:00Z`) - DAY)
  }
  return now
}

/** FYERS access tokens lapse at 06:30 IST each day. Returns the next such moment after `now`. */
export function nextTokenExpiry(now: number): number {
  const today = istMoment(istDate(now), 6 * 60 + 30)
  return now < today ? today : today + DAY
}
