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
│  Dispatcher (Next.js)  Driver PWA  Guard  Client Portal  │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS / WebSocket
┌────────────────────────▼────────────────────────────────┐
│              FastAPI Backend (Python 3.13)               │
│  api/  auth/  orchestration/  blockchain/  integrations/ │
└──────┬──────────────────────────────────────────────────┘
       │
┌──────▼──────┐  ┌────────┐  ┌──────────────────────────┐
│ PostgreSQL  │  │ Redis  │  │ S3 / Supabase Storage    │
│ (Supabase) │  │        │  │ (photos, evidence files) │
└─────────────┘  └────────┘  └──────────────────────────┘
       │
┌──────▼──────────────────────────────────────────────────┐
│                  External integrations                   │
│  Pulse Tracking · Parcel Perfect · IDVS · Hedera HCS    │
│  Twilio · SendGrid                                       │
└─────────────────────────────────────────────────────────┘
```

Full architecture documentation: [`docs/FreightProof_TechArch.docx`](docs/)

---

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Python 3.13, FastAPI, SQLAlchemy 2.0 async, Alembic, Celery |
| Auth | JWT + python-jose, Ed25519 (PyNaCl) |
| Blockchain | Hedera HCS via REST API, SHA-256 hashing |
| Database | PostgreSQL 16 (Supabase for dev, AWS RDS af-south-1 for prod) |
| Cache / Queue | Redis 7, Celery |
| Storage | Amazon S3 / Supabase Storage |
| Frontend | Next.js 15 (App Router), TypeScript 5.5, React 19, Tailwind CSS |
| Driver PWA | Next.js 15 + Capacitor (Android APK) + @serwist/next (browser PWA / Workbox) |
| Guard page | Plain HTML + JS (zero install, zero login) |
| Infrastructure | Docker, AWS ECS Fargate, af-south-1 region (POPIA) |
| CI/CD | GitHub Actions |

---

## Project structure

```
freightproof-sa/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/   # FastAPI route definitions
│   │   ├── auth/               # JWT, password hashing, dependencies
│   │   ├── blockchain/         # Hedera HCS anchoring
│   │   ├── core/               # Config, constants, exceptions
│   │   ├── crypto/             # Ed25519 signing, SHA-256, Merkle trees
│   │   ├── db/
│   │   │   ├── models/         # SQLAlchemy ORM models
│   │   │   └── session.py      # Async engine and get_db()
│   │   ├── integrations/       # Pulse, Parcel Perfect, IDVS, Twilio, SendGrid
│   │   ├── orchestration/      # Trip state machine, handshake logic
│   │   ├── storage/            # S3 / Supabase Storage
│   │   └── tasks/              # Celery background tasks
│   ├── migrations/             # Alembic migrations
│   └── tests/
│       ├── unit/               # Pure logic tests (no DB, no HTTP)
│       └── integration/        # API and database tests
├── frontend/
│   ├── dispatcher/             # Next.js — dispatcher dashboard
│   ├── driver-pwa/             # Next.js PWA — driver handshake app
│   ├── guard/                  # Plain HTML — guard QR verification page
│   └── client-portal/         # Next.js — client evidence portal
├── infrastructure/
│   ├── docker/
│   │   └── docker-compose.dev.yml
│   └── nginx/
│       └── nginx.dev.conf
├── docs/
├── CLAUDE.md                   # Claude Code instructions for all developers
├── LICENSE
└── README.md
```

---

## Getting started

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | 3.13+ | [python.org](https://python.org) |
| Node.js | 22 LTS | [nodejs.org](https://nodejs.org) |
| Docker Desktop | latest | [docker.com](https://docker.com/products/docker-desktop) |
| Git | any | [git-scm.com](https://git-scm.com) |

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_ORG/freightproof-sa.git
cd freightproof-sa
```

### 2. Set up environment variables

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and fill in your credentials. You need:
- Supabase database URI (connection string from Settings → Database → URI tab)
- Hedera testnet account ID and private key from [portal.hedera.com](https://portal.hedera.com)
- Twilio account SID, auth token, and phone number
- SendGrid API key and verified sender email
- A generated JWT secret: `python3 -c "import secrets; print(secrets.token_hex(32))"`

See [`.env.example`](backend/.env.example) for all required keys.

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

- API: [http://localhost:8000/health](http://localhost:8000/health)
- Swagger docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### 7. Start the dispatcher frontend

```bash
cd frontend/dispatcher
npm install
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000)

### 8. Start the driver PWA (separate terminal)

```bash
cd frontend/driver-pwa
npm install
npm run dev -- --port 3001
```

Opens at [http://localhost:3001](http://localhost:3001)

### 9. Build and run the driver Android APK (optional — requires Android Studio)

```bash
cd frontend/driver-pwa
npm run build          # Next.js static export → out/
npx cap sync android   # copies out/ into android/app/src/main/assets
npx cap open android   # opens Android Studio
```

In Android Studio: select a connected Samsung device or emulator → Run. The APK installs and launches the driver app natively.

> **Prerequisites:** Android Studio with SDK Platform 34+, Java 17. `ANDROID_HOME` env var set.  
> **Not required** for browser-based development — `npm run dev` works without Android Studio.

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

Open a pull request into `dev`. One reviewer must approve before merging.

### Running tests

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

1. Create the model file in `backend/app/db/models/yourmodel.py`
2. Import it in `backend/app/db/models/__init__.py`
3. Generate a migration: `alembic revision --autogenerate -m "add yourmodel table"`
4. Review the generated file in `migrations/versions/`
5. Apply it: `alembic upgrade head`

Never modify the database schema directly in Supabase.

### Adding a new config value

1. Add the key with an empty value to `backend/.env.example`
2. Add the field to `backend/app/core/config.py`
3. Note it in your PR description so teammates add it to their `.env`

---

## The five handshakes

A depot-to-depot trip moves through five handshakes. Each produces a signed event anchored to Hedera.

| # | Handshake | Who | What gets anchored |
|---|---|---|---|
| 0 | Trip creation | Dispatcher | Journey lock hash of all committed parameters |
| 1 | Origin gate-in | Driver + gate security | Driver ID, vehicle GPS, precinct match |
| 2 | Loading | Driver + cargo officer | Parcel Perfect manifest, waybill photo, seal number |
| 3 | Origin gate-out | Driver + gate security | Seal verified, trip transitions to in-transit |
| 4 | Destination gate-in | Driver + gate security | Seal verified unbroken on arrival |
| 5 | Unloading | Driver + cargo officer | Three-way count reconciliation, POD photo, delivery receipt |

---

## Environment variables reference

| Key | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL async URI (`postgresql+asyncpg://...`) |
| `REDIS_URL` | Yes | Redis connection string |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/public key (not service_role) |
| `HEDERA_ACCOUNT_ID` | Yes | Hedera account ID (format: `0.0.xxxxxx`) |
| `HEDERA_PRIVATE_KEY` | Yes | Hedera account private key |
| `HEDERA_NETWORK` | Yes | `testnet` or `mainnet` |
| `HEDERA_TOPIC_ID` | No | HCS topic ID — required for real anchoring |
| `TWILIO_ACCOUNT_SID` | Yes | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Yes | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Yes | Twilio sender phone number |
| `SENDGRID_API_KEY` | Yes | SendGrid API key |
| `SENDGRID_FROM_EMAIL` | Yes | Verified sender email |
| `JWT_SECRET_KEY` | Yes | 64-character hex string for signing JWTs |
| `JWT_ALGORITHM` | Yes | `HS256` |
| `JWT_EXPIRE_MINUTES` | Yes | Token lifetime in minutes (default: `480`) |
| `ENVIRONMENT` | Yes | `development` or `production` |
| `ALLOWED_ORIGINS` | Yes | Comma-separated list of allowed CORS origins |

---

## Using Claude Code

All four developers use Claude Code on this project. Claude's behaviour is
governed by [`CLAUDE.md`](CLAUDE.md) at the repo root — every Claude instance
reads it automatically at the start of each session.

Key rules Claude follows on this project:
- Makes a written plan before writing any code
- Writes unit and integration tests for every feature
- Never runs `git commit`, `git push`, or any git write command
- Only touches files within the declared scope of the task
- Flags shared file changes for team awareness
- Always uses latest stable versions — Python 3.13+, Next.js 15+, Node 22 LTS

If Claude's behaviour on your machine differs from another team member's,
check that you both have the latest `CLAUDE.md` from `dev`.

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

## Licence

Copyright (c) 2026 Ciaran Formby, Tim Gultig, Chiko Kasongo, Tom Davis.
University of Cape Town — INF4027W Honours Project.

All rights reserved. See [`LICENSE`](LICENSE) for full terms.
