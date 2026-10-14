# FreightProof SA

Cargo theft and disputed delivery evidence platform for the South African logistics industry.

**INF4027W Honours Project — University of Cape Town — 2026**
Ciaran Formby · Tim Gultig · Chiko Kasongo · Tom Davis

---

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
and destination precinct IDs, creator, creation time, and trip type. Changes to those
fields can be detected against the anchored hash; intermediate stops and consignments
are outside the current journey-lock payload.

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
└── shared/                 Types, constants and utilities shared via @shared/*
infrastructure/docker/      Dev stack (Redis, API, Celery worker, dispatcher) and test Postgres
```

---

## Implementation status

- **Implemented:** trips, phase plan and phase ledger, evidence capture, exceptions,
  manifests, analytics, the receiver handover, Hedera anchoring, and dev tooling for
  demonstrations.
- **Mocked for local use and demos:** Parcel Perfect, Pulsit tracking, IDVS identity
  checks, and the warehouse scan feed, each selected by a `*_USE_MOCK` flag. Mock output
  is not provider evidence.
- **Live-capable, not verified against a live provider:** the Pulsit and Didit (IDVS)
  clients, which are selected when their mock flags are off and credentials are present.
- **Not built:** the client evidence portal (`frontend/client-portal/` holds a README
  only) and Ed25519 evidence signing.

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
```

### 3. Run

Each in its own terminal:

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend/dispatcher && npm run dev
cd frontend/driver-pwa && npm run dev
cd frontend/receiver && npm run dev
```

The API serves Swagger docs at `http://localhost:8000/docs` in development.

Alternatively, `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d --build`
runs Redis, the API, a Celery worker, and the dispatcher. It does not run Postgres; the
database is the Supabase project in `DATABASE_URL`.

### 4. Driver Android APK (optional)

```bash
cd frontend/driver-pwa
npm run build          # static export to out/
npx cap sync android   # copies out/ into the Android project
npx cap open android   # opens Android Studio; run on a device or emulator
```

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

Branch from `dev`, open a pull request back into `dev`, and follow the conventions in
[CLAUDE.md](CLAUDE.md) (Conventional Commits, testing requirements, layering rules).

---

## Live deployment

| Surface | URL |
|---|---|
| Frontend (Vercel) | [freightproof-sa.vercel.app](https://freightproof-sa.vercel.app/) |
| Backend API (Railway) | [freightproof-sa.up.railway.app](https://freightproof-sa.up.railway.app) |

## Licence

Copyright (c) 2026 Ciaran Formby, Tim Gultig, Chiko Kasongo, Tom Davis.
University of Cape Town — INF4027W Honours Project. All rights reserved. See
[LICENSE](LICENSE).
