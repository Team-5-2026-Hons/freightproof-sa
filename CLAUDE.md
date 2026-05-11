# FreightProof SA — Claude Code Instructions

Read this entire file before acting.

## Project

FreightProof SA — cargo theft and disputed delivery evidence platform. INF4027W Honours Project, UCT 2026. 4 devs: Ciaran, Tim, Chiko, Tom. Public GitHub repo, branch protection on `main` and `dev`.

Current sprint ownership: [link placeholder — will be added after the issue is pinned]. Check before starting work — it changes at sprint boundaries.

## Prime Directive

**Do exactly what you were asked. Nothing more.**

Four devs on different branches. Touching files outside scope breaks their work. Before any change ask: was I told to touch this? Could this break someone else's branch? If unsure, ask.

Do not generate code for patterns the developer can't defend at examination. This is a graded project.

## Workflow: Read → Plan → Execute → Report

### 1. Read first

Read the target file, its imports, relevant models in `backend/app/db/models/`, and `backend/app/core/config.py` if touching settings. Never assume contents.

### 2. Plan

Skip the PLAN block only for trivial edits (single file, under 10 lines, no logic change, no signature change — e.g. typo fix).

Otherwise output:

```
PLAN
Task:      [one sentence]
Branch:    [branch name]
Modify:    [files]
Create:    [files]
Tests:     [files]
Out of scope: [files considered but excluded, why]
Approach:  [numbered steps, including tests]
Risk:      [cross-dev impact, or "none"]
Questions: [or "proceeding"]
```

Wait for answers if questions listed.

### 3. Execute

Follow standards below.

### 4. Report with TASK COMPLETE (see bottom)

## Standards

**Versions — latest stable only, no deprecated APIs:**
Python 3.13+, FastAPI 0.115+, SQLAlchemy 2.0+ async (`Mapped`/`mapped_column`, no legacy `Column`), Pydantic v2 (`@field_validator`, `model_config`, not v1), Alembic latest, pytest + pytest-asyncio (`asyncio_mode = auto`). Node 22 LTS, Next.js 15+ App Router only (no Pages Router, no `getServerSideProps`/`getStaticProps`), TypeScript 5.5+ (never `any`), Tailwind v3.4+ (use `content`, not `purge`), React 19+ (Server Components, no class components).

If you hit deprecated code in an existing file, flag it under `Deprecation warnings` in TASK COMPLETE — don't fix silently.

**Code quality:**
- Type every signature and prop. No `any`.
- Comment the *why*, not the *what*.
- No magic numbers/strings — extract to constants or config.
- No bare `except:`, no silent exception swallowing. Log and raise/return.
- No hardcoded credentials, URLs, or env values — use `core/config.py` and `.env`.

**Python/FastAPI:** All endpoints `async def`. All DB calls via async `get_db()`. Pydantic v2 models in/out, never raw dicts. `tags=["..."]` on every router. Endpoints thin — validate, call service, return. Business logic in `orchestration/`, `auth/`, `blockchain/` etc., never inline.

**TS/Next.js:** App Router, async Server Components where possible. Explicit prop interfaces. `"use client"` only at lowest level needed — **exception: `driver-pwa/` requires `"use client"` on every page** because `output: 'export'` (required for Capacitor Android APK) is incompatible with Server Components. Typed fetch wrapper, never raw `fetch()` in components. Client env vars as `process.env.NEXT_PUBLIC_*`.

**Database:** Never edit Supabase schema directly — all changes via Alembic. New models must be imported in `db/models/__init__.py`. Every table has `created_at`, `updated_at`. Explicit `ForeignKey()` on FKs.

**Alembic conflicts (critical with 4 devs):** Before `alembic revision --autogenerate`: `git fetch origin`, check for unmerged migrations on `dev`, rebase if any exist. Name migration files with your name (`2026_04_15_tim_add_vehicle_trailer.py`). If two devs have conflicting migrations, don't fix the revision chain yourself — flag it and coordinate.

## Testing

Every backend feature needs tests. Task isn't done until tests pass.

```
backend/tests/
├── unit/          pure logic, no DB, no HTTP
└── integration/   endpoints + DB
```

Files: `test_<module>.py`. Functions: `test_<what>_<outcome>()`.

- **Unit** for `crypto/`, `auth/`, `orchestration/`, `blockchain/` — happy path + edge cases + failures.
- **Integration** for every endpoint: success, 401, 422, 404 where applicable. Assert DB state after mutations.

Use `httpx.AsyncClient` + `ASGITransport`. Arrange/Act/Assert with blank lines between. Fixtures or `uuid4()`, never hardcoded IDs or timestamps. No inter-test state. Run `cd backend && pytest` before marking done.

## Architecture

```
backend/app/
├── api/v1/endpoints/   thin FastAPI routes
├── auth/               JWT, password hashing
├── blockchain/         Hedera HCS REST, hash verify
├── core/               config, constants, exceptions
├── crypto/             Ed25519 (PyNaCl), SHA-256, Merkle
├── db/models/          one file per table
├── db/session.py       async engine, get_db()
├── integrations/       pulse.py, parcel_perfect.py, idvs.py, twilio.py, sendgrid.py
├── orchestration/      trip state machine, handshake sequencing, exceptions
├── storage/            Supabase Storage I/O + hash verify
└── tasks/              Celery tasks
```

**Layering (never skip):**
```
endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db
```
`integrations/` never imports from `api/` or `orchestration/`. `db/` never imports from elsewhere in `app/`. Endpoints never call `hedera.py` directly — go through orchestration.

**Frontend:** `dispatcher/` (Next.js dashboard), `driver-pwa/` (Next.js + Capacitor Android APK + @serwist/next browser PWA; `output: 'export'`; all pages `"use client"`). Both surfaces share types, mocks, constants, and utilities from `frontend/shared/` via the `@shared/*` path alias.

**Stack (do not swap without team agreement):** FastAPI, SQLAlchemy 2.0, Alembic, Celery+Redis, JWT+python-jose, Hedera HCS, Supabase Storage, Next.js 15, Tailwind, Pydantic v2.

## Domain knowledge

**Five handshakes:** Trip Created → Origin Gate-In → Loading Complete → In Transit → Destination Gate-In → Closed. Orchestration layer validates every transition.

**Journey lock hash:** SHA-256 of committed trip params at creation, anchored to Hedera HCS. Current record hash ≠ Hedera tx = tampering. Never modify trip params after creation without an explicit exception event.

**Evidence, not operations.** FreightProof records what happened. It doesn't reroute drivers, dispatch response, or replace Pulse/Parcel Perfect. If you're trying to *respond* rather than *record*, it's out of scope.

**POPIA:** Personal data (identities, GPS, photos, parcel details) stays in PostgreSQL in `af-south-1`. Only SHA-256 hashes go to Hedera. Personal data never reaches blockchain. If code would send PII off-system, stop.

**Driver is the only hands-on user per handshake.** Guards and warehouse staff don't have accounts. Guard page = zero login. Receiver = one-time OTP. Don't add auth for roles documented as having none.

## Git

**Claude may run:** `git status`, `git diff`, `git log --oneline -10`, `git branch --show-current`, `git fetch`, `git add <specific files>`.

**Claude must never run:** `git commit`, `git push`, `git merge`, `git rebase`, `git cherry-pick`, `git checkout <branch>`, `git stash`, `git reset`, `git restore`, or anything that modifies history or remote state.

If asked to commit:
> "I don't commit — that's yours. Suggested: `[message]`. Files staged. Run `git diff --staged` to review, then `git commit -m "..."`."

**Conventional Commits:** `type(scope): description`. Types: feat, fix, chore, docs, test, refactor. Scopes: auth, orchestration, blockchain, crypto, integrations, db, tasks, storage, api, dispatcher, driver-pwa, shared. One logical change per commit.

## Shared files — coordinate before changing

- `backend/app/main.py` (router registration)
- `backend/app/core/config.py` (everyone's `.env`)
- `backend/app/db/models/__init__.py` (all migrations)
- `backend/requirements.txt` + `frontend/*/package.json`
- `infrastructure/docker/docker-compose.dev.yml`
- `CLAUDE.md` (4-reviewer PR required)

Flag any shared-file change in TASK COMPLETE.

## Secrets

Never read, print, or log `.env`. Never commit it. `.env.example` holds key names only. New config: add empty key to `.env.example`, add field to `core/config.py`, list in TASK COMPLETE under `New .env keys required`. The Supabase `service_role` key never appears in code or config.

## When unsure

Ask. Specifically about: scope boundaries, shared file safety, migration conflicts, matching existing patterns, new dependencies, current ownership, package versions. "I'm unsure about X, options are A/B/C, which?" beats a guess that breaks three other branches.

## TASK COMPLETE

```
TASK COMPLETE
Summary: [one paragraph]

Modified: [files]
Created:  [files]
Tests:    [files]
Excluded: [file — reason]

Self-review (all must PASS):
  [ ] Scope respected
  [ ] Types everywhere, no `any`
  [ ] "Why" comments present
  [ ] No hardcoded credentials/magic values
  [ ] Errors handled and logged
  [ ] DB via Alembic, models registered
  [ ] Endpoints async, Pydantic v2, get_db()
  [ ] SQLAlchemy 2.0 Mapped syntax
  [ ] Latest stable versions, no deprecated APIs
  [ ] Unit + integration tests written
  [ ] pytest green
  [ ] No git write commands run
  [ ] Shared file changes flagged
Result: PASS / FAIL (if FAIL, fix before finishing)

Migrations:     [name / none]
Shared files:   [list / none]
Deprecations:   [findings / none]
New .env keys:  [KEY — purpose / none]

Suggested commit: type(scope): description
⚠ Files staged, not committed. Run `git diff --staged`, then `pytest`, then commit when satisfied.

Next: [handoff]
```

---
*Changes to this file require a PR on `dev` reviewed by all four team members.*
