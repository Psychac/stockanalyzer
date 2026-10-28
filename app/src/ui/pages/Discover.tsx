import { useMemo, useRef, useState } from 'react'
import { allScanners, useApp } from '../../store'
import { PRESETS, REQUIRES_LABEL, blankScanner, duplicateScanner, isPreset } from '../../domain/presets'
import { scannerSchema, ruleLabel, fmtNum, type Group, type NodeResult, type Node, type ScannerConfig, type ScanResult } from '../../domain/scanner'
import { DataBadge, Disclaimer, Empty, ExchangeTag, PageHeader, ScoreRing, StarButton } from '../components/bits'
import { ScannerBuilder } from '../components/ScannerBuilder'
import { dateTime, pct, price, tone } from '../format'

function Tree({ n }: { n: NodeResult }) {
  if (n.type === 'rule') {
    return (
      <li className="flex gap-2 py-1 text-xs">
        <span className={`mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] ${n.missing ? 'bg-warn/20 text-warn' : n.pass ? 'bg-up/20 text-up' : 'bg-down/15 text-down'}`}>{n.missing ? '?' : n.pass ? '✓' : '✗'}</span>
        <span className="min-w-0"><span>{n.label}</span><span className="num ml-2 text-mute">{n.missing ? 'not enough history' : `${fmtNum(n.left)} vs ${fmtNum(n.right)}`}</span></span>
      </li>
    )
  }
  return (
    <li className="py-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-mute">{n.mode === 'ALL' ? 'All of' : 'Any of'} <span className={n.pass ? 'text-up' : 'text-down'}>{n.pass ? 'pass' : 'fail'}</span></div>
      <ul className="ml-2 border-l border-line pl-3">{n.children.map(c => <Tree key={c.id} n={c} />)}</ul>
    </li>
  )
}

function Rules({ n, depth = 0 }: { n: Node; depth?: number }) {
  if (!n.enabled) return null
  if (n.type === 'rule') return <li className="py-0.5 text-sm text-mute">{ruleLabel(n)}</li>
  return (
    <li className="py-0.5">
      {(depth > 0 || n.children.length > 1) && <div className="text-[11px] font-semibold uppercase tracking-wide text-accent">{n.mode === 'ALL' ? 'All of' : 'Any of'}</div>}
      <ul className={depth > 0 ? 'ml-2 border-l border-line pl-3' : ''}>{n.children.map(c => <Rules key={c.id} n={c} depth={depth + 1} />)}</ul>
    </li>
  )
}

function ResultRow({ r, source }: { r: ScanResult; source: string }) {
  const [open, setOpen] = useState(false)
  const openChart = useApp(s => s.openChart)
  return (
    <li className={`border-b border-line/50 last:border-0 ${r.matched ? '' : 'opacity-60'}`}>
      <div className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition hover:bg-panel2/40" onClick={() => setOpen(!open)}>
        <ScoreRing score={r.matched ? r.score : null} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2"><span className="truncate font-semibold">{r.symbol}</span><ExchangeTag id={r.instrumentId} /><span className="chip hidden !py-0 text-[10px] sm:inline-flex">{r.sector}</span></div>
          <div className="truncate text-xs text-mute">{r.excludedBy ? `Excluded: ${r.excludedBy}` : r.name}</div>
        </div>
        <div className="num text-right"><div className="text-sm">₹{price(r.close)}</div><div className={`text-xs ${tone(r.changePct)}`}>{pct(r.changePct)}</div></div>
        <StarButton instrumentId={r.instrumentId} source={source} />
        <span className={`text-xs text-mute transition ${open ? 'rotate-90' : ''}`}>›</span>
      </div>
      {open && (
        <div className="grid gap-5 bg-bg/40 px-4 py-4 md:grid-cols-2">
          <div>
            <div className="label mb-1">Conditions</div>
            {r.tree ? <ul><Tree n={r.tree} /></ul> : <p className="text-xs text-mute">Not evaluated: {r.excludedBy}</p>}
          </div>
          <div>
            <div className="label mb-2">Setup score breakdown</div>
            {r.factors.length === 0 ? <p className="text-xs text-mute">No score for excluded stocks.</p> : (
              <ul className="space-y-2.5">
                {r.factors.map(f => (
                  <li key={f.key}>
                    <div className="flex justify-between text-xs"><span>{f.label} <span className="text-mute">×{f.weight}</span></span><span className="num">{f.score === null ? 'n/a' : Math.round(f.score)}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full bg-gradient-to-r from-accent to-up" style={{ width: `${f.score ?? 0}%` }} /></div>
                    <div className="mt-0.5 text-[11px] text-mute">{f.note}</div>
                  </li>
                ))}
              </ul>
            )}
            {r.warnings.map(w => <p key={w} className="mt-2 text-xs text-warn">⚠ {w}</p>)}
            <p className="mt-3 text-[11px] text-mute">Stock quality (fundamentals): not available. This score reflects the technical setup only.</p>
            <button className="btn btn-sm mt-3" onClick={() => openChart(r.instrumentId)}>Open chart &amp; trade plan →</button>
          </div>
        </div>
      )}
    </li>
  )
}

export function Discover() {
  const user = useApp(s => s.userScanners)
  const runs = useApp(s => s.runs)
  const status = useApp(s => s.marketStatus)
  const instruments = useApp(s => s.instruments)
  const benchmark = useApp(s => s.benchmark)
  const run = useApp(s => s.run)
  const runMarketScan = useApp(s => s.runMarketScan)
  const market = useApp(s => s.market)
  const scan = useApp(s => s.scan)
  const save = useApp(s => s.saveScanner)
  const del = useApp(s => s.deleteScanner)
  const scanners = useMemo(() => allScanners(user), [user])
  const [selId, setSelId] = useState(PRESETS[0].id)
  const [editing, setEditing] = useState<{ cfg: ScannerConfig; isNew: boolean } | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [universe, setUniverse] = useState<Universe>(() => {
    try { const v = localStorage.getItem('scanUniverse'); return v === 'NSE' || v === 'BSE' || v === 'ALL' || v === 'watchlist' ? v : 'NSE' } catch { return 'NSE' }
  })
  const [limit, setLimit] = useState(100)
  const [listedOnce, setListedOnce] = useState(() => { try { return localStorage.getItem('listedOnce') !== '0' } catch { return true } })
  const pickListedOnce = (v: boolean) => { setListedOnce(v); try { localStorage.setItem('listedOnce', v ? '1' : '0') } catch { /* not persisted */ } }
  const pickUniverse = (u: Universe) => { setUniverse(u); try { localStorage.setItem('scanUniverse', u) } catch { /* not persisted */ } }
  const [note, setNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLElement>(null)

  const sel = scanners.find(s => s.id === selId) ?? scanners[0]
  const lastRun = runs[sel.id]
  const stale = lastRun && lastRun.scannerVersion !== sel.version
  const marketSectors = useApp(s => s.marketSectors)
  // Live/demo stocks and the market-wide list name sectors differently; both are offered, and a stock matches on its own name.
  const sectors = useMemo(() => [...new Set([...instruments.map(i => i.sector), ...marketSectors])].sort(), [instruments, marketSectors])
  const matches = lastRun?.results.filter(r => r.matched) ?? []
  const shown = lastRun?.matchesOnly || !showAll ? matches : lastRun?.results ?? []
  const visible = shown.slice(0, limit)
  const blocked = sel.requires ? REQUIRES_LABEL[sel.requires] : null

  const marketScan = universe !== 'watchlist'
  const watchCount = useApp(s => s.shortlist.length)
  const scanning = !!scan || market.status === 'loading'
  const onRun = () => {
    setLimit(100)
    if (marketScan) void runMarketScan(sel, universe, { listedOnce })
    else void run(sel)
    // On a phone the results sit below the fold; bring them into view.
    if (window.innerWidth < 1024) setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
  }

  const edit = () => setEditing(isPreset(sel.id) ? { cfg: duplicateScanner(sel, `${sel.name} (mine)`), isNew: true } : { cfg: sel, isNew: false })
  const onSave = async (cfg: ScannerConfig) => { await save(cfg); setSelId(cfg.id); setEditing(null); setNote(null) }

  const exportOne = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([JSON.stringify(sel, null, 2)], { type: 'application/json' }))
    a.download = `scanner-${sel.name.toLowerCase().replace(/\W+/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const importOne = async (f: File) => {
    try {
      const parsed = scannerSchema.parse(JSON.parse(await f.text())) as ScannerConfig
      const copy = duplicateScanner(parsed, parsed.name)
      await save(copy)
      setSelId(copy.id)
      setNote(`Imported "${copy.name}".`)
    } catch (e) { setNote(`Import failed: ${e instanceof Error ? e.message.slice(0, 120) : 'invalid file'}`) }
  }

  return (
    <>
      <PageHeader
        title="Discover"
        subtitle="Scanners are saved configurations run by one shared engine. Built-in presets stay intact; edit a copy."
        actions={<>{universe !== 'watchlist' ? <span className="chip border-accent/40 text-accent"><span className="h-1.5 w-1.5 rounded-full bg-accent" />EOD · SHARED DATA</span> : <span className="hidden md:inline-flex"><DataBadge set={benchmark} /></span>}<button className="btn btn-primary" onClick={() => setEditing({ cfg: blankScanner(), isNew: true })}>+ New scanner</button></>}
      />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="lg:hidden">
          <label className="label mb-1.5 block px-1" htmlFor="scanner-pick">Scanner</label>
          <select id="scanner-pick" className="field !py-2.5 text-sm" value={sel.id} onChange={e => setSelId(e.target.value)}>
            <optgroup label="Presets">
              {scanners.filter(x => isPreset(x.id)).map(x => <option key={x.id} value={x.id}>{x.name}{x.requires ? ' (needs more data)' : ''}{runs[x.id] ? ` · ${runs[x.id].results.filter(r => r.matched).length} matches` : ''}</option>)}
            </optgroup>
            {scanners.some(x => !isPreset(x.id)) && (
              <optgroup label="My scanners">
                {scanners.filter(x => !isPreset(x.id)).map(x => <option key={x.id} value={x.id}>{x.name}{runs[x.id] ? ` · ${runs[x.id].results.filter(r => r.matched).length} matches` : ''}</option>)}
              </optgroup>
            )}
          </select>
          <div className="mt-2 flex items-center gap-2 px-1">
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>Import scanner</button>
            {note && <p className="text-xs text-mute">{note}</p>}
          </div>
        </div>

        <aside className="hidden space-y-1.5 lg:block">
          {([['Presets', scanners.filter(s => isPreset(s.id))], ['My scanners', scanners.filter(s => !isPreset(s.id))]] as const).map(([title, list]) => (
            <div key={title} className="mb-3">
              <div className="label mb-1.5 px-1">{title}</div>
              {list.length === 0 && <p className="px-1 text-xs text-mute">None yet. Edit a preset to make your own.</p>}
              <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
                {list.map(s => {
                  const r = runs[s.id]
                  const n = r?.results.filter(x => x.matched).length
                  return (
                    <button key={s.id} onClick={() => setSelId(s.id)} className={`card min-w-[200px] shrink-0 p-3 text-left transition lg:min-w-0 ${s.id === sel.id ? '!border-accent/60 !bg-panel2' : 'hover:!border-line hover:bg-panel2/50'}`}>
                      <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{s.name}</span>{n !== undefined && <span className="chip !py-0 text-accent">{n}</span>}</div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-mute">{s.requires ? REQUIRES_LABEL[s.requires] : s.description}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="flex gap-2 px-1">
            <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>Import</button>
          </div>
          {note && <p className="px-1 text-xs text-mute">{note}</p>}
        </aside>

        <div className="min-w-0 space-y-4">
          <section className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{sel.name} <span className="text-xs font-normal text-mute">v{sel.version}{isPreset(sel.id) ? ' · built-in' : ''}</span></h2>
                <p className="mt-1 max-w-xl text-sm text-mute">{sel.description}</p>
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                <button className="btn btn-primary order-first w-full !py-2.5 sm:order-last sm:w-auto sm:!py-2" disabled={!!blocked || scanning || (!marketScan && (status !== 'ready' || watchCount === 0))} onClick={onRun}>{scanning ? 'Scanning…' : lastRun ? 'Re-run scan' : 'Run scan'}</button>
                <button className="btn btn-sm sm:!px-3.5 sm:!py-2 sm:!text-sm" onClick={edit}>{isPreset(sel.id) ? 'Customize copy' : 'Edit'}</button>
                {!isPreset(sel.id) && <>
                  <button className="btn btn-sm sm:!px-3.5 sm:!py-2 sm:!text-sm" onClick={() => void save(duplicateScanner(sel)).then(() => setNote('Duplicated.'))}>Duplicate</button>
                  <button className="btn btn-sm text-down sm:!px-3.5 sm:!py-2 sm:!text-sm" onClick={() => { if (confirm(`Delete "${sel.name}"?`)) { void del(sel.id); setSelId(PRESETS[0].id) } }}>Delete</button>
                </>}
                <button className="btn btn-sm sm:!px-3.5 sm:!py-2 sm:!text-sm" onClick={exportOne}>Export</button>
              </div>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-xs text-mute">Rules &amp; universe</summary>
              <ul className="mt-2"><Rules n={sel.root as Group} /></ul>
              <p className="mt-2 text-xs text-mute">
                Universe: NSE · {sel.universe.minPrice !== null && `price ≥ ₹${sel.universe.minPrice} · `}{sel.universe.minAvgTradedValueCr !== null && `traded ≥ ₹${sel.universe.minAvgTradedValueCr} Cr/day · `}{sel.universe.sectors.length ? sel.universe.sectors.join(', ') : 'all sectors'}
              </p>
            </details>
            <UniversePicker universe={universe} onPick={pickUniverse} listedOnce={listedOnce} onListedOnce={pickListedOnce} />
            {marketScan && <MarketNote />}
            {blocked && <p className="mt-3 rounded-lg border border-warn/30 bg-warn/5 p-2.5 text-xs text-warn">{blocked}. This preset is shown for completeness and cannot run on the demo data source.</p>}
          </section>

          {!lastRun && !blocked && !scanning && <Empty icon="⌕" title="Run this scanner">{marketScan ? 'Evaluates every liquid stock in the selected exchange(s) on the latest end-of-day close.' : watchCount === 0 ? 'Your watchlist is empty. Star stocks from search or scan results, or choose All NSE or All BSE.' : `Evaluates the ${watchCount} stock${watchCount === 1 ? '' : 's'} on your watchlist against the rules on the latest candle.`}</Empty>}
          {scanning && <ScanProgress />}

          {lastRun && (
            <section ref={resultsRef} className="card scroll-mt-4 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 px-4 py-3">
                <div>
                  <div className="font-semibold">{matches.length} match{matches.length === 1 ? '' : 'es'} <span className="font-normal text-mute">of {lastRun.universeSize}{lastRun.universe ? ` · ${lastRun.universe}` : ''}</span></div>
                  <div className="text-[11px] text-mute">Ran {dateTime(lastRun.ranAt)} · config v{lastRun.scannerVersion} · {lastRun.source === 'demo' ? 'demo data' : lastRun.source === 'market' ? 'end-of-day data' : 'live data'}{stale && <span className="ml-1 text-warn">· scanner changed since this run, re-run</span>}</div>
                </div>
                {!lastRun.matchesOnly && <label className="flex cursor-pointer items-center gap-2 text-xs text-mute"><input type="checkbox" className="accent-[var(--color-accent)]" checked={showAll} onChange={e => setShowAll(e.target.checked)} />Show non-matches</label>}
              </div>
              {shown.length === 0 ? <p className="px-4 py-10 text-center text-sm text-mute">No stocks match right now. Loosen a condition or show non-matches to see which rule failed.</p> : (
                <>
                  <ul>{visible.map(r => <ResultRow key={r.instrumentId} r={r} source={sel.name} />)}</ul>
                  {shown.length > visible.length && <div className="border-t border-line/60 p-3 text-center"><button className="btn btn-sm" onClick={() => setLimit(limit + 100)}>Show {Math.min(100, shown.length - visible.length)} more ({shown.length - visible.length} left, best scores first)</button></div>}
                </>
              )}
            </section>
          )}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="application/json" className="sr-only" tabIndex={-1} onChange={e => { const f = e.target.files?.[0]; if (f) void importOne(f); e.target.value = '' }} />
      <div className="mt-6"><Disclaimer /></div>

      {editing && <ScannerBuilder initial={editing.cfg} isNew={editing.isNew} sectors={sectors} onSave={cfg => void onSave(cfg)} onCancel={() => setEditing(null)} />}
    </>
  )
}

type Universe = 'watchlist' | 'NSE' | 'BSE' | 'ALL'

function UniversePicker({ universe, onPick, listedOnce, onListedOnce }: { universe: Universe; onPick: (u: Universe) => void; listedOnce: boolean; onListedOnce: (v: boolean) => void }) {
  const counts = useApp(s => s.market.counts)
  const watchCount = useApp(s => s.shortlist.length)
  const opts: { key: Universe; label: string; hint?: string }[] = [
    { key: 'NSE', label: 'All NSE', hint: counts.NSE ? `${counts.NSE.toLocaleString('en-IN')}` : undefined },
    { key: 'BSE', label: 'All BSE', hint: counts.BSE ? `${counts.BSE.toLocaleString('en-IN')}` : undefined },
    { key: 'ALL', label: 'Both' },
    { key: 'watchlist', label: 'My watchlist', hint: watchCount ? String(watchCount) : 'empty' },
  ]
  return (
    <div className="mt-4">
      <div className="label mb-1.5">Stock universe</div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Stock universe">
        {opts.map(o => (
          <button key={o.key} role="radio" aria-checked={universe === o.key} onClick={() => onPick(o.key)}
            className={`chip cursor-pointer !py-1 text-xs transition ${universe === o.key ? 'border-accent/60 bg-accent/10 text-accent' : 'hover:text-ink'}`}>
            {o.label}{o.hint && <span className="text-mute"> · {o.hint}</span>}
          </button>
        ))}
      </div>
      {universe === 'ALL' && (
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-mute">
          <input type="checkbox" className="mt-0.5 accent-[var(--color-accent)]" checked={listedOnce} onChange={e => onListedOnce(e.target.checked)} />
          <span>Count each company once. A company listed on both exchanges (same ISIN) is shown only as its NSE listing, so results are not doubled.</span>
        </label>
      )}
    </div>
  )
}

/** Explains what a market-wide scan uses, and what it costs the first time. */
function MarketNote() {
  const market = useApp(s => s.market)
  const index = useApp(s => s.searchIndex)
  const withSector = index ? index.filter(i => i[4]).length : 0
  return (
    <div className="mt-3 rounded-lg border border-line/70 bg-bg/40 p-2.5 text-xs text-mute">
      Uses end-of-day data from your shared backend (NSE and BSE files, liquid stocks only), screened on this device. The first scan downloads
      about 6 MB per exchange once; after that only each day&rsquo;s small update is fetched. Stocks scanned this way have end-of-day prices only.
      {index && <span> Industry is known for {withSector.toLocaleString('en-IN')} of {index.length.toLocaleString('en-IN')} stocks (the free Nifty list, mostly the largest companies); the rest are Unclassified, so choosing a sector leaves them out.</span>}
      {market.date && <span className="text-ink"> Data as of {market.date}.</span>}
      {market.status === 'error' && market.message && <span className="mt-1 block text-down">{market.message}</span>}
      {market.status === 'ready' && market.message && <span className="mt-1 block text-warn">{market.message}</span>}
    </div>
  )
}

function ScanProgress() {
  const market = useApp(s => s.market)
  const scan = useApp(s => s.scan)
  const downloading = market.status === 'loading' && !scan
  const p = downloading ? (market.progress && market.progress.total ? market.progress.loaded / market.progress.total : 0) : scan ? scan.done / Math.max(1, scan.total) : 0
  const text = downloading
    ? `Downloading market data${market.progress?.total ? ` (${(market.progress.loaded / 1048576).toFixed(1)} of ${(market.progress.total / 1048576).toFixed(1)} MB)` : '…'}`
    : scan ? `Scanning ${scan.label}: ${scan.done.toLocaleString('en-IN')} of ${scan.total.toLocaleString('en-IN')} stocks` : 'Working…'
  return (
    <section className="card p-4" aria-live="polite">
      <div className="flex justify-between text-sm"><span>{text}</span><span className="num text-mute">{Math.round(p * 100)}%</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full bg-linear-to-r from-accent to-up transition-all" style={{ width: `${p * 100}%` }} /></div>
    </section>
  )
}
