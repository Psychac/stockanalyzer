/**
 * NSE symbol → ICICI Breeze stock_code and streaming token, from NSEScripMaster.txt (series EQ), 2026-10-27.
 * Breeze uses its own short codes (Reliance is RELIND), so symbols cannot be passed through. The master has no CORS
 * header, so this is a snapshot; regenerate it if a symbol changes. The Nifty 50 benchmark is the NIFTY BeES ETF
 * (NIFBEE), because the index row in the master has no numeric token.
 */
export const BREEZE_CODES: Record<string, { code: string; token: string }> = {
  'RELIANCE': { code: 'RELIND', token: '2885' },
  'TCS': { code: 'TCS', token: '11536' },
  'HDFCBANK': { code: 'HDFBAN', token: '1333' },
  'INFY': { code: 'INFTEC', token: '1594' },
  'ICICIBANK': { code: 'ICIBAN', token: '4963' },
  'SBIN': { code: 'STABAN', token: '3045' },
  'BHARTIARTL': { code: 'BHAAIR', token: '10604' },
  'ITC': { code: 'ITC', token: '1660' },
  'LT': { code: 'LARTOU', token: '11483' },
  'KOTAKBANK': { code: 'KOTMAH', token: '1922' },
  'AXISBANK': { code: 'AXIBAN', token: '5900' },
  'HINDUNILVR': { code: 'HINLEV', token: '1394' },
  'BAJFINANCE': { code: 'BAJFI', token: '317' },
  'MARUTI': { code: 'MARUTI', token: '10999' },
  'SUNPHARMA': { code: 'SUNPHA', token: '3351' },
  'TMPV': { code: 'TATMOT', token: '3456' },
  'TATASTEEL': { code: 'TATSTE', token: '3499' },
  'NTPC': { code: 'NTPC', token: '11630' },
  'POWERGRID': { code: 'POWGRI', token: '14977' },
  'ONGC': { code: 'ONGC', token: '2475' },
  'ADANIENT': { code: 'ADAENT', token: '25' },
  'ADANIPORTS': { code: 'ADAPOR', token: '15083' },
  'ASIANPAINT': { code: 'ASIPAI', token: '236' },
  'TITAN': { code: 'TITIND', token: '3506' },
  'ULTRACEMCO': { code: 'ULTCEM', token: '11532' },
  'WIPRO': { code: 'WIPRO', token: '3787' },
  'HCLTECH': { code: 'HCLTEC', token: '7229' },
  'TECHM': { code: 'TECMAH', token: '13538' },
  'M&M': { code: 'MAHMAH', token: '2031' },
  'DRREDDY': { code: 'DRREDD', token: '881' },
  'CIPLA': { code: 'CIPLA', token: '694' },
  'JSWSTEEL': { code: 'JSWSTE', token: '11723' },
  'HINDALCO': { code: 'HINDAL', token: '1363' },
  'COALINDIA': { code: 'COALIN', token: '20374' },
  'INDUSINDBK': { code: 'INDBA', token: '5258' },
  'BAJAJFINSV': { code: 'BAFINS', token: '16675' },
  'NESTLEIND': { code: 'NESIND', token: '17963' },
  'BRITANNIA': { code: 'BRIIND', token: '547' },
  'EICHERMOT': { code: 'EICMOT', token: '910' },
  'HEROMOTOCO': { code: 'HERHON', token: '1348' },
  'DIVISLAB': { code: 'DIVLAB', token: '10940' },
  'GRASIM': { code: 'GRASIM', token: '1232' },
  'TRENT': { code: 'TRENT', token: '1964' },
  'DLF': { code: 'DLFLIM', token: '14732' },
  'PIDILITIND': { code: 'PIDIND', token: '2664' },
  'SIEMENS': { code: 'SIEMEN', token: '3150' },
  'HAL': { code: 'HINAER', token: '2303' },
  'BEL': { code: 'BHAELE', token: '383' },
  'ETERNAL': { code: 'ZOMLIM', token: '5097' },
  'IRCTC': { code: 'INDRAI', token: '13611' },
}

export const BREEZE_BENCHMARK = { code: 'NIFBEE', token: '10576' }

/** Stocks outside the tracked universe that the user opened through search. Filled at runtime from the master. */
const EXTRA = new Map<string, { code: string; token: string }>()
export const registerExtra = (symbol: string, v: { code: string; token: string }) => { EXTRA.set(symbol, v) }
export const lookupCode = (symbol: string) => BREEZE_CODES[symbol] ?? EXTRA.get(symbol)

/**
 * NSE indices on the dashboard. `code` is Breeze's stock_code for daily history (unverified for indices; failures just
 * leave the tile empty). `token` is the instrument master's own token string for the index row (indices
 * have no numeric token). BSE indices such as the Sensex are not available: Breeze does not serve BSE.
 */
export const BREEZE_INDICES = [
  { id: 'NSE:NIFTY50', code: 'NIFTY', name: 'Nifty 50', token: 'NIFTY 50' },
  { id: 'NSE:NIFTYBANK', code: 'CNXBAN', name: 'Bank Nifty', token: 'NIFTY BANK' },
  { id: 'NSE:NIFTYIT', code: 'CNXIT', name: 'Nifty IT', token: 'NIFTY IT' },
  { id: 'NSE:NIFTYFIN', code: 'NIFFIN', name: 'Fin Services', token: 'NIFTY FIN SERVICE' },
  { id: 'NSE:NIFTYMID', code: 'NIFMID', name: 'Midcap 50', token: 'NIFTY MIDCAP 50' },
  { id: 'NSE:INDIAVIX', code: 'INDVIX', name: 'India VIX', token: 'INDIA VIX' },
] as const
