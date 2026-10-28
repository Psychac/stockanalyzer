import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../store'
import { UNIVERSE } from '../../providers/universe'
import { loadMaster, rankMatches, type MasterRow } from '../../providers/breeze/master'

type Hit = { symbol: string; name: string; tracked: boolean; row?: MasterRow }

/**
 * Global stock search. On Breeze it searches every NSE equity (the instrument master loads on first use) and opens a
 * stock outside the tracked 50 by fetching its history on demand. On other sources it searches the tracked stocks only.
 */
export function SearchBox() {
  const source = useApp(s => s.source)
  const sessionOn = useApp(s => !!s.breeze.session)
  const openChart = useApp(s => s.openChart)
  const openStock = useApp(s => s.openStock)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [master, setMaster] = useState<MasterRow[] | null>(null)
  const [masterError, setMasterError] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const all = source === 'breeze' && sessionOn

  useEffect(() => {
    if (!all || !open || master || masterError) return
    loadMaster().then(setMaster).catch(() => setMasterError(true))
  }, [all, open, master, masterError])

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const trackedIds = useMemo(() => new Set(UNIVERSE.map(i => i.symbol)), [])
  const hits = useMemo<Hit[]>(() => {
    if (!q.trim()) return []
    if (all && master) return rankMatches(master, q, r => r.symbol, r => r.name, 8).map(r => ({ symbol: r.symbol, name: r.name, tracked: trackedIds.has(r.symbol), row: r }))
    return rankMatches(UNIVERSE, q, i => i.symbol, i => i.name, 8).map(i => ({ symbol: i.symbol, name: i.name, tracked: true }))
  }, [q, all, master, trackedIds])

  const pick = (h: Hit) => {
    setOpen(false)
    setQ('')
    if (h.tracked || !h.row) openChart(`NSE:${h.symbol}`)
    else void openStock(h.row)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, hits.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter' && hits[cursor]) { e.preventDefault(); pick(hits[cursor]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={box} className="relative w-full md:max-w-md">
      <div className="relative">
        <svg viewBox="0 0 24 24" fill="currentColor" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute">
          <path d="M10 2a8 8 0 1 0 4.9 14.3l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0 0 10 2Zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z" />
        </svg>
        <input
          className="field !pl-9" type="search" inputMode="search" autoComplete="off" autoCapitalize="characters" spellCheck={false}
          placeholder={all ? 'Search any NSE stock' : 'Search tracked stocks'} aria-label="Search stocks"
          value={q} onFocus={() => setOpen(true)} onKeyDown={onKey}
          onChange={e => { setQ(e.target.value); setOpen(true); setCursor(0) }}
        />
      </div>
      {open && q.trim() && (
        <ul className="card absolute inset-x-0 top-full z-40 mt-1.5 max-h-80 overflow-y-auto !bg-panel p-1 shadow-2xl" role="listbox">
          {all && !master && !masterError && <li className="px-3 py-3 text-xs text-mute">Loading the NSE stock list…</li>}
          {masterError && <li className="px-3 py-3 text-xs text-warn">Could not load the full stock list. Searching tracked stocks only.</li>}
          {hits.map((h, i) => (
            <li key={h.symbol} role="option" aria-selected={i === cursor}>
              <button
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${i === cursor ? 'bg-panel2' : 'hover:bg-panel2/60'}`}
                onMouseEnter={() => setCursor(i)} onClick={() => pick(h)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{h.symbol}</span>
                  <span className="block truncate text-xs text-mute">{h.name}</span>
                </span>
                {all && <span className={`chip !py-0 text-[10px] ${h.tracked ? '' : 'text-accent'}`}>{h.tracked ? 'Tracked' : 'On demand'}</span>}
              </button>
            </li>
          ))}
          {hits.length === 0 && (!all || master) && <li className="px-3 py-3 text-xs text-mute">No match. Try a symbol or part of the company name.</li>}
          {!all && <li className="border-t border-line/60 px-3 py-2 text-[11px] text-mute">Only the tracked stocks can be searched on this data source. Connect ICICI Breeze to search every NSE stock.</li>}
        </ul>
      )}
    </div>
  )
}
