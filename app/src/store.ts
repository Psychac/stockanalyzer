import { create } from 'zustand'
import type { CandleSet, DataSource, Instrument } from './domain/types'
import { runScanner, scannerSchema, type ScannerConfig, type ScanRun } from './domain/scanner'
import { PRESETS, isPreset } from './domain/presets'
import { isMarketOpen } from './domain/time'
import {
  DEFAULT_SETTINGS, cacheFor, clearSession, db, loadBreeze, loadCredentials, loadDataSource, loadSettings, saveBreeze, saveCredentials, saveDataSource, saveSettings,
  type Settings, type ShortlistItem, type ShortlistStatus,
} from './db/db'
import { demoProvider } from './providers/demo'
import { BENCHMARK, UNIVERSE } from './providers/universe'
import { FyersClient } from './providers/fyers/client'
import { FyersProvider } from './providers/fyers/provider'
import { applyQuote } from './providers/candles'
import { ProviderError } from './providers/errors'
import { beginLogin, completeLoginFromUrl } from './providers/fyers/auth'
import type { FyersSession } from './providers/fyers/types'
import { BreezeClient } from './providers/breeze/client'
import { BreezeProvider } from './providers/breeze/provider'
import { beginLogin as beginBreezeLogin, completeLoginFromUrl as completeBreezeLogin, exchangeSession, helperAvailable, type BreezeSession } from './providers/breeze/session'
import { loadMarket } from './providers/loader'
import type { MarketDataProvider } from './providers/types'

export type Route = 'dashboard' | 'discover' | 'shortlist' | 'charts' | 'journal' | 'news' | 'settings'
export const ROUTES: Route[] = ['dashboard', 'discover', 'shortlist', 'charts', 'journal', 'news', 'settings']

const DEMO_BARS = 400
/** One year of dailies fits a single FYERS history request. */
const LIVE_BARS = 250
/** FYERS quotes cost API calls, so poll gently. Breeze ticks arrive over a socket and polling them is free. */
const POLL_MS: Record<'fyers' | 'breeze', number> = { fyers: 60_000, breeze: 15_000 }

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
  breeze: { appKey: string; session: BreezeSession | null; loginError: string | null; helper: 'unknown' | 'ok' | 'missing' }
  instruments: Instrument[]
  sets: Map<string, CandleSet>
  benchmark: CandleSet | null
  userScanners: ScannerConfig[]
  shortlist: ShortlistItem[]
  settings: Settings
  runs: Record<string, ScanRun>

  init: () => Promise<void>
  go: (r: Route) => void
  openChart: (instrumentId: string) => void
  loadMarket: () => Promise<void>
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
const stopPolling = () => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  streaming?.stopStream()
  streaming = null
}

export const useApp = create<State>((set, get) => {
  /** Replace the data and everything derived from it in one update. */
  const applyData = (sets: Map<string, CandleSet>, benchmark: CandleSet | null) => set({ sets, benchmark })

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

  async function pollQuotes() {
    const { source, sets, benchmark, provider } = get()
    const now = Date.now()
    if (source === 'demo' || !sessionValid(activeSession(), now) || !isMarketOpen(now) || document.visibilityState !== 'visible') return
    try {
      const quotes = await provider.getQuotes([...UNIVERSE, BENCHMARK])
      if (quotes.length === 0) {
        const why = streaming?.stream?.message ?? 'no prices have arrived yet'
        set({ feed: { ...get().feed, mode: 'stale', message: `Live prices are not arriving (${why}). Showing end-of-day data.` } })
        return
      }
      const nextSets = new Map(sets)
      let nextBench = benchmark
      for (const q of quotes) {
        if (q.instrumentId === BENCHMARK.id && nextBench) nextBench = { ...nextBench, candles: applyQuote(nextBench.candles, q, now), asOf: q.at }
        const cur = nextSets.get(q.instrumentId)
        if (cur) nextSets.set(q.instrumentId, { ...cur, candles: applyQuote(cur.candles, q, now), asOf: q.at })
      }
      applyData(nextSets, nextBench)
      set({ feed: { ...get().feed, mode: 'live', updatedAt: now, message: null } })
    } catch (e) {
      if (e instanceof ProviderError && e.kind === 'auth') await onAuthLost(e.message)
      else set({ feed: { ...get().feed, mode: 'stale', message: `Live updates paused: ${errText(e)}` } })
    }
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
    breeze: { appKey: '', session: null, loginError: null, helper: 'unknown' },
    instruments: UNIVERSE,
    sets: new Map(),
    benchmark: null,
    userScanners: [],
    shortlist: [],
    settings: DEFAULT_SETTINGS,
    runs: {},

    async init() {
      window.addEventListener('hashchange', () => set({ route: fromHash() }))
      await get().reloadUserData()
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
        breeze: { appKey: bz?.appKey ?? '', session: bz?.session && sessionValid(bz.session) ? bz.session : null, loginError: null, helper: get().breeze.helper },
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
            mode, updatedAt: connected ? now : null, progress: null,
            message: !connected ? (get().feed.message ?? 'Not connected. Showing data saved on this device.') : result.warnings[0] ?? null,
          },
        })
        if (connected) {
          if (provider instanceof BreezeProvider) {
            // Ticks need a moment to arrive, so Breeze waits for the first interval instead of polling an empty feed.
            provider.startStream([...UNIVERSE, BENCHMARK])
            streaming = provider
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
      set({ source: s, sets: new Map(), benchmark: null })
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
      set({ breeze: { ...get().breeze, helper: (await helperAvailable()) ? 'ok' : 'missing' } })
    },

    go(r) { location.hash = `#/${r}` },
    openChart(id) { set({ chartSymbol: id }); get().go('charts') },

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
      const universe = [...get().sets.values()]
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
