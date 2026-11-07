# stockbitd — a Stockbit session keeper for Linux

One saved Stockbit sign-in, then the app fills the real login form, keeps the
cookie jar and tokens alive, and serves the data over a local JSON API and a
control panel.

Built in Go on purpose: a single static binary, the standard-library HTTP client
and cookie handling, no WebSocket dependency (the browser is driven over
Chrome's DevTools pipe), and a process that is happy to run as a user service.

```
┌──────────────────────────┐        CDP pipe (fd 3/4)        ┌──────────────────┐
│ stockbitd serve          │ ──────────────────────────────▶ │ Chromium window  │
│  control panel + JSON API│ ◀────────────────────────────── │ stockbit.com     │
│  session keeper          │                                 └──────────────────┘
│  cookie jar + tokens     │        Bearer + cookies
│  in-memory data cache    │ ──────────────────────────────▶ exodus.stockbit.com
└────────────┬─────────────┘
             │ session.json (0600)
             ▼
   ~/.local/share/stockbitd/
```

## What it does

- **One saved sign-in, filled for you.** Save the stockbit.com account once in
  the suite's Stockbit screen (or provide `STOCKBIT_USERNAME`/`STOCKBIT_PASSWORD`).
  The daemon opens a real Chromium window, fills Stockbit's own `#username` and
  `#password` form, submits it, and reads the `credentialStorage` cookie through
  the DevTools pipe. No password is sent to stockbitd's API; it stays in a local
  `credentials.json` with mode 0600 (or in the environment). If Stockbit asks
  for a verification code, PIN or challenge, that one step still happens in the
  window; the cookie is captured as soon as it lands.
- **Manual fallback.** Without a saved pair, `Connect Stockbit` opens the plain
  login page. The token and Cookie-header forms and the CLI remain available for
  a headless machine or a different account.
- **Maintains the cookies.** The saved cookie jar is replayed on every Stockbit
  request; `Set-Cookie` responses are merged and persisted. The access token is
  refreshed before it expires (and once after a 401) with the refresh token; the
  rotated tokens are written back into the `credentialStorage` cookie. A keeper
  goroutine does this while `serve` runs.
- **Serves the data.** The panel and the API expose the quote, company info,
  orderbook imbalance, per-broker net rows and the personal watchlist. The data
  cache is in memory and separate from the session file.
- **Fails honestly.** `reauth_required`, `rate_limited`, `challenge_required`,
  `browser_not_found`, `no_display`, `invalid_credentials`,
  `login_form_not_found` and `upstream_error` are distinct states with
  distinct messages. Nothing caches an unauthorised response.

## Install

Requirements: Linux, Go 1.23+ to build, and a Chromium-family browser for the
interactive login (Chrome, Chromium, Brave or Edge). Firefox is not supported
for the login window because it has no Chrome DevTools pipe.

```sh
cd stockbitd
make build          # bin/stockbitd
./install.sh        # binary + desktop entry + systemd unit (not started)
./install.sh --service   # also enable and start the user service
```

The desktop entry `Stockbit` runs `stockbitd serve --open`. If the service is
already running, that command detects the healthy panel and just opens it.

### First sign-in

The easiest path is the suite's **Stockbit** screen: save the account once there
and the daemon fills the form on every first run or reconnect. Standalone, the
daemon can use an environment pair:

```sh
export STOCKBIT_USERNAME='you@example.com'
export STOCKBIT_PASSWORD='…'
stockbitd login            # fills the real form, saves the session, exits
stockbitd status --json
```

A pair saved by the suite lives in `$STOCKBITD_HOME/credentials.json` (mode
0600). `stockbitd login --manual` opens the plain login page instead. Without a
saved pair the normal *Connect Stockbit* panel opens that page.

Stockbit's own verification (a code, PIN or challenge) is the one step the app
cannot do for you: the browser window stays open for it, and the automatic
sign-in continues when Stockbit accepts the session.

If the browser cannot be used, the panel (and the CLI) accepts the two manual
forms:

```sh
# The Cookie header from DevTools; it normally already contains the tokens.
stockbitd cookies < cookies.txt

# Or an access token from the Authorization header (reads stdin when --access is omitted).
stockbitd token --access 'eyJhbGciOi…' --refresh 'refresh-token'
```

## Run

```sh
stockbitd serve                 # http://127.0.0.1:8787
stockbitd serve --addr 127.0.0.1:9000
stockbitd status                # human line
stockbitd status --json         # machine-readable
stockbitd login --manual        # open the plain login page
stockbitd logout                # delete the jar and browser profile; keep the saved sign-in
```

To forget the saved sign-in as well, use the suite's **Forget saved sign-in**
button or:

```sh
curl -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:8787/api/session/credentials/clear
```

The server binds loopback by default. It has no authentication, so do not bind
it to a public interface.

### systemd user service

```sh
systemctl --user enable --now stockbitd
systemctl --user status stockbitd
journalctl --user -u stockbitd -f
```

A login window started by the service needs the graphical session's variables.
Import them once per graphical login (the installer tries this too):

```sh
systemctl --user import-environment DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR
systemctl --user restart stockbitd
```

If that is not possible, run the panel from the desktop session for the login
and let the service keep the refreshed session afterwards.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness and version |
| GET | `/api/status` | session state, token runway, cookie count, saved sign-in presence, browser capability, cache counters |
| POST | `/api/login/browser` | start the browser login attempt (`202`; `409 already_running` carries the live attempt). `{"manual":true}` opens the plain page; otherwise a saved sign-in is filled |
| GET | `/api/login/browser/{id}` | poll one attempt |
| POST | `/api/login/browser/{id}/cancel` | cancel the attempt |
| POST | `/api/session/token` | `{access_token, refresh_token?}` |
| POST | `/api/session/cookies` | `{cookie}` (header) or `{cookies: [...]}` |
| POST | `/api/session/credentials` | `{username, password}`; the one saved sign-in |
| POST | `/api/session/credentials/clear` | forget the saved sign-in; keep the session |
| POST | `/api/session/refresh` | force a refresh now |
| POST | `/api/logout` | delete the session file and profile; keep the saved sign-in |
| GET | `/api/data/symbol/{ticker}` | quote, info, orderbook, brokers |
| GET | `/api/data/orderbook/{ticker}` | depth and quote |
| GET | `/api/data/brokers/{ticker}?date=YYYY-MM-DD` | broker net rows |
| GET | `/api/data/watchlist` | personal groups and items |
| GET | `/api/cache` | data cache counters and keys |
| POST | `/api/cache/clear` | clear the data cache; session untouched |

All JSON endpoints return `{"error": {"code": "...", "message": "..."}}` on
failure. `?refresh=1` bypasses the read cache.

## Session file and security

- Path: `$STOCKBITD_HOME/session.json`, default
  `~/.local/share/stockbitd/session.json`; directory 0700, file 0600.
- Contents: access/refresh tokens, the public account projection, and the
  stockbit.com cookie list (only stockbit.com; analytics and recaptcha cookies
  are discarded). It never contains a password.
- Writes are atomic: temp file, fsync, rename.
- `/api/status` returns token lengths/expiry and cookie counts, never values.
- The dedicated `browser-profile/` directory under the same data home is a real
  Chromium profile (0700); treat it as sensitive. `logout` / *Disconnect* removes
  the session file and that profile, so the next Connect starts from a fresh
  browser session. A profile path outside `STOCKBITD_HOME` is refused by the
  reset.
- `credentials.json` in the same directory holds the saved Stockbit sign-in
  with mode 0600. It is loaded by the daemon only, never returned by the API,
  and never passed to a log. `logout` keeps it so the next run can sign in
  automatically; **Forget saved sign-in** (or `/api/session/credentials/clear`)
  removes it. An environment pair (`STOCKBIT_USERNAME`/`STOCKBIT_PASSWORD`)
  takes over when no file exists.
- The data cache is in memory; clearing it does not disconnect the session.

## Using it from the trading suite

The suite is the primary consumer:

- `./trading-suite run` starts this daemon on `127.0.0.1:8787` when it is built
  (and builds it when Go is available). The runner also stops it through the pid
  file.
- The suite has a native **Stockbit** screen at `/stockbit`. Save the account
  once there and it starts the automatic sign-in without a click: the daemon
  fills Stockbit's form, captures the cookie and reports the state. The screen
  also accepts a token or a Cookie header for the fallback path, and displays
  the quote, company info, orderbook, broker rows and the personal watchlist.
  The suite's backend copies a legacy `.env` username/password pair into the
  daemon once when it is not already saved.
- `backend/app/routers/stockbit.py` proxies the daemon's JSON under
  `/api/stockbit/*`, keeping its status codes and turning a dead daemon into one
  designed `daemon_unavailable` state. The proxy has its own worker pool so a
  first plan read cannot starve the session panel.
- `backend/app/stockbit_daemon.py` is the suite's client. Its `use_daemon()`
  check is a health probe with a short cache: while the daemon is healthy the
  Flow detail reads and the legacy intel routes use it; while it is down those
  data paths fall back to the legacy `STOCKBIT_JWT_TOKEN`. Set
  `STOCKBITD_URL=` explicitly to disable the daemon and stay on the legacy path.
- The **Analysis & recommendation** block on the Stockbit screen merges the
  suite's measured plan for the loaded name (verdict, gates, geometry, plan
  candidates) with the Stockbit rows. The broker flow is labelled context: it is
  not an input to the plan's verdict, and the page repeats the Flow page's
  disclaimer.

The adapter and proxy surface these states: `daemon_unavailable`,
`unconfigured`, `connected`, `reauth_required`, `invalid_response`,
`credentials_missing`, `credentials_invalid`, `invalid_credentials` and
`login_form_not_found`. They are why a dead daemon, a missing saved sign-in or
a changed login form shows as a typed state rather than a stack trace.

## Development

```sh
make test       # go test ./...
make vet        # go vet ./...
make build
```

The CDP smoke test launches the real browser in headless mode and is skipped
when no Chromium is installed or `-short` is passed. Unit tests cover the
credential cookie codec, the saved sign-in store, the form-fill script and its
escaping, the cookie jar, the refresh single-flight and 401 retry, payload
normalization, the cache and the HTTP error mapping. The automatic sign-in was
also exercised end-to-end against a local login fixture: the daemon filled the
form, read the resulting storage and adopted the session.

## Troubleshooting

| Code | Meaning | Fix |
| --- | --- | --- |
| `browser_not_found` | no Chromium found | install one, or set `STOCKBITD_BROWSER`; the token/cookie fallback works without a browser |
| `no_display` | no `DISPLAY`/`WAYLAND_DISPLAY` | run from the desktop session, import the variables into the user service, or use the fallback |
| `unsupported_browser` | Firefox or another non-CDP browser | use Chrome, Chromium, Brave or Edge |
| `login_timeout` | the window was open for the whole budget | retry; check that the Stockbit login completed |
| `invalid_credentials` | Stockbit rejected the saved sign-in | update the sign-in in the suite's Stockbit screen |
| `login_form_not_found` | Stockbit's form did not match the automator | retry, or use *Open the Stockbit login window manually* |
| `credentials_missing` / `credentials_invalid` | no usable saved sign-in | save it again on the Stockbit screen |
| `reauth_required` | the refresh token was rejected or expired | press *Reconnect Stockbit* |
| `challenge_required` | Cloudflare asked for a browser challenge | reconnect through the browser flow; the token fallback cannot solve it |
| `rate_limited` | Stockbit returned 429 | wait for the Retry-After window |
| `upstream_error` | Stockbit 5xx or an unexpected body | retry; the response is not cached |

## Limits

- Reads only. It never places orders and has no trading credentials.
- The browser flow needs a graphical session and a Chromium-family binary.
- Stockbit can change its private web API at any time; the normalizers are
  tolerant, but a shape change shows up as `invalid_response` rather than a
  fabricated value.
- Honouring Stockbit's terms is the operator's responsibility; this app uses
  the session you already have and does not bypass authentication.
