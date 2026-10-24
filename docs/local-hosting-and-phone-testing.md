# Running FreightProof locally, and getting the driver app onto an iPhone

Written for a developer with repo access who has not run this stack before and does not
have Xcode installed. Verified against `dev` on 2026-10-23.

Read [CLAUDE.md](../CLAUDE.md) first. Get secret values from the team's shared store —
never from another developer's `.env` over chat, and never commit one.

**The short version:** five processes (API, Redis, Celery, and whichever frontends you
need), then the driver app goes on the phone as an installed PWA over an HTTPS tunnel. You
do **not** need Xcode for that. Xcode is only needed for the native iOS shell, and
section 7 covers installing it from the terminal if you decide you want it.

---

## 1. What runs where

| Process | Port | Command dir | Needed for |
|---|---|---|---|
| FastAPI API | 8000 | `backend/` | everything |
| Redis | 6379 | — | Celery broker |
| Celery worker | — | `backend/` | Hedera anchoring (see note below) |
| Dispatcher dashboard | 3000 | `frontend/dispatcher/` | creating trips, watching them |
| Driver PWA | 3001 | `frontend/driver-pwa/` | walking a trip on a phone |
| Receiver handover page | 3002 | `frontend/receiver/` | the QR page at delivery |
| Client portal | 3003 | `frontend/client-portal/` | opening an audit-pack share link |

Postgres is **not** local — `DATABASE_URL` points at the shared Supabase dev project.
That has consequences in sections 3 and 8.

**Celery is not optional if you care about anchoring.** Without a worker running, anchor
jobs queue and never execute, so the last phase of every trip walk sits at `pending`
forever and looks like a bug in the phase engine. It isn't.

---

## 2. One-time setup

### Prerequisites

```bash
brew install python@3.13 node@22 redis
brew link --overwrite node@22        # Node 22 must be the default `node`
node -v                              # must print v22.x
```

Node 22 is not cosmetic. On Node 18 the dispatcher's vitest suite will not start at all,
and the failure mode looks nothing like a version problem.

Docker Desktop is optional — only needed for the compose stack (section 4) or the
throwaway test Postgres.

### Clone and install

```bash
git clone https://github.com/Team-5-2026-Hons/freightproof-sa.git
cd freightproof-sa
git switch dev

# Backend
python3.13 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
backend/.venv/bin/pip install -r backend/requirements-dev.txt   # for pytest

# Frontends — each has its own node_modules
(cd frontend/dispatcher    && npm install)
(cd frontend/driver-pwa    && npm install)
(cd frontend/receiver      && npm install)
(cd frontend/client-portal && npm install)
```

### Environment files

```bash
cp backend/.env.example                 backend/.env
cp frontend/dispatcher/.env.example     frontend/dispatcher/.env.local
cp frontend/driver-pwa/.env.example     frontend/driver-pwa/.env.local
cp frontend/receiver/.env.example       frontend/receiver/.env.local
cp frontend/client-portal/.env.example  frontend/client-portal/.env.local
```

Every `.env.example` documents its keys inline — read them, they explain more than this
guide repeats. Fill in from the team secret store:

- `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY`, `HEDERA_TOPIC_ID`
- the frontends' `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Leave every `*_USE_MOCK` flag at `true` (Parcel Perfect, Pulsit, IDVS, scan feed). For
local work you can also set `RATE_LIMIT_ENABLED=false` — local dev and tests are the only
places that is acceptable.

Do not touch `DB_POOL_SIZE=2` / `DB_MAX_OVERFLOW=1`. Supabase's session pooler caps the
whole project at 15 concurrent clients across all four developers; those numbers are what
keep four local backends from locking each other out.

---

## 3. Running it — localhost only

Four or five terminals. Nothing here needs Docker except Redis.

```bash
# 1 — Redis
brew services start redis
#    or: docker compose -f infrastructure/docker/docker-compose.dev.yml up -d redis

# 2 — API
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

# 3 — Celery worker
cd backend && .venv/bin/celery -A app.tasks worker --loglevel=info

# 4 — Dispatcher
cd frontend/dispatcher && npm run dev        # http://localhost:3000

# 5 — Driver PWA
cd frontend/driver-pwa && npm run dev        # http://localhost:3001
```

And when you need them:

```bash
cd frontend/receiver      && npm run dev     # http://localhost:3002
cd frontend/client-portal && npm run dev     # http://localhost:3003
```

Each frontend's `npm run dev` already pins its own port, so you never pass `--port`.

### Check it came up

```bash
curl http://127.0.0.1:8000/health
open http://localhost:8000/docs        # Swagger, development only
```

`/health` reports per-dependency status — if Postgres or Redis is unreachable it says so
there rather than failing on your first real request.

---

## 4. The Docker alternative

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d --build
docker compose -f infrastructure/docker/docker-compose.dev.yml ps
docker compose -f infrastructure/docker/docker-compose.dev.yml logs -f api
```

That gives you Redis, the API (on 8000, with reload, source bind-mounted), a Celery
worker, and the dispatcher (on 3000). It does **not** run the driver PWA, receiver, or
client portal — run those with `npm run dev` alongside. It does not run Postgres either;
the database is still Supabase.

---

## 5. Exposing it to your phone over the LAN

Find your Mac's address on the Wi-Fi network:

```bash
ipconfig getifaddr en0      # try en1 if that prints nothing
```

Call it `192.168.1.5` below. Substitute yours. **It changes when you change networks**,
and every value below has to be re-edited when it does — that is the single most common
cause of "it worked yesterday".

### Bind the API to all interfaces

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Without `--host 0.0.0.0`, uvicorn listens on loopback only and the phone cannot see it at
all. The Next dev servers already bind all interfaces; `npm run dev -- -H 0.0.0.0` makes
that explicit if you want it in the command.

### Point the frontends at the LAN API

In each `.env.local` you are using, `NEXT_PUBLIC_API_URL` must be an address **the phone**
can reach, not your Mac's loopback:

```bash
NEXT_PUBLIC_API_URL=http://192.168.1.5:8000
```

A `localhost` value here resolves to the phone itself and the first request dies at the
network layer. On the receiver page that surfaces as "We couldn't reach the server".
Restart the dev server after editing — Next reads `.env.local` at boot.

### Let the API accept those origins — `backend/.env`

```bash
ALLOWED_ORIGINS=["http://localhost:3000","http://localhost:3001","http://192.168.1.5:3000","http://192.168.1.5:3001"]
HANDOVER_RECEIVER_BASE_URL=http://192.168.1.5:3002
AUDIT_PACK_PORTAL_BASE_URL=http://192.168.1.5:3003
```

Three things to know about this block:

1. `ALLOWED_ORIGINS` **replaces** the default list wholesale. If you set it, localhost has
   to be in it too or your desktop browser breaks.
2. The receiver and portal origins are folded into the CORS allow-list automatically from
   those two base URLs — don't also list them in `ALLOWED_ORIGINS`.
3. **Never add `capacitor://localhost` or `https://localhost`.** Those are the native
   driver app's origins and `Settings.cors_allowed_origins` folds them in for you,
   precisely so nobody can delete them. Someone deleting them once broke every API call
   the driver app made.

Restart uvicorn after editing `.env` — `--reload` watches Python files, not your
environment.

### A note on Next 15 and LAN origins

Loading a dev server by IP makes requests to `/_next/*` cross-origin, and Next 15.5 logs a
warning about it. It still works today. If a future upgrade turns that into a hard block,
the fix is `allowedDevOrigins` in `next.config.ts` — but those are shared files, so raise
it with the team rather than editing them on your branch.

---

## 6. Getting the driver app onto the iPhone — no Xcode

This is the path to use. It takes about ten minutes and gives you a real installed app
icon, full screen, no Safari chrome.

### Why you cannot just browse to `http://192.168.1.5:3001`

You can, and the pages will load — but iOS Safari gates **geolocation, camera, and service
workers** behind a secure context. Over plain HTTP on a LAN IP, every GPS capture step in
the phase flow fails, and a production build has no fallback coordinate (the dev-only
fallback is compiled out on purpose — a fabricated coordinate that looks genuine is the
worst defect this app could ship). So you need HTTPS.

### Step 1 — two HTTPS tunnels

```bash
brew install cloudflared

# terminal A — backend
cloudflared tunnel --url http://localhost:8000
#   → https://random-words-1234.trycloudflare.com

# terminal B — driver app
cloudflared tunnel --url http://localhost:3001
#   → https://other-words-5678.trycloudflare.com
```

No account, no login. Both URLs are publicly trusted HTTPS. They are also **new on every
restart**, which matters in step 3.

### Step 2 — allow the tunnel origin in `backend/.env`

Add the driver tunnel origin to `ALLOWED_ORIGINS` and restart uvicorn:

```bash
ALLOWED_ORIGINS=["http://localhost:3000","http://localhost:3001","https://other-words-5678.trycloudflare.com"]
```

### Step 3 — build the driver app against the backend tunnel

The driver PWA is a static export (`output: 'export'`), so **`NEXT_PUBLIC_API_URL` is baked
into the bundle at build time.** There is no server to read it at runtime. Change the
backend URL, rebuild — there is no other way.

```bash
cd frontend/driver-pwa
NEXT_PUBLIC_API_URL=https://random-words-1234.trycloudflare.com \
NEXT_PUBLIC_SUPABASE_URL=<project url> \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
npm run build

npx serve out -l 3001
```

`next.config.ts` deliberately throws if `NEXT_PUBLIC_API_URL` is unset or contains
`localhost` on a production build, so a mis-targeted build fails loudly here instead of
installing an app that accepts a login and then reaches nothing.

Build, not `npm run dev`, for two reasons: the service worker is disabled in development
(`disable: NODE_ENV === "development"`), and offline behaviour is a large part of what you
are testing. For ordinary day-to-day UI work `npm run dev` over the tunnel is fine — you
just won't get the SW or offline queueing.

### Step 4 — install it

On the iPhone, open the **driver** tunnel URL in Safari (not Chrome — only Safari can
install to the home screen), then **Share → Add to Home Screen**. It launches standalone
from the manifest. Grant location and camera when first prompted.

### Step 5 — drive a trip

Create a trip in the dispatcher (section 3), log in on the phone as the seeded driver, walk
the phases. Watch the Celery worker's terminal — each completed phase should anchor rather
than sit at `pending`.

### If you have no internet for a tunnel

`npm run dev -- --experimental-https` makes Next generate a locally-trusted certificate via
mkcert and prints its path. For the iPhone to accept it you must AirDrop the generated root
CA to the phone, install the profile under **Settings → General → VPN & Device
Management**, then enable it under **Settings → General → About → Certificate Trust
Settings**. It works, but the tunnel is less fuss.

---

## 7. The native iOS shell — if you actually want Xcode

Only worth doing if you need the native camera/push/Capacitor behaviour rather than the
product itself. Be honest with yourself about that first: it's a ~40 GB download.

**There is no way around full Xcode.** Command Line Tools alone cannot build an iOS app —
no iOS SDK, no simulator, no `xcodebuild` that targets a device. But you can install and
drive all of it from the terminal.

```bash
brew install xcodesorg/made/xcodes
xcodes install --latest             # prompts for your Apple ID; ~40 GB
#   alternative: brew install mas && mas install 497799835

sudo xcode-select -s /Applications/Xcode.app
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch
brew install cocoapods
```

Then build and install to the device:

```bash
cd frontend/driver-pwa
NEXT_PUBLIC_API_URL=http://192.168.1.5:8000 \
NEXT_PUBLIC_SUPABASE_URL=<project url> \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key> \
npm run build

npx cap sync ios
(cd ios/App && pod install)

xcrun xctrace list devices          # find your iPhone's UDID
npx cap run ios --target <UDID>
```

Four things that will bite you:

- **Code signing is the one step that is genuinely painful without the GUI.** The App
  target needs a development team, and `cap run ios` won't set one up for you. Ask Tim
  which team ID to use — there are two on the account — and expect to either pass
  `DEVELOPMENT_TEAM=... -allowProvisioningUpdates` through to `xcodebuild` or open Xcode
  exactly once to set it.
- **Developer Mode.** iOS 16+ requires it: connect the phone, trust the computer, then
  **Settings → Privacy & Security → Developer Mode** (the entry only appears once dev
  tooling has connected).
- **Never accept Xcode's "Update to recommended settings" banner** for the App project. It
  sets `ENABLE_USER_SCRIPT_SANDBOXING = YES`, which makes CocoaPods' embed-frameworks
  script fail the sandbox and breaks the build outright. See
  [known-issues.md §3](known-issues.md).
- **Plain HTTP is fine here**, unlike the PWA — `Info.plist` sets `NSAllowsLocalNetworking`,
  so the native app can talk to `http://192.168.1.5:8000` with no tunnel. iOS will ask for
  Local Network permission on first launch. Don't add any other ATS exception.

---

## 8. Data to test against

```bash
cd backend
PYTHONPATH=. .venv/bin/python scripts/seed_trips.py
DISPATCHER_SEED_PASSWORD='...' PYTHONPATH=. .venv/bin/python scripts/seed_demo.py
```

Read each script's docstring before running it — they say what they target and whether
they're safe to re-run.

`trips.trip_reference` is UNIQUE, so re-seeding fails on the second run until lifecycle
rows are cleared. `scripts/dev_reset_lifecycle.py` does that, and it requires
`--project-ref` matched against `DATABASE_URL`'s host before it touches a row — that guard
is the only safety net, so don't bypass it. Its docstring has the exact invocation.

Also: the shared dev database collects trips created before the phase refactor, and a stale
pre-refactor trip will break a driver walk in confusing ways. If the walk misbehaves on a
trip you didn't just create, reseed before debugging.

---

## 9. When it doesn't work

| Symptom | Cause |
|---|---|
| Driver login bounces back to the login screen, no error | `NEXT_PUBLIC_API_URL`, the Supabase project, or the driver UUID disagree. All three must match the same environment. |
| Last phase of every trip stuck `pending` | No Celery worker running. |
| CORS error in the Safari/Chrome console | The LAN or tunnel origin isn't in `ALLOWED_ORIGINS`, or uvicorn wasn't restarted after editing `.env`. |
| Receiver page: "We couldn't reach the server" | `NEXT_PUBLIC_API_URL` is `localhost` — it resolves to the receiver's phone. |
| GPS step fails on the phone every time | Not a secure context. You're on `http://` — use the tunnel (section 6). |
| Phone can't reach the API at all | uvicorn is missing `--host 0.0.0.0`, or your LAN IP changed. |
| App reloads and strands you mid-step in the native shell | Extension-less paths fall back to `index.html`, which serves Home. Known trap, not your mistake. |
| Dispatcher tests won't even start | `node -v` isn't 22. |
| Database connection errors with everyone else working fine | Supabase's 15-client pooler cap. Check nobody's raised `DB_POOL_SIZE`. |

---

## 10. Four things not to do

1. **Never run `alembic upgrade` from a feature branch.** `DATABASE_URL` is the shared
   Supabase dev database and records one `alembic_version`. Stamping it with a revision
   that only exists on your branch breaks Alembic for the other three of us until you
   merge. Apply from `dev`, after merge.
2. **Never point `TEST_DATABASE_URL` at Supabase.** `tests/conftest.py` runs
   `drop_all()` against it at teardown. Use the throwaway compose Postgres:
   `docker compose -f infrastructure/docker/docker-compose.test.yml up -d`.
3. **Never commit `.env`.** New config key? Add the empty key to `.env.example`, add the
   field to `core/config.py`, and flag it in your PR. The Supabase `service_role` key never
   appears in code or config.
4. **Blank `DEV_PANEL_ENABLED` again** after a demo. It registers endpoints that fabricate
   warehouse scans, Parcel Perfect changes, and exceptions, and it's the only switch
   gating them — in every environment.

---

## Related docs

- [setup.md](setup.md) — the short canonical setup, localhost only
- [deployment-runbook.md](deployment-runbook.md) — deployed environments, TestFlight
- [known-issues.md](known-issues.md) — including the Xcode build break in §3
- [demo-script.md](demo-script.md) — what to actually click once it's all up
