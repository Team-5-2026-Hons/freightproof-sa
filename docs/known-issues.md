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

## Common theme

Both issues stem from the project depending on each developer's local setup being
"correct" without defining or enforcing what correct is. Node version and
`.env.local` contents are invisible and per-machine, so the app works for whoever
set things up right and mysteriously breaks for everyone else. Pinning the Node
version and hardening the env-var fallback convert "silently depends on local
setup" into "explicitly defined and self-correcting".
