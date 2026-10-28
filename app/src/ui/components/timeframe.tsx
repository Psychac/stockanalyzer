import { useEffect, useMemo, useState } from 'react'
import type { Candle, CandleSet, Timeframe } from '../../domain/types'
import { CHART_TFS, aggregate, isIntraday } from '../../domain/timeframes'
import { isMarketOpen } from '../../domain/time'
import { IntradayError, fetchIntraday, intradayAvailable, mergeBars, upstoxKey } from '../../market/intraday'
import { useApp } from '../../store'

const KEY = 'chartTf'
const VALID = new Set(CHART_TFS.map(t => t.key))

/** The chosen timeframe, remembered on this device. */
export function useChartTimeframe(): [Timeframe, (t: Timeframe) => void] {
  const [tf, setTf] = useState<Timeframe>(() => {
    try { const v = localStorage.getItem(KEY) as Timeframe | null; return v && VALID.has(v) ? v : '1D' } catch { return '1D' }
  })
  const change = (t: Timeframe) => { setTf(t); try { localStorage.setItem(KEY, t) } catch { /* not persisted */ } }
  return [tf, change]
}

export interface TimeframeData {
  /** The bars to draw, or null while loading or when unavailable. */
  view: CandleSet | null
  loading: boolean
  error: string | null
}

const REFRESH_MS = 45_000

/**
 * Bars for the chosen timeframe. Daily is the source series itself; weekly and monthly are rolled up from it; intraday is
 * fetched for this one chart only, then refreshed every 45 s while the market is open and the page is visible.
 */
export function useTimeframeData(set: CandleSet | undefined, tf: Timeframe): TimeframeData {
  const isinFor = useApp(s => s.isinFor)
  const [intra, setIntra] = useState<{ key: string; set: CandleSet } | null>(null)
  const [state, setState] = useState<{ key: string; loading: boolean; error: string | null }>({ key: '', loading: false, error: null })
  const id = set?.instrument.id
  const key = `${id}|${tf}`
  const wantsIntraday = isIntraday(tf)

  const derived = useMemo(() => {
    if (!set || wantsIntraday) return null
    if (tf === '1D') return set
    return { ...set, timeframe: tf, candles: aggregate(set.candles, tf as '1W' | '1M', Date.now()) }
  }, [set, tf, wantsIntraday])

  useEffect(() => {
    if (!set || !wantsIntraday || !intradayAvailable(tf)) return
    // Demo prices are synthetic. Real intraday candles beside them would show two different prices for one stock.
    if (set.source === 'demo') {
      setState({ key, loading: false, error: 'Demo prices are synthetic, so real intraday candles are not shown with them. Choose a live data source in Settings, or open the stock from search or a market-wide scan. Daily, weekly and monthly work.' })
      return
    }
    const upstox = upstoxKey(set.instrument, isinFor(set.instrument.id))
    if (!upstox) {
      setState({ key, loading: false, error: 'Intraday candles need this stock\'s ISIN, which is not available yet. Daily, weekly and monthly work.' })
      return
    }
    let cancelled = false
    let bars: Candle[] = []
    const publish = (b: Candle[]) => setIntra({ key, set: { ...set, timeframe: tf, candles: b, asOf: b[b.length - 1].t } })
    setState({ key, loading: true, error: null })
    fetchIntraday(upstox, tf, Date.now())
      .then(b => { if (cancelled) return; bars = b; publish(b); setState({ key, loading: false, error: null }) })
      .catch(e => { if (!cancelled) setState({ key, loading: false, error: e instanceof IntradayError || e instanceof Error ? e.message : String(e) }) })
    const timer = setInterval(() => {
      if (cancelled || !bars.length || !isMarketOpen(Date.now()) || document.visibilityState !== 'visible') return
      fetchIntraday(upstox, tf, Date.now(), undefined, true)
        .then(fresh => { if (!cancelled) { bars = mergeBars(bars, fresh); publish(bars) } })
        .catch(() => { /* keep what is on screen; the next refresh tries again */ })
    }, REFRESH_MS)
    return () => { cancelled = true; clearInterval(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tf, wantsIntraday])

  if (!wantsIntraday) return { view: derived, loading: false, error: null }
  const mine = state.key === key
  return { view: intra && intra.key === key ? intra.set : null, loading: !mine || state.loading, error: mine ? state.error : null }
}

/** 1m 5m 15m 30m 1h | 1D 1W 1M */
export function TimeframeBar({ tf, onChange }: { tf: Timeframe; onChange: (t: Timeframe) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Timeframe">
      {CHART_TFS.map((t, i) => (
        <span key={t.key} className="flex items-center gap-1">
          {i > 0 && CHART_TFS[i - 1].intraday !== t.intraday && <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />}
          <button
            onClick={() => onChange(t.key)} aria-pressed={tf === t.key}
            className={`rounded-md px-2 py-1 text-xs font-medium transition ${tf === t.key ? 'bg-accent/15 text-accent' : 'text-mute hover:bg-panel2 hover:text-ink'}`}
          >{t.label}</button>
        </span>
      ))}
    </div>
  )
}

export const TF_NAME: Record<Timeframe, string> = { '1m': '1-minute', '5m': '5-minute', '15m': '15-minute', '30m': '30-minute', '1h': 'Hourly', '1D': 'Daily', '1W': 'Weekly', '1M': 'Monthly' }
