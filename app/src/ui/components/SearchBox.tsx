import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../../store'
import { UNIVERSE } from '../../providers/universe'
import { loadMaster, rankMatches, type MasterRow } from '../../providers/breeze/master'

type Hit = {
  id: string
  symbol: string
  name: string
  ex: 'NSE' | 'BSE'
  /** Where the price data comes from if you open it. */
  kind: 'tracked' | 'market' | 'breeze'
  sector?: string
  row?: MasterRow
}

const KIND_LABEL: Record<Hit['kind'], string> = { tracked: 'Tracked', market: 'End-of-day', breeze: 'On demand' }

/**
 * Global stock search across NSE and BSE. The market list (every liquid stock on both exchanges) is a small file, so searching
 * costs no price download. Opening a stock outside the tracked 50 then loads that exchange's data once (about 6 MB, cached),
 * or, for NSE stocks when Breeze is connected, fetches just that stock.
 */
export function SearchBox() {
  const sessionOn = useApp(s => !!s.breeze.session && s.source === 'breeze')
  const index = useApp(s => s.searchIndex)
  const loadSearchIndex = useApp(s => s.loadSearchIndex)
  const openChart = useApp(s => s.openChart)
  const openStock = useApp(s => s.openStock)
  const openMarketStock = useApp(s => s.openMarketStock)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [master, setMaster] = useState<MasterRow[] | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    void loadSearchIndex()
    // Breeze's own NSE list also covers illiquid names the market list leaves out.
    if (sessionOn && !master) loadMaster().then(setMaster).catch(() => setMaster([]))
  }, [open, sessionOn, master, loadSearchIndex])

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const all = useMemo<Hit[]>(() => {
    const tracked = new Set(UNIVERSE.map(i => `NSE:${i.symbol}`))
    const out = new Map<string, Hit>()
    for (const i of UNIVERSE) out.set(`NSE:${i.symbol}`, { id: `NSE:${i.symbol}`, symbol: i.symbol, name: i.name, ex: 'NSE', kind: 'tracked', sector: i.sector })
    for (const [id, symbol, name, , sector] of index ?? []) {
      if (out.has(id)) continue
      out.set(id, { id, symbol, name: name || symbol, ex: id.startsWith('BSE:') ? 'BSE' : 'NSE', kind: 'market', sector: sector || undefined })
    }
    for (const r of master ?? []) {
      const id = `NSE:${r.symbol}`
      if (!out.has(id) && !tracked.has(id)) out.set(id, { id, symbol: r.symbol, name: r.name, ex: 'NSE', kind: 'breeze', row: r })
    }
    return [...out.values()]
  }, [index, master])

  const hits = useMemo(() => (q.trim() ? rankMatches(all, q, h => h.symbol, h => h.name, 10) : []), [q, all])

  const pick = (h: Hit) => {
    setOpen(false)
    setQ('')
    if (h.kind === 'tracked') openChart(h.id)
    else if (h.kind === 'breeze' && h.row) void openStock(h.row)
    else void openMarketStock(h.id)
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
          placeholder="Search NSE and BSE stocks" aria-label="Search stocks"
          value={q} onFocus={() => setOpen(true)} onKeyDown={onKey}
          onChange={e => { setQ(e.target.value); setOpen(true); setCursor(0) }}
        />
      </div>
      {open && q.trim() && (
        <ul className="card absolute inset-x-0 top-full z-40 mt-1.5 max-h-96 overflow-y-auto !bg-panel p-1 shadow-2xl" role="listbox">
          {!index && <li className="px-3 py-2 text-xs text-mute">Loading the NSE and BSE stock list…</li>}
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === cursor}>
              <button
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${i === cursor ? 'bg-panel2' : 'hover:bg-panel2/60'}`}
                onMouseEnter={() => setCursor(i)} onClick={() => pick(h)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{h.symbol}</span>
                  <span className="block truncate text-xs text-mute">{h.name}{h.sector ? ` · ${h.sector}` : ''}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className={`chip !py-0 text-[10px] ${h.ex === 'BSE' ? 'text-warn' : 'text-accent'}`}>{h.ex}</span>
                  <span className="text-[10px] text-mute">{KIND_LABEL[h.kind]}</span>
                </span>
              </button>
            </li>
          ))}
          {hits.length === 0 && index && <li className="px-3 py-3 text-xs text-mute">No match. Try a symbol or part of the company name.</li>}
          {hits.length > 0 && !index && <li className="border-t border-line/60 px-3 py-2 text-[11px] text-mute">Showing tracked stocks only: the full list could not be loaded.</li>}
        </ul>
      )}
    </div>
  )
}
