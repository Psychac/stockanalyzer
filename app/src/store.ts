import { create } from 'zustand'
import type { CandleSet, DataSource, Instrument } from './domain/types'
import { runScanner, runScannerLazy, scannerSchema, type ScannerConfig, type ScanRun } from './domain/scanner'
import { PRESETS, isPreset } from './domain/presets'
import { isMarketOpen } from './domain/time'
import {
  DEFAULT_SETTINGS, cacheFor, marketCache, clearSession, db, loadBreeze, loadCredentials, loadDataSource, loadSettings, saveBreeze, saveCredentials, saveDataSource, saveSettings,
  type Settings, type ShortlistItem, type ShortlistStatus,
} from './db/db'
import { demoProvider } from './providers/demo'
import { BENCHMARK, UNIVERSE } from './providers/universe'
import { FyersClient } from './providers/fyers/client'
import { FyersProvider } from './providers/fyers/provider'
import { applyQuote, finalizeCandles } from './providers/candles'
import { ProviderError } from './providers/errors'
import { beginLogin, completeLoginFromUrl } from './providers/fyers/auth'
import type { FyersSession } from './providers/fyers/types'
import { BreezeClient } from './providers/breeze/client'
import { BreezeProvider } from './providers/breeze/provider'
import { BREEZE_INDICES } from './providers/breeze/codes'
import { BENCHMARK_FOR, MarketUnavailable, fetchIndexBars, fetchManifest, fetchSearchIndex, realNet, syncExchange, toCandleSet, type SearchItem } from './market/client'
import type { Exchange, History } from '../api/_lib/data/history'
import { loadMaster } from './providers/breeze/master'
import type { Candle } from './domain/types'
import { adoptRow, type MasterRow } from './providers/breeze/master'
import { indexLevel, type IndexLevel } from './indices'
import { lastSessionClose } from './domain/time'
import { beginLogin as beginBreezeLogin, completeLoginFromUrl as completeBreezeLogin, defaultAppKey, exchangeSession, helperInfo, type BreezeSession } from './providers/breeze/session'
import { loadMarket } from './providers/loader'
import type { MarketDataProvider } from './providers/types'

export type Route = 'dashboard' | 'discover' | 'shortlist' | 'charts' | 'journal' | 'news' | 'settings'
export const ROUTES: Route[] = ['dashboard', 'discover', 'shortlist', 'charts', 'journal', 'news', 'settings']

const DEMO_BARS = 400
/** One year of dailies fits a single FYERS history request. */
const LIVE_BARS = 250
/** FYERS quotes cost API calls, so poll gently. Breeze ticks arrive over a socket and polling them is free. */
const POLL_MS: Record<'fyers' | 'breeze', number> = { fyers: 60_000, breeze: 4_000 }

/**
 * What the user is looking at (spec §5.5). `live` = refreshed from the provider this session;
 * `cached` = served from this device with no working connection; `stale` = a refresh failed part-way.
 */
export type FeedMode = 'demo' | 'live' | 'cached' | 'stale' | 'none'
export interface Feed {
  mode: FeedMode
  /** Last successful network refresh (history or quotes). */
  updatedAt: number | null
  message: string | null
  progress: { done: number; total: number } | null
}
const NO_FEED: Feed = { mode: 'none', updatedAt: null, message: null, progress: null }

interface State {
  route: Route
  chartSymbol: string | null
  source: DataSource
  provider: MarketDataProvider
  marketStatus: 'loading' | 'ready' | 'error'
  marketError: string | null
  feed: Feed
  fyers: { appId: string; hasSecret: boolean; session: FyersSession | null; loginError: string | null }
  breeze: { appKey: string; session: BreezeSession | null; loginError: string | null; helper: 'unknown' | 'ok' | 'missing'; needsCode: boolean }
  instruments: Instrument[]
  sets: Map<string, CandleSet>
  benchmark: CandleSet | null
  /** Stocks opened from search that are outside the tracked universe. Never fed to scanners. */
  extras: Map<string, CandleSet>
  extraStatus: { id: string; state: 'loading' | 'error'; message?: string } | null
  indexLevels: IndexLevel[]
  /** Market-wide end-of-day data from the shared backend (NSE and BSE). Held outside the store: it is large. */
  market: { status: 'idle' | 'loading' | 'ready' | 'error'; message: string | null; progress: { loaded: number; total: number } | null; date: string | null; counts: Partial<Record<Exchange, number>> }
  scan: { done: number; total: number; label: string } | null
  /** Every liquid NSE and BSE stock (symbol, name, ISIN, industry), for search and sector filters. Loaded on demand, tens of KB. */
  searchIndex: SearchItem[] | null
  marketSectors: string[]
  userScanners: ScannerConfig[]
  shortlist: ShortlistItem[]
  settings: Settings
  runs: Record<string, ScanRun>

  init: () => Promise<void>
  go: (r: Route) => void
  openChart: (instrumentId: string) => void
  /** Open any NSE stock from search. Outside the tracked universe it is fetched on demand (Breeze only). */
  openStock: (row: MasterRow | { symbol: string }) => Promise<void>
  loadMarket: () => Promise<void>
  loadMarketData: (exchanges: Exchange[]) => Promise<boolean>
  /** `listedOnce` skips a BSE listing when the same company (by ISIN) is also on NSE, so "Both" does not count it twice. */
  runMarketScan: (cfg: ScannerConfig, universe: 'NSE' | 'BSE' | 'ALL', opts?: { listedOnce?: boolean }) => Promise<void>
  loadSearchIndex: () => Promise<void>
  /** Open any market stock. If its exchange's data is not on this device yet, download it first (about 6 MB, once). */
  openMarketStock: (id: string) => Promise<void>
  /** Candles for any stock the app can show: tracked, opened from search, or in the market-wide data. */
  setFor: (id: string) => CandleSet | undefined
  setSource: (s: DataSource) => Promise<void>
  connectFyers: (appId: string, secret: string, remember: boolean) => void
  disconnectFyers: () => Promise<void>
  connectBreeze: (appKey: string) => void
  connectBreezeWithCode: (appKey: string, apiSession: string) => Promise<void>
  disconnectBreeze: () => Promise<void>
  checkBreezeHelper: () => Promise<void>
  saveScanner: (s: ScannerConfig) => Promise<void>
  deleteScanner: (id: string) => Promise<void>
  run: (s: ScannerConfig) => ScanRun
  addToShortlist: (instrumentId: string, source: string) => Promise<void>
  updateShortlist: (instrumentId: string, patch: Partial<Pick<ShortlistItem, 'status' | 'note'>>) => Promise<void>
  removeFromShortlist: (instrumentId: string) => Promise<void>
  setSettings: (s: Settings) => Promise<void>
  reloadUserData: () => Promise<void>
}

const fromHash = (): Route => {
  const h = location.hash.replace('#/', '').split('/')[0] as Route
  return ROUTES.includes(h) ? h : 'dashboard'
}

const sessionValid = (s: { expiresAt: number } | null, now = Date.now()) => !!s && s.expiresAt > now
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

let pollTimer: ReturnType<typeof setInterval> | null = null
let streaming: BreezeProvider | null = null
let streamStartedAt = 0
/** Give the socket this long to connect and deliver a first tick before warning that prices are not arriving. */
const STREAM_GRACE_MS = 20_000
const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  streaming?.stopStream()
  streaming = null
}

export const useApp = create<State>((set, get) => {

  /** The provider for the selected source, or null when there is no usable session. */
  const liveProvider = (): MarketDataProvider | null => {
    const { source, fyers, breeze } = get()
    if (source === 'fyers' && sessionValid(fyers.session)) {
      const sess = fyers.session!
      return new FyersProvider(new FyersClient(() => ({ appId: sess.appId, accessToken: sess.accessToken })))
    }
    if (source === 'breeze' && sessionValid(breeze.session)) {
      const sess = breeze.session!
      return new BreezeProvider(new BreezeClient(() => sess), sess)
    }
    return null
  }
  const activeSession = () => {
    const { source, fyers, breeze } = get()
    return source === 'fyers' ? fyers.session : source === 'breeze' ? breeze.session : null
  }

  async function onAuthLost(message: string) {
    stopPolling()
    if (get().source === 'breeze') {
      await saveBreeze({ appKey: get().breeze.appKey })
      set({ breeze: { ...get().breeze, session: null } })
    } else {
      await clearSession()
      set({ fyers: { ...get().fyers, session: null } })
    }
    set({ feed: { ...get().feed, mode: get().sets.size ? 'cached' : 'none', message } })
  }

  /** What was last folded into the candles per instrument, so a repeated tick is not re-applied or re-rendered. */
  const applied = new Map<string, string>()
  const eodIndexCandles = new Map<string, CandleSet['candles']>()
  /** Index history published by the shared backend (Nifty, Sensex, ...), kept apart so switching sources does not lose it. */
  const backendIndices = new Map<string, Candle[]>()
  let indexList: { id: string; name: string }[] = BREEZE_INDICES.map(i => ({ id: i.id, name: i.name }))
  let indicesReady: Promise<void> = Promise.resolve()
  const marketHist: Partial<Record<Exchange, History>> = {}
  const marketDate: Partial<Record<Exchange, string>> = {}
  let nseNames: Map<string, string> | undefined
  let scanRunning = false
  let searchLoading = false

  function recomputeIndices(now = Date.now()) {
    const ticks = new Map((streaming?.liveIndices() ?? []).map(t => [t.id, t]))
    const levels = indexList.map(ix => indexLevel(ix.id, ix.name, eodIndexCandles.get(ix.id), ticks.get(ix.id), now)).filter((l): l is IndexLevel => !!l)
    const prev = get().indexLevels
    const same = levels.length === prev.length && levels.every((l, i) => l.ltp === prev[i].ltp && l.live === prev[i].live && l.prevClose === prev[i].prevClose)
    if (!same) set({ indexLevels: levels })
  }

  /** Daily index bars for the dashboard strip: cache-first, a handful of calls per session. */
  /** Small file, so it loads at startup for every data source: gives Sensex and the other indices without any broker. */
  async function loadMarketIndices() {
    try {
      const items = await fetchIndexBars(await fetchManifest())
      if (!items.length) return
      for (const i of items) { backendIndices.set(i.id, i.candles); eodIndexCandles.set(i.id, i.candles) }
      indexList = items.map(({ id, name }) => ({ id, name }))
      recomputeIndices()
    } catch { /* the strip falls back to Breeze, or stays empty */ }
  }

  async function loadIndexLevels(provider: BreezeProvider, now: number) {
    await indicesReady
    if (backendIndices.size >= 4) { recomputeIndices(now); return } // already have them without spending Breeze calls
    const cache = cacheFor('breeze')
    const need = lastSessionClose(now)
    for (const ix of BREEZE_INDICES) {
      const key = `IDX:${ix.id}`
      const cached = await cache.get(key)
      let candles = cached?.candles
      if (!cached || cached.fetchedAt < need) {
        try {
          candles = await provider.getIndexCandles(ix.code, now - 14 * 86_400_000)
          if (candles.length) await cache.put(key, candles, now)
        } catch (e) {
          if (e instanceof ProviderError && (e.kind === 'auth' || e.kind === 'rate')) break
        }
      }
      if (candles?.length) eodIndexCandles.set(ix.id, candles)
    }
    recomputeIndices(now)
  }

  async function pollQuotes() {
    const { source, sets, extras, benchmark, provider } = get()
    const now = Date.now()
    if (source === 'demo' || !sessionValid(activeSession(), now) || !isMarketOpen(now) || document.visibilityState !== 'visible') return
    try {
      const quotes = await provider.getQuotes([...UNIVERSE, BENCHMARK, ...[...extras.values()].map(e => e.instrument)])
      recomputeIndices(now)
      if (quotes.length === 0) {
        const failed = streaming?.stream?.state === 'error'
        if (!failed && now - streamStartedAt < STREAM_GRACE_MS) return
        const why = streaming?.stream?.message ?? 'no prices have arrived yet'
        set({ feed: { ...get().feed, mode: 'stale', message: `Live prices are not arriving (${why}). Showing end-of-day data.` } })
        return
      }
      const fresh = quotes.filter(q => {
        const key = `${q.ltp}|${q.at}|${q.high}|${q.low}|${q.volume}`
        if (applied.get(q.instrumentId) === key) return false
        applied.set(q.instrumentId, key)
        return true
      })
      if (fresh.length) {
        const nextSets = new Map(sets)
        const nextExtras = new Map(extras)
        let nextBench = benchmark
        for (const q of fresh) {
          if (q.instrumentId === BENCHMARK.id && nextBench) nextBench = { ...nextBench, candles: applyQuote(nextBench.candles, q, now), asOf: q.at }
          const cur = nextSets.get(q.instrumentId)
          if (cur) nextSets.set(q.instrumentId, { ...cur, candles: applyQuote(cur.candles, q, now), asOf: q.at })
          const ex = nextExtras.get(q.instrumentId)
          if (ex) nextExtras.set(q.instrumentId, { ...ex, candles: applyQuote(ex.candles, q, now), asOf: q.at })
        }
        set({ sets: nextSets, extras: nextExtras, benchmark: nextBench })
      }
      const f = get().feed
      if (f.mode !== 'live' || f.message || fresh.length) set({ feed: { ...f, mode: 'live', updatedAt: fresh.length ? now : f.updatedAt, message: null } })
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'auth') await onAuthLost(e.message)
      else set({ feed: { ...get().feed, mode: 'stale', message: `Live updates paused: ${errText(e)}` } })
    }
  }

  const countsOf = () => ({ ...(marketHist.NSE ? { NSE: Object.keys(marketHist.NSE.stocks).length } : {}), ...(marketHist.BSE ? { BSE: Object.keys(marketHist.BSE.stocks).length } : {}) })

  async function loadCachedMarket(exs: Exchange[]) {
    for (const ex of exs) {
      const c = await marketCache.get(ex)
      if (c) { marketHist[ex] = c.history; marketDate[ex] = c.date }
    }
    set({ market: { ...get().market, status: Object.keys(marketHist).length ? 'ready' : get().market.status, date: marketDate[exs[0]] ?? get().market.date, counts: countsOf() } })
  }

  return {
    route: fromHash(),
    chartSymbol: null,
    source: 'demo',
    provider: demoProvider,
    marketStatus: 'loading',
    marketError: null,
    feed: NO_FEED,
    fyers: { appId: '', hasSecret: false, session: null, loginError: null },
    breeze: { appKey: '', session: null, loginError: null, helper: 'unknown', needsCode: false },
    instruments: UNIVERSE,
    sets: new Map(),
    benchmark: null,
    extras: new Map(),
    extraStatus: null,
    indexLevels: [],
    market: { status: 'idle', message: null, progress: null, date: null, counts: {} },
    scan: null,
    searchIndex: null,
    marketSectors: [],
    userScanners: [],
    shortlist: [],
    settings: DEFAULT_SETTINGS,
    runs: {},

    async init() {
      window.addEventListener('hashchange', () => set({ route: fromHash() }))
      await get().reloadUserData()
      indicesReady = loadMarketIndices()
      void get().loadSearchIndex()
      // Shortlisted stocks from the market-wide data need that data to show prices; read it from this device, no download.
      const wantEx = [...new Set(get().shortlist.map(s => s.instrumentId).filter(id => id.startsWith('BSE:') || (id.startsWith('NSE:') && !UNIVERSE.some(u => u.id === id))).map(id => id.slice(0, 3) as Exchange))]
      if (wantEx.length) void loadCachedMarket(wantEx)
      try {
        const done = await completeLoginFromUrl()
        if (done) {
          await saveCredentials({ ...done.credentials, session: done.session })
          await saveDataSource('fyers')
          set({ source: 'fyers', fyers: { appId: done.credentials.appId, hasSecret: !!done.credentials.secret, session: done.session, loginError: null } })
          get().go('settings')
        }
      } catch (e) {
        set({ source: 'fyers', fyers: { ...get().fyers, loginError: errText(e) } })
        await saveDataSource('fyers')
        get().go('settings')
      }
      try {
        const bz = await completeBreezeLogin(get().breeze.appKey)
        if (bz) {
          await saveBreeze({ appKey: bz.appKey, session: bz })
          await saveDataSource('breeze')
          set({ source: 'breeze', breeze: { ...get().breeze, appKey: bz.appKey, session: bz, loginError: null } })
          get().go('settings')
        }
      } catch (e) {
        set({ source: 'breeze', breeze: { ...get().breeze, loginError: errText(e) } })
        await saveDataSource('breeze')
        get().go('settings')
      }
      await get().loadMarket()
    },

    async reloadUserData() {
      const [userScanners, shortlist, settings, runs, source, creds, bz] = await Promise.all([
        db.scanners.toArray(), db.shortlist.orderBy('addedAt').reverse().toArray(), loadSettings(), db.scanRuns.toArray(), loadDataSource(), loadCredentials(), loadBreeze(),
      ])
      const session = creds?.session && sessionValid(creds.session) ? creds.session : null
      set({
        userScanners: userScanners.filter(s => scannerSchema.safeParse(s).success), shortlist, settings, source,
        runs: Object.fromEntries(runs.map(r => [r.id, r])),
        fyers: { appId: creds?.appId ?? '', hasSecret: !!creds?.secret, session, loginError: null },
        breeze: { appKey: bz?.appKey || defaultAppKey(), session: bz?.session && sessionValid(bz.session) ? bz.session : null, loginError: null, helper: get().breeze.helper, needsCode: get().breeze.needsCode },
      })
    },

    async loadMarket() {
      stopPolling()
      const { source } = get()
      set({ marketStatus: 'loading', marketError: null, feed: { ...NO_FEED, progress: null } })

      if (source === 'demo') {
        try {
          const p = demoProvider
          const sets = new Map<string, CandleSet>()
          await Promise.all(UNIVERSE.map(async i => sets.set(i.id, await p.getHistoricalCandles(i, '1D', DEMO_BARS))))
          set({ provider: p, instruments: UNIVERSE, sets, benchmark: await p.getHistoricalCandles(BENCHMARK, '1D', DEMO_BARS), marketStatus: 'ready', feed: { mode: 'demo', updatedAt: null, message: null, progress: null } })
        } catch (e) {
          set({ marketStatus: 'error', marketError: errText(e) })
        }
        return
      }

      const provider = liveProvider()
      const label = source === 'breeze' ? 'Breeze' : 'FYERS'
      const cache = cacheFor(source)
      const now = Date.now()
      try {
        if (provider) {
          set({ provider })
          await provider.connect()
        }
        const result = await loadMarket({
          source, provider, instruments: UNIVERSE, benchmark: BENCHMARK, bars: LIVE_BARS, now, cache,
          onProgress: (done, total) => set({ feed: { ...get().feed, progress: { done, total } } }),
        })
        if (result.authExpired) await onAuthLost(`Your ${label} session expired. Reconnect to refresh prices.`)
        if (result.sets.size === 0 || !result.benchmark) {
          set({
            marketStatus: 'error', feed: NO_FEED,
            marketError: result.warnings[0] ?? `No ${label} data on this device yet. Connect ${label} in Settings, or switch to demo data.`,
          })
          return
        }
        const connected = !!provider && !result.authExpired
        const mode: FeedMode = !connected ? 'cached' : result.stale ? 'stale' : 'live'
        set({
          sets: result.sets, benchmark: result.benchmark, marketStatus: 'ready',
          feed: {
            // Breeze reports LIVE only once a real tick arrives (the poll sets updatedAt); history alone is end-of-day.
            mode, updatedAt: connected && !(provider instanceof BreezeProvider) ? now : null, progress: null,
            message: !connected ? (get().feed.message ?? 'Not connected. Showing data saved on this device.') : result.warnings[0] ?? null,
          },
        })
        if (connected) {
          if (provider instanceof BreezeProvider) {
            // Ticks need a moment to arrive, so Breeze waits for the first interval instead of polling an empty feed.
            provider.startStream([...UNIVERSE, BENCHMARK, ...[...get().extras.values()].map(e => e.instrument)])
            streaming = provider
            streamStartedAt = Date.now()
            void loadIndexLevels(provider, now)
          } else {
            void pollQuotes()
          }
          pollTimer = setInterval(() => void pollQuotes(), POLL_MS[source as 'fyers' | 'breeze'])
        }
      } catch (e) {
        if (e instanceof ProviderError && e.kind === 'auth') await onAuthLost(e.message)
        // A failed connect must not hide data we already hold: fall back to the cache, clearly labelled.
        const cached = await loadMarket({ source, provider: null, instruments: UNIVERSE, benchmark: BENCHMARK, bars: LIVE_BARS, now, cache })
        if (cached.sets.size && cached.benchmark) {
          set({ sets: cached.sets, benchmark: cached.benchmark, marketStatus: 'ready', feed: { mode: 'cached', updatedAt: null, progress: null, message: `${errText(e)} Showing data saved on this device.` } })
        } else {
          set({ marketStatus: 'error', marketError: errText(e), feed: NO_FEED })
        }
      }
    },

    async setSource(s) {
      await saveDataSource(s)
      applied.clear()
      eodIndexCandles.clear()
      for (const [id, c] of backendIndices) eodIndexCandles.set(id, c)
      set({ source: s, sets: new Map(), extras: new Map(), indexLevels: [], extraStatus: null, benchmark: null })
      await get().loadMarket()
    },

    connectFyers(appId, secret, remember) {
      beginLogin(appId.trim(), secret.trim(), remember)
    },

    async disconnectFyers() {
      stopPolling()
      const creds = await loadCredentials()
      if (creds) await saveCredentials({ appId: creds.appId })
      set({ fyers: { appId: creds?.appId ?? '', hasSecret: false, session: null, loginError: null } })
      await get().loadMarket()
    },

    connectBreeze(appKey) {
      beginBreezeLogin(appKey.trim())
    },

    /** Fallback when the redirect cannot return to this app: paste the API_Session code from the address bar. */
    async connectBreezeWithCode(appKey, apiSession) {
      try {
        const session = await exchangeSession(appKey.trim(), apiSession.trim())
        await saveBreeze({ appKey: session.appKey, session })
        await saveDataSource('breeze')
        set({ source: 'breeze', breeze: { ...get().breeze, appKey: session.appKey, session, loginError: null } })
        await get().loadMarket()
      } catch (e) {
        set({ breeze: { ...get().breeze, loginError: errText(e) } })
      }
    },

    async disconnectBreeze() {
      stopPolling()
      await saveBreeze({ appKey: get().breeze.appKey })
      set({ breeze: { ...get().breeze, session: null, loginError: null } })
      await get().loadMarket()
    },

    async checkBreezeHelper() {
      const info = await helperInfo()
      set({ breeze: { ...get().breeze, helper: info.available ? 'ok' : 'missing', needsCode: info.needsCode } })
    },

    go(r) { location.hash = `#/${r}` },
    openChart(id) {
      if (!get().sets.has(id) && !get().extras.has(id)) {
        const h = marketHist[id.slice(0, 3) as Exchange]
        const cs = h ? toCandleSet(h, id, nseNames) : null
        if (cs) set({ extras: new Map(get().extras).set(id, cs) })
      }
      set({ chartSymbol: id })
      get().go('charts')
    },

    setFor(id) {
      const { sets, extras } = get()
      const known = sets.get(id) ?? extras.get(id)
      if (known) return known
      const h = marketHist[id.slice(0, 3) as Exchange]
      return (h ? toCandleSet(h, id, nseNames) : null) ?? undefined
    },

    async loadMarketData(exchanges) {
      const cur = get().market
      set({ market: { ...cur, status: 'loading', message: null, progress: { loaded: 0, total: 0 } } })
      try {
        const m = await fetchManifest()
        for (const ex of exchanges) {
          if (marketHist[ex] && marketDate[ex] === m.latestDate) continue
          const r = await syncExchange(ex, m, marketCache, realNet, (loaded, total) => set({ market: { ...get().market, progress: { loaded, total } } }))
          if (!r) throw new MarketUnavailable(`${ex} market data has not been published.`)
          marketHist[ex] = r.history
          marketDate[ex] = r.date
        }
        nseNames ??= await loadMaster().then(rows => new Map(rows.map(r => [r.symbol, r.name]))).catch(() => new Map<string, string>())
        set({ market: { status: 'ready', message: null, progress: null, date: m.latestDate, counts: countsOf() } })
        void get().loadSearchIndex()
        return true
      } catch (e) {
        // Offline or the service is down: a copy already on this device is still useful, and is labelled as such.
        for (const ex of exchanges) {
          if (marketHist[ex]) continue
          const c = await marketCache.get(ex)
          if (c) { marketHist[ex] = c.history; marketDate[ex] = c.date }
        }
        if (exchanges.every(ex => marketHist[ex])) {
          const d = marketDate[exchanges[0]] ?? null
          set({ market: { status: 'ready', message: `Could not reach the market data service (${errText(e)}). Using the copy saved on this device${d ? ` from ${d}` : ''}.`, progress: null, date: d, counts: countsOf() } })
          return true
        }
        set({ market: { status: 'error', message: errText(e), progress: null, date: null, counts: countsOf() } })
        return false
      }
    },

    async loadSearchIndex() {
      if (get().searchIndex || searchLoading) return
      searchLoading = true
      try {
        const idx = await fetchSearchIndex(await fetchManifest())
        if (idx) set({ searchIndex: idx.items, marketSectors: [...new Set(idx.items.map(i => i[4]).filter(Boolean))].sort() })
      } catch { /* search falls back to tracked stocks, and Breeze's list when connected */ } finally { searchLoading = false }
    },

    async openMarketStock(id) {
      if (get().sets.has(id) || get().extras.has(id)) return get().openChart(id)
      const ex = id.slice(0, 3) as Exchange
      if (marketHist[ex]) return get().openChart(id)
      set({ chartSymbol: id, extraStatus: { id, state: 'loading' } })
      get().go('charts')
      if (!(await get().loadMarketData([ex]))) {
        set({ extraStatus: { id, state: 'error', message: get().market.message ?? 'Market data is not available.' } })
        return
      }
      const cs = toCandleSet(marketHist[ex]!, id, nseNames)
      if (!cs) { set({ extraStatus: { id, state: 'error', message: `${id.replace(/^\w+:/, '')} has no recent end-of-day data.` } }); return }
      set({ extras: new Map(get().extras).set(id, cs), extraStatus: null })
    },

    async runMarketScan(cfg, universe, opts) {
      if (scanRunning) return
      const exs: Exchange[] = universe === 'ALL' ? ['NSE', 'BSE'] : [universe]
      scanRunning = true
      try {
        if (!(await get().loadMarketData(exs))) return
        const bench = (ex: Exchange): CandleSet | null => {
          const c = backendIndices.get(BENCHMARK_FOR[ex])
          return c ? { instrument: { id: BENCHMARK_FOR[ex], exchange: ex, symbol: BENCHMARK_FOR[ex], name: 'Benchmark', sector: 'Index', kind: 'index' }, timeframe: '1D', candles: c, source: 'market', asOf: c[c.length - 1].t } : null
        }
        const benches: Record<Exchange, CandleSet | null> = { NSE: bench('NSE'), BSE: bench('BSE') }
        let ids = exs.flatMap(ex => Object.keys(marketHist[ex]!.stocks))
        let label = universe === 'ALL' ? 'All NSE + BSE' : `All ${universe}`
        if (universe === 'ALL' && opts?.listedOnce) {
          // Prefer the NSE listing (deeper liquidity); drop a BSE twin that shares its ISIN.
          const nseIsins = new Set(Object.values(marketHist.NSE!.stocks).map(s => s.isin).filter(Boolean))
          ids = ids.filter(id => id.startsWith('NSE:') || !nseIsins.has(marketHist.BSE!.stocks[id].isin))
          label += ' (each company once)'
        }
        set({ scan: { done: 0, total: ids.length, label } })
        const run = await runScannerLazy(cfg, {
          ids, label, source: 'market',
          make: id => toCandleSet(marketHist[id.slice(0, 3) as Exchange]!, id, nseNames),
          benchmarkFor: s => benches[s.instrument.exchange],
          onProgress: (done, total) => set({ scan: { done, total, label } }),
        })
        if (run) {
          set({ runs: { ...get().runs, [cfg.id]: run } })
          void db.scanRuns.put({ ...run, id: cfg.id })
        }
      } finally {
        scanRunning = false
        set({ scan: null })
      }
    },

    async openStock(row) {
      const id = `NSE:${row.symbol}`
      const { sets, extras, source } = get()
      if (sets.has(id) || extras.has(id)) return get().openChart(id)
      const provider = get().provider
      if (source !== 'breeze' || !(provider instanceof BreezeProvider) || !sessionValid(get().breeze.session) || !('token' in row)) {
        set({ extraStatus: { id, state: 'error', message: 'Only the tracked stocks are available on this data source. Connect ICICI Breeze to open any NSE stock.' } })
        return get().openChart(get().instruments[0]?.id ?? id)
      }
      const inst = adoptRow(row)
      set({ chartSymbol: id, extraStatus: { id, state: 'loading' } })
      get().go('charts')
      try {
        const cache = cacheFor('breeze')
        const now = Date.now()
        const cached = await cache.get(inst.id)
        let candles = cached && cached.fetchedAt >= lastSessionClose(now) ? cached.candles : undefined
        if (!candles) {
          candles = (await provider.getHistoricalCandles(inst, '1D', LIVE_BARS)).candles
          if (candles.length) await cache.put(inst.id, candles, now)
        }
        if (candles.length < 2) throw new ProviderError(`Breeze returned no daily history for ${inst.symbol}.`, 'api')
        const next = new Map(get().extras)
        next.set(inst.id, { instrument: inst, timeframe: '1D', candles: finalizeCandles(candles, now), source: 'breeze', asOf: candles[candles.length - 1].t })
        set({ extras: next, extraStatus: null })
        provider.watch(inst)
      } catch (e) {
        if (e instanceof ProviderError && e.kind === 'auth') await onAuthLost(e.message)
        set({ extraStatus: { id, state: 'error', message: errText(e) } })
      }
    },

    async saveScanner(s) {
      const clean = scannerSchema.parse(s) as ScannerConfig
      await db.scanners.put(clean)
      set({ userScanners: await db.scanners.toArray() })
    },
    async deleteScanner(id) {
      if (isPreset(id)) return
      await db.scanners.delete(id)
      await db.scanRuns.delete(id)
      const { [id]: _drop, ...rest } = get().runs
      set({ userScanners: await db.scanners.toArray(), runs: rest })
    },

    run(cfg) {
      const universe = UNIVERSE.map(i => get().sets.get(i.id)).filter((x): x is CandleSet => !!x)
      const result = runScanner(cfg, universe, get().benchmark)
      set({ runs: { ...get().runs, [cfg.id]: result } })
      void db.scanRuns.put({ ...result, id: cfg.id })
      return result
    },

    async addToShortlist(instrumentId, source) {
      if (get().shortlist.some(s => s.instrumentId === instrumentId)) return
      const item: ShortlistItem = { instrumentId, status: 'watching', note: '', addedAt: Date.now(), source }
      await db.shortlist.put(item)
      set({ shortlist: [item, ...get().shortlist] })
    },
    async updateShortlist(instrumentId, patch) {
      await db.shortlist.update(instrumentId, patch)
      set({ shortlist: get().shortlist.map(s => (s.instrumentId === instrumentId ? { ...s, ...patch } : s)) })
    },
    async removeFromShortlist(instrumentId) {
      await db.shortlist.delete(instrumentId)
      set({ shortlist: get().shortlist.filter(s => s.instrumentId !== instrumentId) })
    },

    async setSettings(s) { await saveSettings(s); set({ settings: s }) },
  }
})

export const allScanners = (user: ScannerConfig[]) => [...PRESETS, ...user]
export type { ShortlistStatus }
