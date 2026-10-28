import { BREEZE_CODES, BREEZE_INDICES } from './codes'
import { BreezeClient } from './client'
import { BreezeStream } from './stream'
import { helperAvailable, type BreezeSession } from './session'
import { loadMaster } from './master'
import { istDate } from '../../domain/time'
import { ProviderError } from '../errors'

export interface DiagStep {
  label: string
  status: 'ok' | 'fail' | 'info'
  detail: string
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Walks the Breeze path one stage at a time and reports each, so a failure points at the broken layer
 * (helper, session, history, symbol map, live feed) instead of showing a blank dashboard.
 */
export async function runBreezeDiagnostics(session: BreezeSession | null, onUpdate: (steps: DiagStep[]) => void): Promise<DiagStep[]> {
  const steps: DiagStep[] = []
  const push = (s: DiagStep) => { steps.push(s); onUpdate([...steps]) }

  const helper = await helperAvailable()
  push({ label: 'Breeze relay', status: helper ? 'ok' : 'fail', detail: helper ? 'Reachable. Breeze calls go through the relay on the same server as this app.' : 'Not reachable. Run the app with npm run dev, or deploy it with its api/ folder; a plain static host cannot use Breeze.' })
  if (!helper) return steps

  if (!session) { push({ label: 'Session', status: 'fail', detail: 'Not logged in. Log in with ICICI, or paste a session code, first.' }); return steps }
  const left = session.expiresAt - Date.now()
  push({ label: 'Session', status: left > 0 ? 'ok' : 'fail', detail: left > 0 ? `Logged in as ${session.userId}. Assumed valid for about ${Math.round(left / 3.6e6)} h.` : 'The stored session has passed its assumed expiry. Log in again.' })

  const master = await loadMaster().catch(() => [])
  push({ label: 'Symbol map', status: master.some(r => r.symbol === 'RELIANCE') ? 'ok' : 'fail', detail: master.length ? `${master.length.toLocaleString('en-IN')} NSE stocks have a Breeze code.` : 'The Breeze stock list could not be loaded.' })

  try {
    const now = Date.now()
    const rows = await new BreezeClient(() => session).history({
      interval: '1day', stock_code: BREEZE_CODES.RELIANCE.code, exch_code: 'NSE', product_type: 'cash',
      from_date: `${istDate(now - 14 * 86_400_000)}T00:00:00.000Z`, to_date: `${istDate(now)}T23:59:59.000Z`,
    })
    const last = rows[rows.length - 1]
    push({
      label: 'Daily history (RELIANCE)', status: rows.length ? 'ok' : 'info',
      detail: rows.length ? `${rows.length} daily bars. Latest: ${last.datetime} close ${last.close}.` : 'Request succeeded but returned no bars for the last 14 days.',
    })
  } catch (e) {
    push({ label: 'Daily history (RELIANCE)', status: 'fail', detail: e instanceof ProviderError ? e.message : String(e) })
    return steps
  }

  const probe = (symbol: string) => ({ id: `NSE:${symbol}`, exchange: 'NSE' as const, symbol, name: symbol, sector: '', kind: 'equity' as const })
  const stream = new BreezeStream(session, ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK'].map(probe))
  stream.watchIndices(BREEZE_INDICES)
  try {
    stream.start()
    for (let i = 0; i < 12 && stream.state === 'connecting'; i++) await wait(500)
    if (stream.state !== 'connected') {
      push({ label: 'Live feed', status: 'fail', detail: stream.message ?? 'Could not connect within 6 seconds. Browsers cannot send the User-Agent header the official client uses, which Breeze may require.' })
    } else {
      await wait(4000)
      push({
        label: 'Live feed', status: 'ok',
        detail: stream.ticksReceived ? `Connected and received ${stream.ticksReceived} ticks.` : 'Connected. No ticks yet, which is expected when the market is closed.',
      })
      push({
        label: 'Index feed', status: stream.indexTicksReceived ? 'ok' : 'info',
        detail: stream.indexTicksReceived
          ? `Received ${stream.indexTicksReceived} index ticks (Nifty 50, Bank Nifty and others).`
          : 'No index ticks yet. Expected when the market is closed; if the market is open, the index token format may differ and the dashboard strip will show end-of-day levels only.',
      })
    }
  } finally {
    stream.stop()
  }
  return steps
}
