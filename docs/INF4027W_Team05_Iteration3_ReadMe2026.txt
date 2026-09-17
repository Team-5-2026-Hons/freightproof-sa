# FreightProof SA

Cargo theft and disputed delivery evidence platform for the South African logistics industry.

**INF4027W Honours Project — University of Cape Town — 2026**
Ciaran Formby · Tim Gultig · Chiko Kasongo · Tom Davis

---

## What it does

FreightProof records every handover in a road freight trip — from origin depot to destination depot — and anchors a tamper-proof hash of each event to the Hedera public blockchain. When a hijacking, disputed delivery, or missing parcel claim arises, FreightProof produces a complete evidence chain: the right driver, the right vehicle, the right cargo, at the right place and time, verified from multiple independent sources.

It does not replace Pulse Tracking (GPS), Parcel Perfect (manifests), or Fidelity/G4S (gate security). It sits at the gaps between those systems — the handover moments — where organised cargo theft currently operates undetected.

---

## The problem

South Africa accounts for roughly 95% of all truck hijackings across the EMEA region. Around 2,000 incidents in 2024 at a direct cost of R3 billion. Cargo insurance premiums sit at 12.5% of cost-per-kilogram for road freight.

Every leg of a trip is already instrumented — GPS, manifest scans, gate access logs. The problem is that none of these systems share data at the moment it matters: the handover. FreightProof closes that gap.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────┐
│                        Frontends                         │
│  Dispatcher (Next.js)  Driver PWA   Guard*  Portal*      │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS / WebSocket
┌────────────────────────▼────────────────────────────────┐
│              FastAPI Backend (Python 3.13)               │
│  api/  auth/  orchestration/  blockchain/  integrations/ │
└──────┬──────────────────────────────────────────────────┘
       │
┌──────▼──────┐  ┌────────┐  ┌──────────────────────────┐
│ PostgreSQL  │  │ Redis  │  │ Supabase Storage         │
│ (Supabase) │  │        │  │ (photos, evidence files) │
└─────────────┘  └────────┘  └──────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────┐
│                  External integrations                   │
│  Parcel Perfect · Hedera HCS                             │
│  Pulse Tracking · IDVS · Twilio · SendGrid  (planned)*   │
└─────────────────────────────────────────────────────────┘
```
\* Not yet built — see "Current implementation status" below.

Full architecture documentation: docs/FreightProof_Full_Picture_v7.md (latest); see also docs/phase-model-explained.md and docs/db-models.md

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13, FastAPI, SQLAlchemy 2.0 async, Alembic, Celery |
| Auth | Supabase Auth (phone/OTP for drivers), JWT verification via python-jose |
| Blockchain | Hedera HCS via REST API, SHA-256 hashing (blockchain/hedera.py) |
| Database | PostgreSQL, Supabase-managed for dev/prod; local integration-test Postgres via docker-compose.test.yml (port 5433) |
| Cache / Queue | Redis 7, Celery |
| Storage | Supabase Storage |
| Frontend | Next.js 15 (App Router), TypeScript 5.5, React 19, Tailwind CSS |
| Driver PWA | Next.js 15 + Capacitor (Android APK) + @serwist/next (browser PWA / Workbox) |
| Guard page | Plain HTML + JS (zero install, zero login) — not yet scaffolded, see Current status below |
| Infrastructure | Docker, hosted on Vercel (frontend) + Railway (backend) — see live links below |
| CI/CD | GitHub Actions (.github/workflows/ci.yml) |

Note: Ed25519 evidence signing (PyNaCl) and AWS ECS/RDS deployment are planned, not yet implemented — see Current implementation status below.

---

## Project structure

```
freightproof-sa/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # FastAPI route definitions
│   │   ├── auth/               # Supabase Auth integration, session handling, dependencies
│   │   ├── blockchain/         # Hedera HCS anchoring
│   │   ├── core/               # Config, constants, exceptions
│   │   ├── crypto/             # SHA-256 hashing (Ed25519 signing planned, not yet landed)
│   │   ├── db/
│   │   │   ├── models/         # SQLAlchemy ORM models
│   │   │   └── session.py      # Async engine and get_db()
│   │   ├── analytics/          # Fleet/reporting read models
│   │   ├── integrations/       # Parcel Perfect (live), scan feed mock; Pulse/IDVS/Twilio/SendGrid not yet wired
│   │   ├── orchestration/      # Trip state machine, phase logic
│   │   ├── schemas/            # Pydantic v2 request/response models
│   │   ├── storage/            # Supabase Storage I/O
│   │   └── tasks/              # Celery background tasks
│   ├── migrations/             # Alembic migrations
│   └── tests/
│       ├── unit/               # Pure logic tests (no DB, no HTTP)
│       └── integration/        # API and database tests
├── frontend/
│   ├── dispatcher/             # Next.js — dispatcher dashboard (built)
│   ├── driver-pwa/             # Next.js PWA — driver phase-capture app (built)
│   ├── guard/                  # Plain HTML — guard gate page (spec only, Sprint 2)
│   ├── client-portal/          # Next.js — client evidence portal (spec only, Sprint 3)
│   └── shared/                 # Types, mocks, constants shared via @shared/*
├── infrastructure/
│   ├── docker/
│   │   ├── docker-compose.dev.yml    # Postgres + Redis for local dev
│   │   └── docker-compose.test.yml   # Throwaway Postgres for the integration suite
│   └── nginx/
│       └── nginx.dev.conf
├── docs/
├── CLAUDE.md                   # Claude Code instructions for all developers
├── LICENSE
└── README.md
```

---

## Current implementation status

FreightProof SA is in active, incremental development (agile sprints). What exists today:

Built:
- Backend: 16 registered route groups covering trips, phases, drivers, vehicles, precincts, blockchain receipts, artifacts, exceptions, locations, checkpoints, manifests, Parcel Perfect lookups, and dev-only trigger tooling. 76 test files across unit/ and integration/.
- Trip phase model (P0–P6) with a phase-event ledger, Hedera HCS anchoring for the journey lock hash and pickup/delivery receipts, SHA-256 hashing (crypto/hashing.py).
- Auth via Supabase Auth (phone/OTP for drivers), JWT verified server-side with python-jose.
- Parcel Perfect integration (integrations/parcel_perfect.py) with a mock toggle for local dev.
- Frontend: dispatcher/ (Next.js dashboard) and driver-pwa/ (Next.js + Capacitor Android APK + browser PWA) — both fully scaffolded and in use.
- CI on GitHub Actions (.github/workflows/ci.yml).

Not yet implemented (do not assume these work):
- Ed25519 evidence signing (PyNaCl) — crypto/ only has SHA-256 hashing so far.
- Pulse Tracking, IDVS, Twilio, and SendGrid integrations — config keys and mock toggles exist in core/config.py, but no client code has been written yet.
- frontend/guard/ — plain HTML gate page, specced for Sprint 2, not scaffolded.
- frontend/client-portal/ — read-only client evidence portal, specced for Sprint 3 (blocked on PDF evidence export), not scaffolded.
- AWS ECS Fargate / RDS production deployment — current live deploys run on Vercel (frontend) and Railway (backend); see links below.

---

## Getting started

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | 3.13+ | python.org |
| Node.js | 22 LTS | nodejs.org |
| Docker Desktop | latest | docker.com/products/docker-desktop |
| Git | any | git-scm.com |

### 1. Clone the repo

```bash
git clone https://github.com/Team-5-2026-Hons/freightproof-sa.git
cd freightproof-sa
```

### 2. Set up environment variables

```bash
cp backend/.env.example backend/.env
```

Open backend/.env and fill in your credentials. You need:
- Supabase database URI (connection string from Settings → Database → URI tab)
- Supabase anon key and service_role key (Settings → API)
- Hedera testnet account ID and private key from portal.hedera.com
- Leave IDVS_USE_MOCK, PULSE_USE_MOCK, PP_USE_MOCK, and SCAN_FEED_USE_MOCK set to true for local dev — none of the real clients besides Parcel Perfect are wired up yet, and Parcel Perfect defaults to its mock too
- Twilio and SendGrid keys can stay blank — no client code calls them yet

See backend/.env.example for the full annotated key list. It has inline comments explaining what each key gates and why.

### 3. Start Docker services

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
```

Verify both containers are healthy:
```bash
docker ps
# freightproof-redis    Up (healthy)
# freightproof-postgres Up (healthy)
```

### 4. Install backend dependencies

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 5. Run database migrations

```bash
alembic upgrade head
```

### 6. Start the backend

```bash
uvicorn app.main:app --reload --port 8000
```

- API: http://localhost:8000/health
- Swagger docs: http://localhost:8000/docs

### 7. Start the dispatcher frontend

```bash
cd frontend/dispatcher
npm install
npm run dev
```

Opens at http://localhost:3000

### 8. Start the driver PWA (separate terminal)

```bash
cd frontend/driver-pwa
npm install
npm run dev -- --port 3001
```

Opens at http://localhost:3001

### 9. Build and run the driver Android APK (optional — requires Android Studio)

```bash
cd frontend/driver-pwa
npm run build          # Next.js static export → out/
npx cap sync android   # copies out/ into android/app/src/main/assets
npx cap open android   # opens Android Studio
```

In Android Studio: select a connected Samsung device or emulator → Run. The APK installs and launches the driver app natively.

Prerequisites: Android Studio with SDK Platform 34+, Java 17. ANDROID_HOME env var set.
Not required for browser-based development — npm run dev works without Android Studio.

---

## Development workflow

### Branch structure

```
main          ← production only, tagged releases
  └── dev     ← integration branch, always runnable
        └── feature/[name]-[what]   ← individual work
```

### Making changes

```bash
# Always start from an updated dev
git checkout dev
git pull origin dev

# Create your feature branch
git checkout -b feature/tim-auth-refresh-token

# Do your work, run tests before committing
cd backend && pytest

# Review your changes
git diff

# Stage and commit yourself — Claude does not commit
git add .
git commit -m "feat(auth): add JWT refresh token endpoint"
git push origin feature/tim-auth-refresh-token
```

Open a pull request into dev. One reviewer must approve before merging.

### Running tests

Integration tests need TEST_DATABASE_URL pointed at a throwaway Postgres — never a Supabase project, since the suite drops all tables at teardown:

```bash
docker compose -f infrastructure/docker/docker-compose.test.yml up -d
```

If TEST_DATABASE_URL is unset, DB-backed tests self-skip rather than fail.

```bash
# All tests
cd backend && pytest

# Unit tests only
cd backend && pytest tests/unit/

# Integration tests only
cd backend && pytest tests/integration/

# With coverage
cd backend && pytest --cov=app tests/
```

### Adding a database model

1. Create the model file in backend/app/db/models/yourmodel.py
2. Import it in backend/app/db/models/__init__.py
3. Generate a migration: alembic revision --autogenerate -m "add yourmodel table"
4. Review the generated file in migrations/versions/
5. Apply it: alembic upgrade head

Never modify the database schema directly in Supabase.

### Adding a new config value

1. Add the key with an empty value to backend/.env.example
2. Add the field to backend/app/core/config.py
3. Note it in your PR description so teammates add it to their .env

---

## The phase model

A trip moves through a plan-driven sequence of phases, generated from its stops and consignments
at trip creation. Plan length is data, not a constant — a single-leg trip is 7 rows (P0–P6 below),
a 3-stop cross-dock is 11, because loading/unloading can recur per stop. current_phase on the
trip is a cache rebuilt from the phase-event ledger; the ledger is the source of truth for where a
trip is.

| # | Phase | Who | What gets anchored |
|---|---|---|---|
| P0 | trip_creation | Dispatcher | Journey lock hash of all committed trip parameters |
| P1 | activation | Driver | Phone GPS on arrival at the first stop — not anchored |
| P2 | loading | System (driver visual count) | Not anchored |
| P3 | departure | Driver | Seal number, seal photo, waybill photo — PICKUP receipt |
| P4 | in_transit | System | Auto-completed on departure — not anchored |
| P5 | unloading | Driver | Seal-at-destination vs. this leg's departure seal — not anchored |
| P6 | confirmation | Driver | POD photo + signature, count reconciliation — DELIVERY receipt |

---

## Environment variables reference

Full key list lives in backend/.env.example — key names only, no values, per the project's secrets policy. Summary:

| Key | Required | Description |
|---|---|---|
| DATABASE_URL | Yes | PostgreSQL async URI (postgresql+asyncpg://...) |
| TEST_DATABASE_URL | No | Throwaway Postgres for the integration suite (never a Supabase project) — DB-backed tests self-skip if empty |
| REDIS_URL | Yes | Redis connection string |
| SUPABASE_URL | Yes | Supabase project URL |
| SUPABASE_ANON_KEY | Yes | Supabase anon/public key |
| SUPABASE_SERVICE_ROLE_KEY | Yes | Supabase service_role key — server-side only, never appears in code or logs |
| HEDERA_ACCOUNT_ID | Yes | Hedera account ID (format: 0.0.xxxxxx) |
| HEDERA_PRIVATE_KEY | Yes | Hedera account private key |
| HEDERA_NETWORK | Yes | testnet or mainnet |
| HEDERA_TOPIC_ID | No | HCS topic ID — required for real anchoring |
| HEDERA_SUBMIT_TIMEOUT_SECONDS | No | Hedera submit timeout, default 15.0 |
| EVIDENCE_SIGNED_URL_TTL_SECONDS | No | Lifetime of signed evidence-file URLs, default 300 |
| IDVS_USE_MOCK / IDVS_API_KEY / IDVS_API_URL | No | IDVS integration — mock toggle only, client not yet built |
| PULSE_USE_MOCK / PULSE_API_KEY / PULSE_API_URL | No | Pulse Tracking integration — mock toggle only, client not yet built |
| PP_USE_MOCK / PP_API_KEY / PP_API_PASSWORD / PP_API_TOKEN / PP_API_URL / PP_POLL_INTERVAL_SECONDS | Yes (mock or real) | Parcel Perfect — implemented and live, PP_USE_MOCK=true for local dev |
| SCAN_FEED_USE_MOCK | Yes | Warehouse scan feed — true selects the Redis-backed MockScanFeed |
| TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER | No | Twilio — provisioned, no client code written yet |
| SENDGRID_API_KEY / SENDGRID_FROM_EMAIL | No | SendGrid — provisioned, no client code written yet |
| GPS_TOLERANCE_METRES | No | Reserved for gate/geofence verification, default 50 |
| OPERATIONS_UTC_OFFSET_HOURS | Yes | Local offset for date-bucketed reads — 2 for SAST (no DST) |
| DEMO_MODE | Yes | true/false |
| DEV_PANEL_ENABLED | Yes | Gates the dev trigger panel in every environment including production — leave blank unless demoing |
| SESSION_IDLE_TIMEOUT_MINUTES | Yes | API-side idle session cutoff, default 10 — must match frontend/shared/lib/session/idle.ts |
| RATE_LIMIT_ENABLED | Yes | Leave true outside local dev/tests — budgets Hedera and Parcel Perfect quota |
| RATE_LIMIT_TRUST_PROXY_HEADERS | Yes | Only true behind a reverse proxy that overwrites X-Forwarded-For |
| ENVIRONMENT | Yes | development or production |
| ALLOWED_ORIGINS | Yes | JSON array of allowed CORS origins |

---

## Using Claude Code

All four developers use Claude Code on this project. Claude's behaviour is
governed by CLAUDE.md at the repo root — every Claude instance
reads it automatically at the start of each session.

Key rules Claude follows on this project:
- Makes a written plan before writing any code
- Writes unit and integration tests for every feature
- Never runs git commit, git push, or any git write command
- Only touches files within the declared scope of the task
- Flags shared file changes for team awareness
- Always uses latest stable versions — Python 3.13+, Next.js 15+, Node 22 LTS

If Claude's behaviour on your machine differs from another team member's,
check that you both have the latest CLAUDE.md from dev.

---

## Useful commands reference

```bash
# Start all Docker services
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d

# Stop all Docker services
docker compose -f infrastructure/docker/docker-compose.dev.yml down

# View Docker logs
docker logs freightproof-redis
docker logs freightproof-postgres

# Activate Python virtual environment
source backend/.venv/bin/activate

# Run the backend
cd backend && uvicorn app.main:app --reload --port 8000

# Run all tests
cd backend && pytest

# Generate a new migration
cd backend && alembic revision --autogenerate -m "description"

# Apply migrations
cd backend && alembic upgrade head

# Roll back one migration
cd backend && alembic downgrade -1

# Check current migration version
cd backend && alembic current

# Install frontend dependencies
cd frontend/dispatcher && npm install
cd frontend/driver-pwa && npm install
```

---

## Live deployment

| Surface | URL |
|---|---|
| Frontend (Vercel) | https://freightproof-sa.vercel.app/ |
| Backend API (Railway) | https://freightproof-sa.up.railway.app |

---

## Licence

Copyright (c) 2026 Ciaran Formby, Tim Gultig, Chiko Kasongo, Tom Davis.
University of Cape Town — INF4027W Honours Project.

All rights reserved. See LICENSE for full terms.
