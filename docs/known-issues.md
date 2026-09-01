# Known Issues & Tech Debt

A running list of environment and code issues to raise with the team. Each entry
records the symptom, root cause, impact, and proposed fix. Delete an entry once it
is resolved (and, if it changed shared behaviour, note it in the relevant spec).

---

## 1. `??` fallback in `supabase.ts` fails on empty-string env vars

**Files:** `frontend/driver-pwa/lib/supabase.ts` (and the equivalent
`frontend/dispatcher/lib/supabase/client.ts` — verify before fixing).

**Symptom:** The driver PWA compiles and reaches "Ready", but every page returns
HTTP 500 with `Error: supabaseUrl is required.`

**Root cause:** The client reads config as
`process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co'`.
`??` only substitutes the placeholder when the value is `null`/`undefined`. When a
developer's `.env.local` contains `NEXT_PUBLIC_SUPABASE_URL=` (present but empty),
the value is the empty string `""`, which is *not* nullish — so the placeholder is
skipped and `createClient("")` throws.

**Why it's inconsistent across the team:** `.env.local` is gitignored, so its shape
differs per machine. Omitting the line entirely → works. Leaving it empty → crash.
Notably, the committed `.env.example` demonstrates the empty-value form, so anyone
who copies it verbatim and runs in demo mode hits the crash.

**Impact:** Medium severity, high friction. No data or production-logic risk, but
the app looks completely broken (blank 500) for any teammate or CI job whose env
file follows the documented example. Masquerades as an unrelated failure.

**Proposed fix (team decision — touches a shared auth file):** Use `||` instead of
`??` so empty strings also fall back, or normalise the env read (trim and treat
empty as unset). Apply the same fix to the dispatcher client if it shares the
pattern.

---

## 2. Node version is not pinned anywhere

**Scope:** whole repo — no `.nvmrc`, no `"engines"` field in any `package.json`.

**Symptom:** On Node 23.x the driver PWA's dev server hangs indefinitely at startup
(the `@serwist/next` import inside `next.config.ts` stalls ~35s→never), so the app
never boots and appears dead with no error message.

**Root cause:** The project targets Node 22 LTS (stated in `README.md` and
`CLAUDE.md`) but nothing enforces it. A routine `brew upgrade` can move a developer
onto Node 23 — an odd-numbered, non-LTS "Current" release — without warning.

**Impact:** Medium severity, recurring/latent. Costs a confusing debugging session
each time someone drifts off the supported line, because the failure (a silent
hang) points nowhere near the real cause. Undermines cross-developer
reproducibility, which the `CLAUDE.md` standards section is meant to guarantee.

**Proposed fix (team decision — touches shared config):** Add `.nvmrc` containing
`22` and `"engines": { "node": ">=22 <23" }` to the frontend `package.json` files.
`.nvmrc` lets `nvm use` auto-select the right version; `engines` makes npm warn
(or error under `engine-strict`) on the wrong Node.

---

## 3. Xcode's "Update to recommended settings" breaks the iOS build

**Files:** `frontend/driver-pwa/ios/App/App.xcodeproj/project.pbxproj`.

**Symptom:** `npx cap run ios` / `xcodebuild` fails with
`error: Sandbox: bash(...) deny(1) file-read-data .../Pods-App-frameworks.sh` and
`Operation not permitted`, in the `[CP] Embed Pods Frameworks` phase.

**Root cause:** Accepting Xcode 26's "Update to recommended settings" banner sets
`ENABLE_USER_SCRIPT_SANDBOXING = YES` on the App project. CocoaPods' embed-frameworks
run script reads files outside its declared inputs, so the sandbox denies it. CocoaPods
knows this — it already sets the flag to `NO` on all 12 of its own Pods targets — but it
cannot set it for the App target, which is the one Xcode "upgraded".

**Impact:** Hard build failure, blocks all device testing. Reappears any time the banner
is accepted again.

**Fix (applied):** `ENABLE_USER_SCRIPT_SANDBOXING = NO` in both Debug and Release. If the
banner returns, do not accept it for the App project — and never for Pods, which
`pod install` regenerates on every `cap sync` anyway.

---

## 4. The async engine has no pool or connect timeouts

**Files:** `backend/app/db/session.py` (lines 21–24, the `create_async_engine` call).

**Symptom:** Nothing visible yet — this is latent. It surfaces as a request that never
returns rather than one that fails: the client eventually gives up, the server-side
handler is still sitting there, and the logs show no error because nothing raised.

**Root cause:** The engine is built with `pool_pre_ping=True` and nothing else. Three
separate waits are therefore unbounded, each with its own trigger:

1. **Connecting.** asyncpg is given no `timeout`, so opening a new connection waits on
   the OS TCP timeout. If Supabase is reachable at the network level but not answering
   — the usual shape of a Supabase incident, as opposed to a clean outage — that wait is
   measured in minutes, not seconds.
2. **Waiting for a free connection.** `pool_timeout` defaults to 30s in SQLAlchemy, which
   *is* a bound, but a 30s queue wait under pool exhaustion is far longer than any
   request in this system should live. Every handler inherits it.
3. **Pre-ping.** `pool_pre_ping=True` issues a `SELECT 1` before handing a connection
   out. That is exactly the right behaviour for Supabase, which drops idle connections
   aggressively — but the ping is itself an unbounded round trip on a connection that
   has just been sitting idle, which is precisely the connection most likely to be
   half-open. The feature that protects us from stale connections is also the one that
   inherits their hang.

**Relationship to the `/health` fix (issue resolved on this branch):** `/health` was the
one place where this was *visible*, because it makes an explicit worst-case promise to
an orchestrator. That endpoint is now bounded from both ends: `asyncio.wait_for` around
the probe and its cleanup, and a non-committing session dependency so teardown does not
issue an unbounded `COMMIT`. But that is a bound applied *at one call site*. Every other
endpoint in the app still sits on the unbounded engine underneath. `/health` is now
honest about its own latency; it is not evidence that the database layer is bounded.

**Why it was not fixed in the same change:** it is a different failure mode with a much
wider blast radius. The `/health` fix touches one endpoint and cannot change behaviour
anywhere else. Adding `connect_args={"timeout": ...}` and a shorter `pool_timeout` to the
engine changes the failure behaviour of *every* query on *all four* branches at once,
including Celery tasks and Alembic — and the correct values depend on numbers nobody has
measured yet (real Supabase connect latency from `af-south-1`, and the pool's actual
high-water mark under the load the demo generates). Guessing them converts a rare hang
into a frequent spurious error, which is a worse trade.

**Impact:** Low probability, high severity when it fires, and effectively undiagnosable
from the logs — the signature of the bug is the *absence* of an error. Most likely to
appear during a live demo on conference wifi, which is the worst possible time.

**Proposed fix (team decision — `session.py` is imported by every endpoint):**
1. Measure first. Log connect latency and pool checkout wait for one full demo run;
   `pool_timeout` and the connect timeout should be set from observed p99, not invented.
2. Then set `connect_args={"timeout": N, "command_timeout": M}` for asyncpg and an
   explicit `pool_timeout`, with the values in `core/config.py` rather than as literals,
   so they can be tuned per environment without a code change.
3. Consider `pool_recycle` as well, sized under Supabase's idle-connection cutoff. That
   attacks the same problem from the other side — recycling a connection before it can go
   stale is cheaper than detecting staleness with a pre-ping that might hang.

**Owner:** unassigned. Raise at the next sprint boundary; do not fold into an unrelated PR.

---

## Common theme

Issues 1 and 2 stem from the project depending on each developer's local setup being
"correct" without defining or enforcing what correct is. Node version and
`.env.local` contents are invisible and per-machine, so the app works for whoever
set things up right and mysteriously breaks for everyone else. Pinning the Node
version and hardening the env-var fallback convert "silently depends on local
setup" into "explicitly defined and self-correcting".
