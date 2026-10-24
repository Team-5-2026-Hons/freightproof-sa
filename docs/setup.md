# Local setup guide

**Verified against branch `Ciaran` on 2026-09-26.** This guide verifies repository
configuration only; it does not connect to a database or inspect secrets.

Read [CLAUDE.md](../CLAUDE.md) before acting. Copy example environment files locally if
needed, but use the team's approved secret-sharing process for values.

## Prerequisites

Python 3.13+, Node 22 LTS, npm, Docker Desktop, and Git. Backend dependencies are in
`backend/requirements.txt`; all three frontends provide `package.json` scripts.

## Host-process workflow

```bash
python3.13 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt

cd frontend/dispatcher && npm install
cd ../driver-pwa && npm install
cd ../receiver && npm install
```

Run the backend and each frontend in separate terminals:

```bash
cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000
cd frontend/dispatcher && npm run dev
cd frontend/driver-pwa && npm run dev -- --port 3001
cd frontend/receiver && npm run dev
```

## Docker workflow

`infrastructure/docker/docker-compose.dev.yml` defines Redis, API, Celery worker, and
Dispatcher web services; it does **not** define local Postgres.

```bash
docker compose -f infrastructure/docker/docker-compose.dev.yml up -d --build
docker compose -f infrastructure/docker/docker-compose.dev.yml ps
```

## Tests and migrations

The integration suite requires `TEST_DATABASE_URL` for a throwaway database; the test
compose file provides isolated Postgres. Never point it at Supabase.

```bash
docker compose -f infrastructure/docker/docker-compose.test.yml up -d
cd backend && .venv/bin/pytest
```

Do not run `alembic upgrade` from a feature branch: the shared database has one Alembic
version. Coordinate against `dev`, generate only intended revisions, and inspect upgrade
and downgrade operations. See the [migration-drift note](design-notes/2026-09-15-alembic-autogenerate-drift.md).
This guide makes no claim about current database drift.
