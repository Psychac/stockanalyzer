# Market-data provider feasibility (spec Milestone 0)

Probed on 2026-10-27 with unauthenticated requests (CORS preflights and bad-credential calls), plus the providers' public docs.
Nothing below was verified with a real account session; see "Not yet verified".

## Decision

**FYERS** is the portable live provider: it works as a pure PWA. **ICICI Breeze** cannot be called from a browser-only app, so it is
supported only on a developer machine through a local helper inside the Vite dev/preview server (added 2026-10-27 at the user's
request, since they have a Breeze account). Making Breeze work in an installed app needs a native wrapper; see below.

### Breeze relay: Vercel, and why history is a function too

Your friend's Breeze app is hosted on Vercel, i.e. it uses a server-side hop. Probing showed what actually needs code (2026-10-27):
the session call must be a real GET with a body (a query string gives `415`; `POST` and method-override headers give `405`), so it
needs a function. History v2 works with headers alone, so a `vercel.json` rewrite might suffice, but forwarding custom headers
through an external rewrite was not verified, so history is a function as well. Both live in `api/breeze/*` and share
`api/_lib/breezeRelay.ts` with the dev server, so local tests exercise the deployed code.

Not verified: a real Vercel deployment (including whether ICICI answers requests from Vercel's IPs), and whether Vercel's Node
runtime compiles the `.js`-suffixed imports in `api/breeze/*.ts` as expected. The bundled entrypoints were run against real ICICI
from a plain Node server instead.

### Breeze update: what the local helper changed (probed live)

| Finding | Evidence |
|---|---|
| Helper relays the GET-with-body session call | With a fake app key, real ICICI answered `{"Error":"Public Key does not exist."}` through the helper. |
| History v2 rejects a bad session with a clear 401 | `{"Error":"Invalid User Details","Status":401}`, so auth failures are classified per call. |
| History v2 needs only headers | `X-SessionToken` (the base64 token from the session call) and `apikey`; params `exch_code`, `stock_code`, `interval=1day`. No checksum and no secret key. |
| The streaming socket is reachable from a browser | A real socket.io connection from Edge, with a fake token, was refused with `Authentication Failed`. It reached the credential check, so CORS and the missing User-Agent header did not block the handshake. Whether a real token streams ticks is **unverified**. |
| Symbols differ | Breeze uses its own codes (Reliance is `RELIND`, token `2885`), mapped from the public instrument master. The Nifty benchmark is the NIFTY BeES ETF (`NIFBEE`). |
| Tick layout | Per the official SDK source: 21-field NSE quote array; join channel `4.1!<token>`. Parsed in `breeze/stream.ts`, covered by tests with a synthetic tick only. |

Why a React Native app (or any native app) does not need a helper: CORS is a browser rule, so native HTTP stacks are not subject to it.
The same would hold for a Capacitor or Tauri build of this app. Android's HTTP stacks usually refuse a body on GET, so the session call
is the part to prove there.

## Breeze: why it was ruled out for a no-server PWA

| Finding | Evidence |
|---|---|
| Session exchange (`/customerdetails`) is only a **GET with a JSON body** | POST returns `405`. Browsers cannot send a body on GET (`fetch` throws). |
| No usable CORS on the data host | `breezeapi.icicidirect.com/api/v2/historicalcharts` preflight returns `401` with no `Access-Control-Allow-Origin`. v1 REST preflights return `403`. |
| Secret key needed for v1 signed calls | `X-Checksum = sha256(timestamp + body + secret)`. |
| No BSE or MCX | Stated in Breeze's own API reference. |
| What does work | socket.io streaming host sends `access-control-allow-origin: *`; the instrument master zip is public (but has no CORS header). |

Breeze would need a native wrapper (Tauri on Windows; Android's HTTP stacks usually refuse a body on GET, so session exchange there is unproven). Neither Rust nor the Android SDK was available when this was assessed.

## FYERS: why it fits

| Finding | Evidence |
|---|---|
| CORS is open on auth and data | Preflights on `api-t1.fyers.in` (`/api/v3/validate-authcode`, `/data/history`, `/data/quotes`) return `200` with `access-control-allow-origin: *` and allow `Authorization`. Real POST and GET responses also carry the header. |
| Plain REST, no request signing | `Authorization: app_id:access_token`; history and quotes are normal GETs with query params. |
| Standard OAuth-style login | Redirect to `/api/v3/generate-authcode` → `auth_code` on your registered redirect URL → `POST /api/v3/validate-authcode`. |
| Symbol master is CORS-open | `https://public.fyers.in/sym_details/NSE_CM.csv`. All 50 tracked symbols exist as `NSE:SYMBOL-EQ` (after replacing Zomato with `ETERNAL` and Tata Motors with `TMPV`); the Nifty index is `NSE:NIFTY50-INDEX`. |
| Free tier is enough for this MVP | Standard plan: 5 calls/s, 50/min, 5,000/day; 366 days per daily-history call; 5 years of daily history; 100 live symbols. |

### The trade-off to accept

The token exchange needs `appIdHash = sha256(app_id:app_secret)`, so the **app secret has to be on the device**. There is no PKCE or secret-less flow in FYERS's documentation. Mitigations in the app:

- The secret is typed by the user, never bundled or committed.
- It is kept only for the login round trip (sessionStorage), and persisted only if the user ticks "Remember".
- When persisted it is in its own IndexedDB table and is excluded from export and backup.
- Guidance is to create an individual app with **Market Data permission only**, so a leaked secret cannot place orders.
- The refresh token FYERS returns is deliberately discarded. Sessions end at 06:30 IST daily, so a daily reconnect is expected.

## Rate-limit budget

Exceeding the per-minute limit more than 3 times in a day blocks the account for the rest of the day. The client paces to **4/s and 40/min** (monotonic clock). First load is 51 history calls (50 stocks plus Nifty) and takes about a minute. Later loads reuse the local cache and make **no** history calls until a new session has closed. Live refresh is 2 quote calls a minute.

## Not yet verified (needs a real FYERS session)

- The exact timestamp convention of daily candles. The parser only trusts the IST calendar date.
- Whether FYERS accepts `http://localhost:<port>/` as a redirect URL (docs only show https examples).
- The quote payload against live data (parsed per the documented `d[].v` fields; bad entries are skipped).
- Whether a daily history request during market hours includes today's forming bar.
- Behaviour on exchange holidays and corporate-action adjustments.

## Deferred

- Breeze behind a native wrapper (Tauri or Capacitor) so it works in an installed app without the dev helper.
- Live tick streaming for FYERS: the FYERS data-socket protocol is not in the public docs text (only the Python SDK surface); quotes are polled instead.
- Intraday candles and the 15-minute presets.
- BSE coverage.
- Terms review for local caching of FYERS data (the API terms were not reviewed).
