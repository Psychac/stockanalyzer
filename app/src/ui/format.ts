const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const inr0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

export const price = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : inr.format(n))
export const rupees = (n: number) => `₹${inr0.format(Math.round(n))}`
export const pct = (n: number, d = 2) => `${n > 0 ? '+' : ''}${n.toFixed(d)}%`
export const tone = (n: number) => (n > 0 ? 'text-up' : n < 0 ? 'text-down' : 'text-mute')

export function crore(n: number) {
  return `₹${(n / 1e7).toFixed(n >= 1e10 ? 0 : 1)} Cr`
}

export function dateTime(ms: number) {
  return new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
export function dateOnly(ms: number) {
  return new Date(ms).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
}
export function timeOnly(ms: number) {
  return new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
}
