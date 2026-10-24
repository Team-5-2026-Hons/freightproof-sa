# Merge prep — `dev` → `main`, 2026-10-24

Written for the four of us before the Iteration 4 merge. Everything below was run locally
against `dev` at `adc5052d`; the commands are here so anyone can re-run them rather than
trust this file.

**Verdict: `dev` is green on every gate, but the merge is not a fast-forward and must not
be done blind.** `main` carries 7 commits `dev` has never seen. Resolve them as described
in §2 and the merge is small and safe. Merge without reading §2 and you will either hit
three conflicts with no context or quietly ship a dispatcher whose dashboard link points
at the marketing page.

---

## 1. Every CI gate, run locally

Mirrors `.github/workflows/ci.yml` step for step. Postgres 17 on `:5433`, Redis on `:6379`.

| Gate | Result |
|---|---|
| Backend — `ruff check .` | pass |
| Backend — `scripts/check_structure.py` | pass |
| Backend — `lint-imports` | pass, 23 contracts kept / 0 broken |
| Backend — `mypy .` | pass, no issues in 793 source files |
| Backend — `pytest -m "not slow"` | **4885 passed, 4 skipped** (4876 before the 9 new proxy tests) |
| Backend — `pytest -m slow` (B7 import cycles) | **376 passed** |
| Alembic — one head | pass, `ciaran_drv_arrival_dwell` |
| Alembic — whole chain onto an empty DB | pass, 69 revisions |
| Alembic — `alembic check` | pass, "No new upgrade operations detected" |
| Dispatcher — lint / tsc / vitest / build | pass, **263 files, 3484 tests** |
| Driver PWA — lint / tsc / vitest / build | pass, **185 files, 1772 tests** |
| Receiver — lint / tsc / vitest / build | pass, **11 files, 156 tests** |
| Client portal — lint / tsc / vitest / build | pass, **20 files, 286 tests** |
| Agent config — settings JSON, hook scripts, lint-hook test | pass |

Notes on things that look like failures and are not:

* **`tsc` fails locally in the dispatcher and driver-pwa** with `TS2307 Cannot find module
  '.../app/dev/tokens/page.js'`. That is a stale `.next/types` directory referencing a page
  that no longer exists. `.next/` is gitignored, so CI's clean checkout never sees it.
  `rm -rf frontend/dispatcher/.next frontend/driver-pwa/.next` clears it locally.
* **One driver-pwa test failed once**: `DriverMap.test.tsx` → "restyles a live map when the
  theme flips". It passed 27/27 in isolation and the full 1772 passed on a re-run. Its
  `waitFor` has the default 1s budget and the first run was made while five builds ran
  concurrently. Not broken, but it is the thinnest timing margin in the suite — worth
  widening if it ever goes red in CI.
* **`pytest --timeout` fails on Tim's machine only.** `pytest-timeout` is in
  `requirements-dev.txt` (so CI has it) but is missing from the local `.venv`;
  `pytest.ini` sets `timeout = 300`, hence the "Unknown config option" warning.
  Fix locally with `pip install -r requirements-dev.txt`.

No secrets in the `main..dev` diff. The one JWT-shaped string is `_SHARED_JWT_HEADER` in
`tests/unit/test_rate_limit.py` — a bare ES256 header constant, no payload, no signature.
All 82 `config.py` settings are present in `backend/.env.example`.

---

## 2. `main` is 7 commits ahead — read this before merging

The landing-page work (PRs **#74** and **#76**, 12 Oct) was merged **straight into `main`
and never came back to `dev`**. Merge base is `f0a985ef`. `main` holds 30 files `dev` has
never seen: the public landing page, the four legal pages, `components/landing/*` and the
`(app)/dashboard` relocation.

**Do the merge in this direction: `main` → `dev` first.** Resolve there, let CI prove it on
`dev`, then `dev` → `main` is trivial. Resolving inside a `dev` → `main` merge puts the
conflict resolution on `main` where nothing has tested it.

### What resolves itself

Git's rename detection maps `dev`'s evolved dashboard from `app/(app)/page.tsx` onto
`main`'s `app/(app)/dashboard/page.tsx`. There is **no duplicate `/` route** and no
parallel-page build failure — verified against the merged tree, which has exactly four
layouts and one page per route. `dev` keeps its dashboard, `main` keeps its landing page.

`ROUTES.blockchainReceipts` (deleted on `dev`, still referenced by `main`'s Sidebar) also
resolves itself: both references sit in hunks where `dev`'s deletion of that whole nav
group wins. The merged tree has no dangling reference.

### The three real conflicts

| File | How to resolve |
|---|---|
| `frontend/dispatcher/lib/constants/routes.ts` | Take **`dev`'s** version, then add `main`'s six keys: `landing: '/'`, change `home` to `'/dashboard'`, and `legalPrivacy` / `legalTerms` / `legalCookies` / `legalCompany`. |
| `frontend/dispatcher/components/layout/Sidebar.tsx` | Take **`dev`'s** version (ProfileMenu, forensic mode, collapse rail), then apply `main`'s two edits: Dashboard's `activePatterns: [ROUTES.home]`, and drop the `if (p === '/')` branch from `isActive`. |
| `frontend/dispatcher/components/layout/__tests__/Sidebar.test.tsx` | Take **`dev`'s** version, then `main`'s dashboard-active assertion. |

`main`'s landing code needs all six of those route keys — `ROUTES.landing`,
`ROUTES.legal*` and a `ROUTES.home` of `/dashboard`. Drop any of them and the landing
pages fail type-check.

### The one thing no conflict marker will show you

Everything in the dispatcher navigates through `ROUTES.home`, so moving it to `/dashboard`
moves them all. There was exactly one hardcoded literal — `FleetTiles.tsx`'s Live Trips
tile and its test both asserted `'/'` — which would have auto-merged cleanly and then sent
a signed-in dispatcher to the public landing page. **Both are already fixed on `dev`**
(`href={ROUTES.home}`), so they move correctly with the merge.

After resolving, re-run the dispatcher gate: `npm run lint && npm run type-check && npm test`.

---

## 3. Railway → Fly.io

The API host changed. `backend/railway.json` is deleted and `backend/fly.toml` replaces it.
Section 3 of `docs/deployment-runbook.md` is rewritten for Fly. **None of it has been
verified against a live Fly deploy** — treat the first cutover as the verification.

### The part that is not a rename

`railway.json` built the image and ran only the Dockerfile's uvicorn command. **Production
had no Celery worker and no beat.** Every Hedera anchor an endpoint queued sat in Redis
unclaimed, and none of the five jobs in `app/tasks/__init__.py` ran — including the phase,
evidence and custody anchor-recovery sweeps, so nothing retried a failed anchor either.
`fly.toml` defines three processes from the one image: `app`, `worker`, `beat`.

`fly scale count app=2 worker=1 beat=1`. **Beat must stay at one machine** — two schedulers
fire every sweep twice, which for the recovery jobs means duplicate Hedera submissions and
duplicate spend.

### The security fix the move forced

Fly's proxy **appends** to `X-Forwarded-For`; Railway's edge **overwrote** it. The old
`resolve_client_ip` read the left-most entry, which was correct on Railway and
caller-controlled on Fly. On Fly, neither value of `RATE_LIMIT_TRUST_PROXY_HEADERS` was
safe: `true` made rate limits bypassable per forged header **and** let a caller dictate the
`receiver_ip` recorded as evidence on a handover confirmation and the `client_ip` on an
audit-pack access event; `false` recorded fly-proxy's own address on every delivery.

Now `CLIENT_IP_HEADER` names the header the edge guarantees — `fly-client-ip`, which
fly-proxy sets itself and a caller cannot. `config_validation.py` refuses to start a
production process that trusts proxy headers while naming `x-forwarded-for` on Fly
(detected via the machine-injected `FLY_APP_NAME`), because that combination fails
silently in both directions. Default stays `x-forwarded-for`, so nginx and local setups are
unaffected.

**Set on Fly before cutover:** `CLIENT_IP_HEADER=fly-client-ip` alongside
`RATE_LIMIT_TRUST_PROXY_HEADERS=true`. Full variable list in runbook §3.

### Still to do for the cutover

1. `fly platform regions | grep jnb` — `fly.toml` pins `primary_region = "jnb"`
   (Johannesburg) so requests carrying personal data terminate in-region. Confirm it
   exists before the first deploy.
2. The image has never been built on this machine (no Docker locally). WeasyPrint needs
   Pango/HarfBuzz and hedera-sdk-py boots a JVM via jnius — both are in the Dockerfile,
   and `[[vm]] memory = "1gb"` is set for them. Watch the first build log.
3. DNS: point `api.freightproof.co.za` at the Fly app, and `fly certs add` for it.
4. Historical Railway mentions in `docs/design-notes/*` and `docs/iteration4/*` were left
   alone deliberately — they are records of what was true when written, not instructions.

---

## 4. Untrack the three committed cache files

`.gitignore` covers these now, but they were committed before the rule existed. This is the
command `.gitignore` points at:

```bash
git rm --cached backend/node_modules/.vitest-cache/CACHEDIR.TAG \
                backend/node_modules/.vitest-cache/_metadata.json \
                'node_modules/.vite/vitest/da39a3ee5e6b4b0d3255bfef95601890afd80709/results.json'
```

They stay on disk; only the index entry goes. Nothing else junk-shaped is tracked — no
`.DS_Store`, no `__pycache__`, no `.next`, no `.tsbuildinfo`.

---

## 5. After the merge, in this order

1. **Migrations, from `dev`, after the merge** — never from a feature branch.
   `DATABASE_URL` is the shared Supabase database and records one `alembic_version`.
   24 migrations are new since `main`. Check `alembic current` against the shared database
   before deploying: several are believed unapplied (audit packs, incidents, driver push
   tokens, driver position source), but that was not verified for this report — nothing
   here connected to the shared database.
2. **Graph is already rebuilt** (24,209 nodes / 68,767 edges, up from 17,917 / 51,272 on
   15 Oct) and staged — it just needs committing, per CLAUDE.md's Team Graph Policy. Two
   caveats on it: the semantic layer was extracted by skimming the large plan docs rather
   than reading them whole, so doc-concept edges are shallower than the code layer (which
   is deterministic AST and unaffected); and the corpus picked up Xcode build output under
   `frontend/driver-pwa/ios/{DerivedData,App/Pods}` even though both are gitignored. Those
   artifact paths also account for most of the 10,306 dangling-endpoint edges the health
   check warned about. Worth excluding from the corpus before the next rebuild.
3. **Deploy** per runbook §3 (Fly), §4 (receiver), §4a (client portal), §5 (dispatcher),
   then verify with runbook §9 — `/health` names the build, a junk handover token returns
   404 not 405, CORS accepts the receiver origin, an unsigned webhook body gets 401, and
   `/docs` is **not** published.
4. **Client portal now has a CI job.** It had none, despite being the surface an insurer or
   claimant opens from a link in an issued PDF. It passes today unchanged.

## 6. Known open, not blocking

* `app.freightproof.co.za` is a dangling DNS record — point it somewhere or remove it.
* Driver app has no browser deployment; only the TestFlight iOS build exists. `output:
  'export'` means `next.config.ts`'s `headers()` does nothing, so security headers would
  have to be set at the hosting layer.
* Android has never been run against the hosted API.
* `pip-audit`, `npm audit` and `gitleaks` are all still `continue-on-error: true` in CI.
