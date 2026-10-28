import type { DayRow } from './history'

/** Split one CSV line, honouring double quotes. */
export function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { out.push(cur.trim()); cur = '' }
    else cur += ch
  }
  out.push(cur.trim())
  return out
}

const paise = (s: string | undefined) => {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0
}
const int = (s: string | undefined) => {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function table(csv: string): { col: Record<string, number>; rows: string[][] } {
  const lines = csv.split(/\r?\n/).filter(l => l.trim())
  const header = splitCsv(lines[0] ?? '')
  const col: Record<string, number> = {}
  header.forEach((h, i) => { col[h] = i })
  return { col, rows: lines.slice(1).map(splitCsv) }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
/** "27-Oct-2026" -> "2026-10-27" */
export function nseDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s)
  const mo = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1
  return m && mo >= 0 ? `${m[3]}-${String(mo + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

export interface Parsed { date: string | null; rows: DayRow[] }

/** NSE `sec_bhavdata_full`: regular (EQ) and trade-for-trade (BE) equity. Null when the columns are not the expected ones. */
export function parseNse(csv: string): Parsed | null {
  const { col, rows } = table(csv)
  const need = ['SYMBOL', 'SERIES', 'DATE1', 'PREV_CLOSE', 'OPEN_PRICE', 'HIGH_PRICE', 'LOW_PRICE', 'CLOSE_PRICE', 'TTL_TRD_QNTY']
  if (need.some(k => !(k in col))) return null
  const out: DayRow[] = []
  let date: string | null = null
  for (const r of rows) {
    const series = r[col.SERIES]
    if (series !== 'EQ' && series !== 'BE') continue
    const [o, h, l, c, pc] = [r[col.OPEN_PRICE], r[col.HIGH_PRICE], r[col.LOW_PRICE], r[col.CLOSE_PRICE], r[col.PREV_CLOSE]].map(paise)
    if (!(o && h && l && c) || h < l) continue
    const sym = r[col.SYMBOL]
    date ??= nseDate(r[col.DATE1])
    out.push({ id: `NSE:${sym}`, ex: 'NSE', sym, o, h, l, c, pc, v: int(r[col.TTL_TRD_QNTY]) })
  }
  return { date, rows: out }
}

/** BSE `BhavCopy_BSE_CM_..._F_0000`: equity (STK) rows keyed by scrip code, since BSE symbols are reused and renamed. */
export function parseBse(csv: string): Parsed | null {
  const { col, rows } = table(csv)
  const need = ['TradDt', 'FinInstrmTp', 'FinInstrmId', 'TckrSymb', 'OpnPric', 'HghPric', 'LwPric', 'ClsPric', 'PrvsClsgPric', 'TtlTradgVol']
  if (need.some(k => !(k in col))) return null
  const out: DayRow[] = []
  let date: string | null = null
  for (const r of rows) {
    if (r[col.FinInstrmTp] !== 'STK') continue
    const [o, h, l, c, pc] = [r[col.OpnPric], r[col.HghPric], r[col.LwPric], r[col.ClsPric], r[col.PrvsClsgPric]].map(paise)
    if (!(o && h && l && c) || h < l) continue
    date ??= /^\d{4}-\d{2}-\d{2}$/.test(r[col.TradDt]) ? r[col.TradDt] : null
    out.push({
      id: `BSE:${r[col.FinInstrmId]}`, ex: 'BSE', sym: r[col.TckrSymb], isin: r[col.ISIN] || undefined, name: r[col.FinInstrmNm] || undefined,
      o, h, l, c, pc, v: int(r[col.TtlTradgVol]),
    })
  }
  return { date, rows: out }
}
