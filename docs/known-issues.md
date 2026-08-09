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

## Common theme

Both issues stem from the project depending on each developer's local setup being
"correct" without defining or enforcing what correct is. Node version and
`.env.local` contents are invisible and per-machine, so the app works for whoever
set things up right and mysteriously breaks for everyone else. Pinning the Node
version and hardening the env-var fallback convert "silently depends on local
setup" into "explicitly defined and self-correcting".
