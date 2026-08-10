# FreightProof SA

FreightProof is an evidence platform for South African road freight. It records a trip's custody phases, reconciles evidence from the driver and external systems, and anchors selected evidence hashes to Hedera Consensus Service.

**INF4027W Honours Project — University of Cape Town — 2026**
Ciaran Formby · Tim Gultig · Chiko Kasongo · Tom Davis

## Current implementation

The repository currently contains:

- A FastAPI backend with Supabase PostgreSQL, Redis/Celery, Supabase Auth, Supabase Storage, and Hedera anchoring.
- A Next.js dispatcher application for trip creation, monitoring, exceptions, evidence, and overrides.
- A Next.js/Capacitor driver application for phase completion, evidence capture, offline submission, and Android/iOS packaging.
- Mock-backed integrations for IDVS, Pulsit, warehouse scan events, and Parcel Perfect development workflows. Parcel Perfect also has a real read client, selected through configuration.
- Server-sent events (SSE) for dispatcher live updates.

The following are planned or incomplete and must not be presented as finished features:

- The client evidence portal is a placeholder only.
- There is no separate guard application.
- There is no live warehouse scan-feed integration; development and demo flows use the Redis-backed mock feed.
- Twilio and SendGrid backend clients are not implemented.
- Multi-stop plans are represented, but consignments created through the current request schema are assigned to the trip's first and final stops. Per-consignment intermediate pickup and delivery mapping remains a known limitation.

See [Documentation](#documentation) and [Current limitations](#current-limitations) before presenting or deploying the project.

## Architecture

```text
Dispatcher (Next.js) ─┐
                      ├─ HTTPS ─ FastAPI ─ PostgreSQL (Supabase)
Driver (Next.js/PWA) ─┘              ├──── Redis / Celery
                                     ├──── Supabase Storage
                                     ├──── Hedera HCS
                                     └──── Partner integrations or mocks

FastAPI ── SSE ──> Dispatcher live updates
```

| Layer | Current technology |
|---|---|
| Backend | Python 3.13, FastAPI, SQLAlchemy async, Alembic, Celery |
| Authentication | Supabase JWTs validated by the backend |
| Evidence integrity | SHA-256 hashing and Hedera HCS receipts |
| Database | PostgreSQL hosted by Supabase |
| Cache and queue | Redis 7 and Celery |
| Evidence storage | Supabase Storage |
| Dispatcher | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Driver | Next.js 15, React 19, Capacitor 6, Serwist |
| Deployment used for the project | Vercel frontend and Railway backend |
| CI | GitHub Actions |

## Project structure

```text
freightproof-sa/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # FastAPI routes
│   │   ├── auth/               # Supabase JWT and role dependencies
│   │   ├── blockchain/         # Hedera submission and verification
│   │   ├── core/               # Configuration and shared rules
│   │   ├── db/models/          # SQLAlchemy models
│   │   ├── integrations/       # Partner clients and mocks
│   │   ├── orchestration/      # Trip and phase workflows
│   │   ├── storage/            # Evidence storage
│   │   └── tasks/              # Celery tasks
│   ├── migrations/             # Alembic migration history
│   └── tests/
├── frontend/
│   ├── dispatcher/             # Dispatcher web application
│   ├── driver-pwa/             # Driver PWA and Capacitor projects
│   ├── shared/                 # Shared types, phase metadata, and mocks
│   └── client-portal/          # Planned; not yet implemented
├── infrastructure/docker/      # Development and test Compose files
├── docs/
├── CLAUDE.md
├── LICENSE
└── README.md
```

## Getting started

### Prerequisites

| Tool | Supported version |
|---|---|
| Python | 3.13 |
| Node.js | 22 LTS |
| Docker Desktop | Current stable release |
| Git | Current supported release |

### Clone and configure

```bash
git clone git@github.com:Team-5-2026-Hons/freightproof-sa.git
cd freightproof-sa

cp backend/.env.example backend/.env
cp frontend/dispatcher/.env.example frontend/dispatcher/.env.local
cp frontend/driver-pwa/.env.example frontend/driver-pwa/.env.local
```

Review every example file before running the applications. At minimum, local backend development requires database, Redis, Supabase, Supabase service-role, and Hedera values. Partner integrations default to their mocks where supported; Twilio and SendGrid values are optional because those clients have not been implemented.

Never point `TEST_DATABASE_URL` at Supabase or another persistent database. The test suite creates and drops its schema.

### Backend

Start Redis only when running the API directly on the host:

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d redis

cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

- Health check: <http://localhost:8000/health>
- OpenAPI: <http://localhost:8000/docs>

The full development Compose file starts Redis, the API, Celery worker, and dispatcher. It does **not** start PostgreSQL; development uses the `DATABASE_URL` configured in `backend/.env`.

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d
```

### Dispatcher

```bash
cd frontend/dispatcher
npm ci
npm run dev
```

The dispatcher runs at <http://localhost:3000>.

### Driver PWA

```bash
cd frontend/driver-pwa
npm ci
npm run dev
```

The driver application runs at <http://localhost:3001>. Demo authentication is enabled when `NEXT_PUBLIC_DEMO_MODE` is `true` or unset. Set it to `false` and provide valid Supabase values when testing real authentication.

Production and Capacitor builds reject an unset or localhost `NEXT_PUBLIC_API_URL`, because the URL is embedded in the static export:

```bash
cd frontend/driver-pwa
NEXT_PUBLIC_API_URL=https://your-api.example npm run build
npx cap sync android
npx cap open android
```

For platform-specific configuration and supported fallbacks, see [the driver README](frontend/driver-pwa/README.md).

## Tests and quality checks

Backend integration tests require the throwaway PostgreSQL and Redis services:

```bash
docker compose -f infrastructure/docker/docker-compose.test.yml up -d

cd backend
.venv/bin/ruff check .
.venv/bin/mypy .
.venv/bin/pytest
```

Frontend checks:

```bash
cd frontend/dispatcher
npm run lint
npm run type-check
npm test
npm run build

cd ../driver-pwa
npm run lint
npm run type-check
npm test
NEXT_PUBLIC_API_URL=https://api.example.invalid npm run build
```

## Phase model

A trip has a committed, ordered phase plan generated from its stops and consignments. Plan length is data: a two-stop trip has seven rows, while loading, transit, and unloading phases can recur on a multi-stop trip. The phase-event ledger is the source of truth; the trip's current position is derived from it.

| Typical position | Phase | Completed by | Evidence and anchoring |
|---|---|---|---|
| P0 | `trip_creation` | Dispatcher | Journey lock; fail-closed Hedera anchor |
| P1 | `activation` | Driver | Identity/device verification and phone location |
| P2 | `loading` | Driver | Driver-safe linehaul review and optional paper-copy photo; not anchored |
| P3 | `departure` | Driver | Seal and waybill photo; pickup anchor |
| P4 | `in_transit` | Driver on arrival | Arrival location; not anchored |
| P5 | `unloading` | Driver | Destination seal and visual count; not anchored |
| P6 | `confirmation` | Driver | POD, signature, reconciliation; delivery anchor |

The numbers above describe the common two-stop plan, not fixed API identifiers. Use phase-event IDs when completing or overriding rows.

## Configuration

The configuration examples are the maintained reference:

- [Backend environment](backend/.env.example)
- [Dispatcher environment](frontend/dispatcher/.env.example)
- [Driver environment](frontend/driver-pwa/.env.example)

Secrets must remain in ignored `.env` or deployment-secret stores. Supabase service-role credentials are server-only and must never be exposed through a `NEXT_PUBLIC_*` variable.

## Current limitations

- IDVS and Pulsit are mock-backed unless their real clients and credentials are configured.
- The warehouse scan feed has no live implementation and must use `SCAN_FEED_USE_MOCK=true`.
- Parcel Perfect cannot currently supply every warehouse scan event required by the proposed evidence flow.
- The driver application defaults to demo authentication unless explicitly configured otherwise. Do not use that default for a release build.
- Per-consignment intermediate pickup and delivery stops are not accepted by the current trip-creation request.
- The client evidence portal, guard application, Twilio notifications, and SendGrid notifications are not implemented.
- Mobile store signing, transport-security settings, and real-device verification must be completed before distributing a production build.

Additional presentation-specific limitations are recorded in [the demo script](docs/demo-script.md).

## Documentation

[docs/README.md](docs/README.md) identifies current, supporting, and historical documents. Start with:

- [Phase model explained](docs/phase-model-explained.md)
- [Demo script](docs/demo-script.md)
- [Scope boundaries](docs/scope-boundaries.md)
- [Glossary](docs/glossary.md)
- [Known issues](docs/known-issues.md)

The FastAPI application serves the current endpoint contract at `/docs` and `/openapi.json`; older handwritten API contracts are retained only as historical design material.

## Development workflow

Create focused branches from an updated `dev`, run the checks relevant to the change, and open a pull request back into `dev`. Database changes must be made through Alembic migrations—never directly in Supabase.

```bash
git switch dev
git pull --ff-only origin dev
git switch -c feature/short-description
```

## Hosted project environment

- Dispatcher: <https://freightproof-sa.vercel.app/>
- Backend: <https://freightproof-sa.up.railway.app>

Availability and configuration of these project-hosted environments are not guaranteed by the repository.

## Licence

Copyright (c) 2026 Ciaran Formby, Tim Gultig, Chiko Kasongo, Tom Davis.
University of Cape Town — INF4027W Honours Project.

All rights reserved. See [LICENSE](LICENSE).
