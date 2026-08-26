# FreightProof SA — Claude Onboarding Prompt

> **How to use:** Open this repo in Claude Code for the first time and say:
> `Read CLAUDE_ONBOARDING.md and follow it to set up my dev environment.`
> Claude will work through every step below in order.

---

## Instructions for Claude

You are being onboarded to **FreightProof SA** — a cargo theft and disputed delivery evidence platform. This is an Honours project (INF4027W, UCT 2026) with four developers: Ciaran, Tim, Chiko, and Tom.

Work through every numbered step below in sequence. After each step, confirm it succeeded before moving on. If anything fails, stop and tell the developer exactly what went wrong and what they need to provide (credentials, etc.) before you can continue.

**After finishing all steps, read `CLAUDE.md` in full — it governs every task you will do in this repo going forward.**

---

## Prerequisites check

First, verify the required tools are installed:

```
Check that the following are available on this machine:
- docker (docker --version)
- docker compose (docker compose version)
- python3.13 or higher (python3 --version)
- node v22 or higher (node --version)
- npm (npm --version)
- git (git --version)
```

If any are missing, tell the developer what to install and stop. Do not continue until all prerequisites are confirmed.

---

## Step 1 — Clone check

Confirm the repo root contains `CLAUDE.md`, `backend/`, `frontend/`, and `infrastructure/`. If any are missing, something went wrong with the clone — flag it and stop.

---

## Step 2 — Backend Python environment

```bash
# From repo root
cd backend

# Create a virtual environment using Python 3.13
python3.13 -m venv .venv

# Activate it
source .venv/bin/activate   # macOS/Linux
# .venv\Scripts\activate    # Windows

# Install all dependencies
pip install -r requirements.txt
```

Confirm `pip install` exits with no errors. If packages fail, report the exact error.

---

## Step 3 — Backend environment file

Check whether `backend/.env` already exists.

- **If it exists:** tell the developer it is already present and skip to Step 4.
- **If it does not exist:** copy from the example and tell the developer which keys they must fill in:

```bash
cp backend/.env.example backend/.env
```

Then tell the developer:

> `backend/.env` has been created from the example. You must fill in the following keys before the backend will start. Get the values from the team's shared secrets manager (Infisical):
>
> | Key | Purpose |
> |-----|---------|
> | `DATABASE_URL` | Supabase Postgres connection string (`postgresql+asyncpg://...`) |
> | `SUPABASE_URL` | Supabase project URL |
> | `SUPABASE_ANON_KEY` | Supabase anon/public key |
> | `HEDERA_ACCOUNT_ID` | Hedera testnet account |
> | `HEDERA_PRIVATE_KEY` | Hedera account private key |
> | `HEDERA_TOPIC_ID` | HCS topic ID for this environment |
> | `JWT_SECRET_KEY` | Random secret — generate with `openssl rand -hex 32` |
> | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio credentials (can leave blank in dev if mocks are on) |
> | `SENDGRID_API_KEY` | SendGrid credentials (can leave blank in dev if mocks are on) |
> | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | S3 credentials for Supabase Storage |
>
> Keys with `_USE_MOCK=true` (IDVS, Pulse, PP) do not need real API credentials for local dev.

**Do not proceed to Step 4 until the developer confirms `DATABASE_URL` and `JWT_SECRET_KEY` are filled in** — the API will crash on start without them.

---

## Step 4 — Frontend dependencies (dispatcher)

```bash
# From repo root
cd frontend/dispatcher
npm ci
```

Confirm `npm ci` exits cleanly. If it fails due to a missing `package-lock.json`, run `npm install` instead and warn the developer that the lock file was absent.

---

## Step 5 — Start Docker services

The compose file starts Redis, the FastAPI backend, the Celery worker, and the Next.js dispatcher. The database lives on Supabase — there is no local Postgres container.

```bash
# From repo root
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d --build
```

After the command returns, verify all four services are healthy:

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml ps
```

Expected status for each service:

| Service | Container name | Expected status |
|---------|---------------|-----------------|
| Redis | `freightproof-redis` | `healthy` |
| API | `freightproof-api` | `running` |
| Worker | `freightproof-worker` | `running` |
| Web | `freightproof-web` | `running` |

If any container is in `exiting` or `error` state, fetch its logs and report them:

```bash
docker logs freightproof-api
docker logs freightproof-worker
docker logs freightproof-web
```

Common causes and fixes:
- **API exits immediately** → `DATABASE_URL` or `JWT_SECRET_KEY` missing in `.env`
- **Worker exits** → same `.env` issue, or Redis not healthy yet (retry after a few seconds)
- **Web exits** → check `frontend/dispatcher/.env.local` exists (create it if not — can be empty for local dev)

---

## Step 6 — Database migrations

> **Do not run `alembic upgrade head`.** The database schema is still being designed — there are no tables yet. Migrations will be authored by the team as models are built.

Confirm Alembic is configured correctly by checking the connection only:

```bash
cd backend
source .venv/bin/activate
alembic current
```

This should print `(head)` or an empty result without errors. If it fails with a connection error, `DATABASE_URL` in `.env` is wrong — tell the developer.

**Do not run `alembic upgrade`, `alembic revision`, or any command that modifies the database.** Those commands are only run when a developer explicitly creates or applies a migration as part of their feature work.

---

## Step 7 — Smoke test

Run the backend test suite to confirm the installation is healthy:

```bash
cd backend
source .venv/bin/activate
pytest -m "not slow" -q
```

Report the result. Tests are expected to pass. If tests fail:
- Identify whether the failure is a missing `.env` value, a DB connectivity issue, or a code issue
- Report exactly which test failed and the error message
- Do **not** attempt to fix test failures unless the developer asks

---

## Step 8 — Verify running services

Check each service is reachable:

```bash
# API health (should return 200 with {"status": "ok"} or similar)
curl -s http://localhost:8000/health || echo "API not reachable"

# Redis
docker exec freightproof-redis redis-cli ping   # should return PONG

# Dispatcher (should return HTML)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Tell the developer which services are up and which are not.

---

## Step 9 — IDE / Claude Code setup

Confirm that `CLAUDE.md` exists at the repo root. Tell the developer:

> "Your Claude Code session is now pointed at this repo. `CLAUDE.md` is loaded automatically and governs all tasks. Before starting any feature work, check the current sprint ownership link in `CLAUDE.md` (placeholder — Tim will pin this) and confirm which files are in scope for your ticket."

---

## Step 10 — Final summary

Report the following to the developer:

```
SETUP COMPLETE
==============
Python venv:     backend/.venv  (activated)
Dependencies:    backend/requirements.txt installed
Frontend deps:   frontend/dispatcher/node_modules installed
Docker services: redis | api | worker | web
Migrations:      applied to head
Tests:           [PASS / FAIL — n passed, n failed]

Service URLs:
  API:        http://localhost:8000
  API docs:   http://localhost:8000/docs
  Dispatcher: http://localhost:3000
  Redis:      localhost:6379

Next steps:
  1. Fill in any remaining .env keys if flagged above
  2. Read CLAUDE.md fully before asking Claude to help with any task
  3. Check with Tim for your current sprint assignment and branch name
  4. Branch off dev: git checkout -b <type>/<your-name>/<short-description>
```

If any step failed, list it explicitly under `SETUP COMPLETE` as `BLOCKED` with the reason.

---

## Architecture quick-reference (for Claude's context)

```
backend/app/
├── api/v1/endpoints/   thin FastAPI routes — validate, call service, return
├── auth/               JWT, password hashing
├── blockchain/         Hedera HCS REST calls and hash verification
├── core/               config.py, constants, exceptions
├── crypto/             Ed25519 (PyNaCl), SHA-256, Merkle trees
├── db/models/          one file per table; all imported in __init__.py
├── db/session.py       async engine + get_db() dependency
├── integrations/       pulse.py, parcel_perfect.py, idvs.py, twilio.py, sendgrid.py
├── orchestration/      trip state machine and handshake sequencing
├── storage/            Supabase Storage I/O + hash verification
└── tasks/              Celery async tasks

frontend/
├── dispatcher/         Next.js 15 App Router — dispatcher dashboard
├── driver-pwa/         Next.js + next-pwa — driver mobile app (scaffold)
├── guard/              Plain HTML+JS — zero-login guard verification page
└── client-portal/      Next.js — read-only client evidence view (scaffold)

infrastructure/
└── docker/docker-compose.dev.yml   Redis + API + Worker + Web
```

**Layering rule (never skip):**
`endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db`

**Five handshakes:** Trip Created → Origin Gate-In → Loading Complete → In Transit → Destination Gate-In → Closed

**POPIA:** PII stays in Postgres (`af-south-1`). Only SHA-256 hashes go to Hedera. Never send personal data off-system.

**Evidence, not operations.** FreightProof records what happened. It does not reroute drivers or replace Pulse/Parcel Perfect.

---

*This file is a Claude onboarding prompt, not documentation. Do not edit it without coordinating with Tim (repo owner).*
