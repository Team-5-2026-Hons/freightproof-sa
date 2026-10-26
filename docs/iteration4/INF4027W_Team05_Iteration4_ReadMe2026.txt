================================================================================
FreightProof SA — Read Me
INF4027W Honours Project · University of Cape Town · 2026
Team 05 — Ciaran Formby, Tim Gultig, Chiko Kasongo, Tom Davis
Iteration 4 submission
================================================================================

Cargo theft and disputed delivery evidence platform for the South African
logistics industry.

Source repository:  https://github.com/Team-5-2026-Hons/freightproof-sa
Code archive:       INF4027W_Team05_Iteration4_Code2026.zip

Live deployment
  Dispatcher dashboard      https://www.freightproof.co.za
  Receiver handover page    https://receiver.freightproof.co.za
  Client evidence portal    https://client-portal.freightproof.co.za
  API                       https://api.freightproof.co.za
  Driver app                Apple TestFlight (not publicly reachable)

The API runs on Fly.io in Stockholm; the three web surfaces are separate Vercel
projects; PostgreSQL and object storage are Supabase (eu-north-1). Details under
"Live deployment" below.

--------------------------------------------------------------------------------

## What is in the code archive

INF4027W_Team05_Iteration4_Code2026.zip unpacks to a single folder containing:

    backend/          FastAPI application, Alembic migrations, test suite
    frontend/         dispatcher, driver-pwa, receiver, client-portal, shared
    infrastructure/   Docker compose files for local development and testing
    .github/          CI workflow
    README.md         the same content as this document
    LICENSE

Excluded from the archive: the documentation set (submitted separately), build
output, installed dependencies (node_modules, .venv), and environment files. The
annotated .env.example files are included so the setup steps below can be
followed; they contain key names and explanatory comments, no values.

--------------------------------------------------------------------------------

## What it does

FreightProof records every custody handover in a road freight trip, from origin depot to
destination depot, and anchors a SHA-256 hash of each recorded phase to the Hedera
Consensus Service. When a hijacking, disputed delivery, or missing-parcel claim arises,
the trip's record shows who had the cargo, in which vehicle, where, and when — and
whether that record has changed since it was written.

It does not replace GPS tracking (Pulsit), manifest systems (Parcel Perfect), or gate
security. It sits at the handover moments between those systems and records what
happened. It records; it does not reroute drivers or dispatch a response.

## The problem

South Africa accounts for most truck hijackings in the EMEA region — around 2,000
incidents in 2024 at a direct cost of roughly R3 billion. Every leg of a trip is already
instrumented (GPS, manifest scans, gate logs), but those systems do not share data at the
moment custody changes hands, which is where organised cargo theft operates.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                          Frontends                           │
│   Dispatcher (Next.js)   Driver PWA (Next.js + Capacitor)    │
│   Receiver handover page (Next.js, QR link, no account)      │
└───────────────────────────────┬──────────────────────────────┘
                                │ HTTPS / server-sent events
┌───────────────────────────────▼──────────────────────────────┐
│                FastAPI backend (Python 3.13)                 │
│  api · auth · orchestration · analytics · blockchain · tasks │
└──────┬───────────────────────────────────────────────────────┘
       │
┌──────▼──────┐  ┌──────────────┐  ┌──────────────────────────┐
│ PostgreSQL  │  │ Redis/Celery │  │ Supabase Storage         │
│ (Supabase)  │  │              │  │ (photos, evidence files) │
└─────────────┘  └──────────────┘  └──────────────────────────┘
       │
┌──────▼───────────────────────────────────────────────────────┐
│ External: Hedera HCS · Parcel Perfect · Pulsit · IDVS (Didit)│
└──────────────────────────────────────────────────────────────┘
```

Backend layering is strict: `endpoints → orchestration/auth/storage →
integrations/blockchain/crypto → db`. Endpoints stay thin; business rules live in
`orchestration/`.

**Privacy (POPIA):** personal data — identities, GPS fixes, photos, parcel details — stays
in PostgreSQL. Only SHA-256 hashes are sent to Hedera.

The Supabase project is in `eu-north-1` (Stockholm), so that personal data is resident in
the EU rather than in South Africa. The team treats this as an accepted interim position
pending a documented cross-border transfer basis under POPIA section 72 — it was not a
designed data-residency boundary. The hash-only boundary at Hedera is unaffected by region.

---

## The phase model

At creation, each trip gets a committed **phase plan** generated from its ordered stops
and consignments. The phase-event ledger is the source of truth; the trip's current phase
and stop are caches rebuilt from it, and every transition is validated against the plan.

There are eight phase types:

| Phase | Where | What it records |
|---|---|---|
| `trip_creation` | — | The committed trip parameters, hashed as the journey lock |
| `activation` | First stop | Driver, vehicle, and position at the start of the trip |
| `arrival` | Every later stop | The seal as found at the gate, before anything is opened |
| `unloading` | Stops that receive cargo | What was taken off the vehicle |
| `loading` | Stops that dispatch cargo | What was put on the vehicle |
| `departure` | Every stop except the last | Seal applied, waybill, departure position |
| `in_transit` | Between stops | The driving leg, closed by the driver's arrival |
| `confirmation` | Final stop | Proof of delivery and count reconciliation |

Plan length is data, not a constant. A two-stop loaded trip has 8 rows; a three-stop
cross-dock has 13, because `arrival`, `loading`, and `unloading` recur per stop. Each
completed phase has a canonical payload hashed for Hedera anchoring, with its anchor
status (pending, failed, anchored) kept on the ledger. Only hashes go to Hedera. The
journey lock commits to the trip ID, order number, driver, horse, trailer IDs, origin
and destination precinct IDs, creator, creation time, and trip type. New trips use the v2
payload, which adds the ordered stops and their slot times, so changing an intermediate
stop breaks the lock too. Trips created before v2 keep their v1 lock, which covers only
origin and destination, and still verify against it. Consignments and the phase plan
are deliberately outside the lock: the phase ledger records cargo custody, and a
manifest trip's cargo is pinned by its manifest snapshot hash
(`backend/app/crypto/hashing.py`).

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13, FastAPI, SQLAlchemy 2.0 (async), Alembic, Pydantic v2 |
| Auth | Supabase Auth (phone OTP for drivers), JWT verified server-side with python-jose |
| Blockchain | Hedera Consensus Service via REST, SHA-256 hashing |
| Database | PostgreSQL (Supabase-managed); throwaway Postgres for the integration suite |
| Queue | Redis 7, Celery (anchoring and background work) |
| Storage | Supabase Storage |
| Frontend | Next.js 15 (App Router), React 19, TypeScript 5.5, Tailwind CSS |
| Driver app | Next.js static export + Capacitor (Android APK) + @serwist/next (browser PWA) |
| Hosting | API on Fly.io (Stockholm); dispatcher, receiver and client portal on Vercel; database and object storage on Supabase (`eu-north-1`) |
| CI | GitHub Actions (`.github/workflows/ci.yml`) |

---

## Project structure

```
backend/
├── app/
│   ├── api/v1/endpoints/   FastAPI routes (thin)
│   ├── analytics/          Fleet, vehicle, lane and facility read models
│   ├── auth/               Supabase Auth integration and dependencies
│   ├── blockchain/         Hedera HCS anchoring
│   ├── core/               Config, constants, exceptions
│   ├── crypto/             SHA-256 hashing
│   ├── db/models/          SQLAlchemy models, one file per table
│   ├── integrations/       Parcel Perfect, Pulsit, IDVS, scan feed (each with a mock)
│   ├── orchestration/      Phase plan, phase engine, geofence and exception services
│   ├── schemas/            Pydantic v2 request/response models
│   ├── storage/            Supabase Storage I/O
│   └── tasks/              Celery tasks
├── migrations/             Alembic migrations
└── tests/                  unit/ (pure logic) and integration/ (endpoints + DB)
frontend/
├── dispatcher/             Dispatcher dashboard (port 3000)
├── driver-pwa/             Driver phase-capture app (port 3001)
├── receiver/               Receiver QR handover page (port 3002)
├── client-portal/          Audit-pack share-link portal for insurers and clients (port 3003)
└── shared/                 Types, constants and utilities shared via @shared/*
infrastructure/docker/      Dev stack (Redis, API, Celery worker, dispatcher) and test Postgres
```

---

## Implementation status

- **Implemented:** trips, phase plan and phase ledger (including the destination
  `arrival` phase), evidence capture, exceptions, incidents, manifests, analytics, the
  receiver handover, driver substitution (an anchored amendment chain; the original
  journey lock stays valid), audit packs, the client evidence portal (share-link access,
  with hash verification against the public Hedera mirror run in the reader's browser),
  Hedera anchoring, and dev tooling for demonstrations.
- **Mocked for local use and demos:** Parcel Perfect, Pulsit tracking, IDVS identity
  checks, and the warehouse scan feed, each selected by a `*_USE_MOCK` flag. Mock output
  is not provider evidence.
- **Live-capable, not verified against a live provider:** the Pulsit and Didit (IDVS)
  clients, which are selected when their mock flags are off and credentials are present.
- **Simulated, no live contract:** the Parcel Perfect manifest lookup and the warehouse
  scan feed run on their mocks only; the live clients refuse rather than fake success.
- **Not built (deferred):** Ed25519 evidence signing, the per-step child-event ledger and
  Merkle batching (the Merkle tables are scaffolding; every anchor today is an individual
  hash), dispatcher call logging, and live SLA metrics.
- **Not validated:** behaviour under concurrent load (FP-299). Accepted security
  limitations from the 23 October review are recorded in the team's known-issues
  document, section 12, which is submitted separately from this code archive.

---

## Getting started

### Prerequisites

Python 3.13+, Node.js 22 LTS, Docker Desktop, and Git. Android Studio (SDK 34+, Java 17)
only if you want to build the driver APK.

### 1. Environment

```bash
cp backend/.env.example backend/.env
```

Fill in values from the team's shared secret store. Each `.env.example` lists key names
and explains what each key controls. Leave the `*_USE_MOCK` flags set to `true` for local
development. The frontends each have their own `.env.example`.

### 2. Install

```bash
python3.13 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt

cd frontend/dispatcher && npm install
cd ../driver-pwa && npm install
cd ../receiver && npm install
cd ../client-portal && npm install
```

### 3. Run

Each in its own terminal:

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend/dispatcher && npm run dev
cd frontend/driver-pwa && npm run dev
cd frontend/receiver && npm run dev
cd frontend/client-portal && npm run dev
```

The API serves Swagger docs at `http://localhost:8000/docs` in development.

Alternatively, `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d --build`
runs Redis, the API, a Celery worker, and the dispatcher. It does not run Postgres; the
database is the Supabase project in `DATABASE_URL`.

### 4. Driver mobile build (optional)

The driver app is a Next.js static export wrapped in a Capacitor shell. Both an iOS and an
Android project exist under `frontend/driver-pwa/`; the build distributed to testers is the
iOS one, via Apple TestFlight. The Android project is kept current but has not been run
against the hosted API.

Because the app is a static export there is no server to read configuration at runtime:
`NEXT_PUBLIC_API_URL` is baked into the bundle at build time and cannot be changed without
a new build. A production build also refuses to start unless `NEXT_PUBLIC_DEMO_MODE` is set
explicitly — `false` for the real backend, `true` for a simulated demo build.

```bash
cd frontend/driver-pwa
npm run build          # static export to out/

npx cap sync ios       # copies out/ into the iOS project
npx cap open ios       # opens Xcode; run on a device or archive for TestFlight

npx cap sync android   # or the Android equivalent
npx cap open android   # opens Android Studio
```

There is no hosted browser build of the driver app. `output: 'export'` means the
`headers()` block in `next.config.ts` does nothing, so if one is ever published its
security headers have to be set at the hosting layer.

---

## Tests

Integration tests need `TEST_DATABASE_URL` pointing at a throwaway Postgres — never a
Supabase project, because the suite drops all tables at teardown. Without it, DB-backed
tests skip rather than fail.

```bash
docker compose -f infrastructure/docker/docker-compose.test.yml up -d
cd backend && .venv/bin/pytest
```

Frontend tests run with Vitest: `npm test` in each frontend directory.

## Database migrations

All schema changes go through Alembic. `DATABASE_URL` is a shared database with a single
Alembic version, so migrations are applied only from `dev` after merge — never from a
feature branch. Review every autogenerated operation in both `upgrade()` and `downgrade()`
before committing a migration.

## Contributing

Branch from `dev` and open a pull request back into `dev`. The project conventions:
Conventional Commits (`type(scope): description`); unit and integration tests for every
backend feature, passing before a pull request is opened; and the backend layering rule
below, which import-linter enforces in CI.

    endpoints -> orchestration / auth / storage -> integrations / blockchain / crypto -> db

Endpoints stay thin. `integrations/` never imports from `api/` or `orchestration/`, and
`db/` never imports from elsewhere in `app/`.

---

## Live deployment

| Surface | Host | Origin |
|---|---|---|
| Dispatcher dashboard | Vercel | https://www.freightproof.co.za |
| Receiver handover page | Vercel | https://receiver.freightproof.co.za |
| Client evidence portal | Vercel | https://client-portal.freightproof.co.za |
| API | Fly.io | https://api.freightproof.co.za |
| Driver app | Apple TestFlight | in-app (`capacitor://localhost`) |

**The API.** One Docker image, three Fly processes (`backend/fly.toml`): the uvicorn web
process, a Celery worker, and a Celery beat scheduler. All three are needed — under a
web-only deployment every Hedera anchor queued by an endpoint sits in Redis unclaimed and
none of the scheduled sweeps run, so nothing retries a failed anchor either. Beat must stay
at exactly one machine; two schedulers fire every recovery sweep twice, which means
duplicate Hedera submissions. Scale-to-zero is off, because a cold start would land on a
driver mid-handover and the delay would be carried into the evidence timestamps.

**Region.** Compute is pinned to Stockholm (`primary_region = "arn"`) to sit next to the
Supabase project in `eu-north-1`, rather than pay a transatlantic round trip per query.

**Deploys are manual.** `fly deploy` from `backend/`; Vercel builds each frontend project
from its own root directory on push. Nothing in the deploy runs Alembic — migrations are
applied by hand from `dev` after merge, because `DATABASE_URL` is a shared database with a
single Alembic version.

Each frontend is a separate Vercel project with its own root directory under `frontend/`.
The receiver cannot be served from a `*.vercel.app` URL: its handover binding cookie is
`SameSite=Strict; Secure`, so the app must share a registrable domain with the API, which
is why the subdomains above are a constraint rather than a preference.

## Licence

Copyright (c) 2026 Ciaran Formby, Tim Gultig, Chiko Kasongo, Tom Davis.
University of Cape Town — INF4027W Honours Project. All rights reserved. See
LICENSE.
