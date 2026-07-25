# Audit Fix Implementation Plan (2026-07-19)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every actionable finding from the 2026-07-19 full-codebase audit — one iOS release blocker, one backend 500-on-outage bug, accessibility/UI gaps, and dead-code removal on both driver-pwa and backend.

**Architecture:** No new features. Each section is an independent batch of small, verifiable fixes. Frontend work stays inside `frontend/driver-pwa/` (plus two team-ack-gated `frontend/shared/` edits). Backend work respects the layering rule (endpoints → orchestration → integrations/blockchain/crypto → db). Every section ends with the full gates green and files **staged only** — Tim commits.

**Tech Stack:** Next.js 15 App Router (`output: 'export'`, all pages `"use client"`), Capacitor 6, Tailwind 3.4, vitest; FastAPI 0.115, SQLAlchemy 2.0 async, Pydantic v2, pytest.

---

## Execution rules (read before any task)

1. **Git:** Agents may run `git add <specific files>` only. **Never** `git commit`/`push`/`checkout`/`reset` (CLAUDE.md). Each section ends with files staged + a suggested Conventional Commit message. Tim reviews `git diff --staged` and commits between sections so each commit stays one logical change.
2. **Scope walls:** `frontend/dispatcher/` is off-limits entirely. `frontend/shared/` is read-only except tasks explicitly marked **BLOCKED: team ack** — skip those until Tim confirms the team agreed. `backend/app/core/config.py`, `backend/requirements.txt`, `frontend/driver-pwa/package.json` are shared files — do the task, but the completion report must flag them.
3. **Gates (run from repo root unless noted):**
   - Frontend: `cd frontend/driver-pwa && npx tsc --noEmit && npx vitest run && npm run lint`
   - Backend: `cd backend && .venv/bin/python -m pytest -q` (expect `155+ passed, 114 skipped` — the skips are the established no-`TEST_DATABASE_URL` gate; a new failure count is a stop-the-line signal)
4. **Stop conditions:** any gate red after your change and not obviously caused by it → stop, report, do not "fix forward" into unrelated files. Any file outside the task's listed files needing edits → stop and report.

## Subagent & model matrix

| Section | Work | Agent type | Model | Why this tier |
|---|---|---|---|---|
| A | iOS entitlement strip (release blocker) | general-purpose | **sonnet** | Multi-file but fully specified; plist XML needs care, not judgment |
| B | Quick UI/a11y wins (4 one-file fixes) | general-purpose | **haiku** | Exact before/after code is in the plan; pure mechanical |
| C | Backend correctness (Hedera mapping, logging, redaction doc+test) | general-purpose | **sonnet** (C3 decision itself: **Tim + Fable**, already made below) | Touches evidence paths; code is specified but tests need adaptation to existing fixtures |
| D | Frontend dead code + refactors | general-purpose | **sonnet** (D5 animations: sonnet + screenshot check) | Broad multi-file edits; D2 is 18 call sites; D5 needs visual judgment |
| E | Backend dead code + layering | general-purpose | **sonnet** | Mechanical deletions guarded by greps; E5/E6 are real but well-bounded refactors |
| F | UI polish (AnchorProgress, SignaturePad) | general-purpose | **opus** for F2, sonnet for F1 | F2 (canvas resize with stroke preservation) is genuinely fiddly |
| G | Orchestration unit tests | general-purpose | **opus** | Test design quality is the whole point; weak tests here are worse than none |
| Review gate after each section | Diff review vs this plan | superpowers:code-reviewer | **opus** (Fable spot-checks the risky diffs A, C, F2 personally) | Independent eyes; Fable reserved for judgment calls |
| H | Coordination items | **no agent — humans** | — | Team decisions, DB migration, release checklist |

Dispatch one section at a time. Sections A, B, C, D, E are independent of each other; F depends on nothing; G depends on nothing. Run the review gate before starting the next section.

---

## Section A — iOS release blocker (do first)

### Task A1: Strip unused background-geolocation plugin and its entitlements

**Files:**
- Modify: `frontend/driver-pwa/package.json` (shared file — flag in report)
- Modify: `frontend/driver-pwa/package-lock.json` (via npm, not by hand)
- Modify: `frontend/driver-pwa/ios/App/App/Info.plist`

- [ ] **Step 1: Prove the plugin is unused (guard against drift since audit)**

Run: `cd frontend/driver-pwa && grep -rn "background-geolocation\|BackgroundGeolocation" --include="*.ts" --include="*.tsx" app components lib capacitor.config.ts`
Expected: no output. If there IS output, STOP — someone wired it up since the audit; report and skip this task.

- [ ] **Step 2: Remove the dependency**

Run: `cd frontend/driver-pwa && npm uninstall @capacitor-community/background-geolocation`
Expected: `package.json` no longer contains `"@capacitor-community/background-geolocation"`; lockfile regenerated.

- [ ] **Step 3: Remove the two background-location declarations from Info.plist**

In `frontend/driver-pwa/ios/App/App/Info.plist`, delete exactly these two blocks (currently around lines 54–59):

```xml
	<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
	<string>FreightProof tracks trip location in the background to detect warehouse arrival and departure while a trip is active.</string>
```

and

```xml
	<key>UIBackgroundModes</key>
	<array>
		<string>location</string>
	</array>
```

**Keep** `NSLocationWhenInUseUsageDescription` (foreground `@capacitor/geolocation` needs it). **Keep** the `NSAppTransportSecurity` DEV ONLY block — its removal is a TestFlight-checklist item (Section H), not this task.

- [ ] **Step 4: Verify plist is still valid XML**

Run: `plutil -lint frontend/driver-pwa/ios/App/App/Info.plist`
Expected: `Info.plist: OK`

- [ ] **Step 5: Sync Capacitor (best-effort)**

Run: `cd frontend/driver-pwa && npm run cap:sync:ios`
Expected: may fail at the CocoaPods/Xcode stage on this machine (Xcode is not installed — known). A failure **only** in the pod/xcodebuild stage is acceptable; the `npx cap sync` copy stage must succeed. Also run `npm run cap:sync` (Android) — must fully succeed.

- [ ] **Step 6: Run frontend gates**

Run: `cd frontend/driver-pwa && npx tsc --noEmit && npx vitest run && npm run lint`
Expected: clean / 345+ passed / 0 errors.

- [ ] **Step 7: Stage**

```bash
git add frontend/driver-pwa/package.json frontend/driver-pwa/package-lock.json "frontend/driver-pwa/ios/App/App/Info.plist"
```

Suggested commit (Tim runs it): `fix(driver-pwa): strip unused background-geolocation plugin and iOS background-location entitlements`

---

## Section B — Quick UI/a11y wins (driver-pwa)

### Task B1: Restore visible keyboard focus on Tabs

**Files:**
- Modify: `frontend/driver-pwa/components/ui/Tabs.tsx:43`
- Test: existing suite only (visual class change)

- [ ] **Step 1: Replace the bare outline-none with a visible ring**

In `components/ui/Tabs.tsx`, the trigger's class list currently ends with:

```ts
              'focus-visible:outline-none',
```

Replace with:

```ts
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
```

(If `ring-primary` is not a defined token in `tailwind.config.ts`, use the token the global focus rule in `app/globals.css:62-67` uses for its outline color.)

- [ ] **Step 2: Verify by keyboard** — `npm run dev`, open `/trips`, Tab to the tab list, arrow across Active/Upcoming/Past: a visible ring must appear on the focused trigger before selection.

- [ ] **Step 3: Run gates** (`npx tsc --noEmit && npx vitest run`) — expected green.

- [ ] **Step 4: Stage**

```bash
git add frontend/driver-pwa/components/ui/Tabs.tsx
```

### Task B2: Align Checkpoint Cancel with the no-`router.back()` convention

**Files:**
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx:156`

- [ ] **Step 1: Find the page's own header back-target.** The header on this same file (~line 106) already navigates with an explicit route (the file documents why `router.back()` is unsafe). Note the exact route/constant it uses.

- [ ] **Step 2: Make Cancel use the same explicit target.** Replace:

```tsx
          <Button variant="secondary" size="lg" className="mt-4" onClick={() => router.back()}>
```

with the same navigation call the header uses, e.g. (adjust to what Step 1 found — prefer an existing `ROUTES` constant over a string literal):

```tsx
          <Button variant="secondary" size="lg" className="mt-4" onClick={() => router.push('/trip/in-transit')}>
```

- [ ] **Step 3: Verify no `router.back()` remains in the checkpoint/exception/panic flows:**

Run: `grep -rn "router.back()" "frontend/driver-pwa/app/(app)/trip"`
Expected: no output.

- [ ] **Step 4: Run gates, then stage**

```bash
git add "frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/CheckpointPageClient.tsx"
```

### Task B3: Route-aware AppShell title

**Files:**
- Modify: `frontend/driver-pwa/components/layout/AppShell.tsx`
- Modify: `frontend/driver-pwa/app/(app)/layout.tsx:34` (only if it must pass a prop — preferred design needs no prop)

- [ ] **Step 1: Derive the title from the pathname inside AppShell.** Replace the `title` prop plumbing with:

```tsx
'use client'

import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { OfflineBanner } from './OfflineBanner'
import { ProfilePanel } from './ProfilePanel'
import { BottomNav } from './BottomNav'

// Shell header titles for top-level nav destinations. Handshake/trip sub-flows
// render their own StepHeader, so the fallback brand title is correct there.
const ROUTE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/trips': 'Trips',
  '/settings': 'Settings',
}

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const pathname = usePathname()
  const title = ROUTE_TITLES[pathname] ?? 'FreightProof'
  // ... rest of the component unchanged, still rendering {title}
```

Keep the rest of the JSX exactly as-is. If `app/(app)/layout.tsx:34` passes no `title` prop today (it doesn't), only the interface changes; confirm no other call site passes `title` (`grep -rn "<AppShell" frontend/driver-pwa/app frontend/driver-pwa/components`).

- [ ] **Step 2: Run gates** — a test may assert the old static header text; update any such test to match the route-aware behavior (assert 'Home' on `/`).

- [ ] **Step 3: Stage**

```bash
git add frontend/driver-pwa/components/layout/AppShell.tsx "frontend/driver-pwa/app/(app)/layout.tsx"
```

### Task B4: Single source of truth for APP_VERSION

**Files:**
- Modify: `frontend/driver-pwa/next.config.ts` (it already reads `package.json` version around line 116)
- Modify: `frontend/driver-pwa/lib/constants/app.ts`

- [ ] **Step 1: Expose the build-time version as an env var.** In `next.config.ts`, where the package.json version is already read for the SW revision, add to the exported config object:

```ts
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
  },
```

(Reuse the existing variable that holds the parsed version — do not re-read the file.)

- [ ] **Step 2: Read it in app.ts.** Replace the hardcoded constant:

```ts
// Injected from package.json "version" at build time via next.config.ts `env` —
// the fallback only appears in unbuilt contexts (unit tests).
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0-dev'
```

- [ ] **Step 3: Run gates; check the settings page test** (if one asserts '0.1.0', update it to assert the env-injected value or the fallback). Stage:

```bash
git add frontend/driver-pwa/next.config.ts frontend/driver-pwa/lib/constants/app.ts
```

Suggested commit for Section B (one commit): `fix(driver-pwa): tabs focus ring, explicit checkpoint cancel nav, route-aware shell title, build-injected app version`

---

## Section C — Backend correctness

### Task C1: Map Hedera errors on driver create/update (500 → 504/502)

**Files:**
- Modify: `backend/app/api/v1/endpoints/drivers.py`
- Test: `backend/tests/integration/test_drivers_anchor.py`

- [ ] **Step 1: Write the failing tests.** In `test_drivers_anchor.py`, following the module's existing fixture pattern (it already seeds and patches `anchor_subject` — mirror the vehicles anchor tests' structure):

```python
async def test_create_driver_hedera_timeout_returns_504(client_with_db, monkeypatch):
    async def _timeout(*args, **kwargs):
        raise HederaTimeoutError("mirror node timed out")
    monkeypatch.setattr("app.orchestration.driver_service.anchor_subject", _timeout)

    resp = await client_with_db.post("/api/v1/drivers", json=_valid_driver_body())

    assert resp.status_code == 504


async def test_create_driver_hedera_error_returns_502(client_with_db, monkeypatch):
    async def _boom(*args, **kwargs):
        raise HederaServiceError("submit failed")
    monkeypatch.setattr("app.orchestration.driver_service.anchor_subject", _boom)

    resp = await client_with_db.post("/api/v1/drivers", json=_valid_driver_body())

    assert resp.status_code == 502
```

Adapt fixture/helper names (`client_with_db`, body builder) to what `test_drivers_anchor.py` actually uses — do not invent new fixtures. Import `HederaServiceError, HederaTimeoutError` from `app.blockchain.hedera` (or `app.core.exceptions` if Section E5 already ran). Add the mirror-image PATCH test for `update_driver` too.

- [ ] **Step 2: Run to verify they fail** — `cd backend && .venv/bin/python -m pytest tests/integration/test_drivers_anchor.py -q`. Expected: new tests error with an unhandled `HederaTimeoutError`/500, not 504/502. (If integration tests skip locally for lack of `TEST_DATABASE_URL`, note it and rely on the code-level diff check in Step 3 + CI.)

- [ ] **Step 3: Implement — mirror `vehicles.py:45-48` exactly.** In `drivers.py`, add the import:

```python
from app.blockchain.hedera import HederaServiceError, HederaTimeoutError
```

and extend **both** `create_driver_endpoint` and `update_driver_endpoint` try-blocks with:

```python
    except HederaTimeoutError as exc:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail=str(exc))
    except HederaServiceError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
```

- [ ] **Step 4: Run the backend gate.** Expected: previous counts + new tests passing (or skipped with the established gate).

- [ ] **Step 5: Stage**

```bash
git add backend/app/api/v1/endpoints/drivers.py backend/tests/integration/test_drivers_anchor.py
```

Suggested commit: `fix(api): map Hedera timeout/service errors to 504/502 on driver create and update`

### Task C2: Log the swallowed consensus-timestamp failure

**Files:**
- Modify: `backend/app/blockchain/hedera.py:126`

- [ ] **Step 1: Confirm the module has a logger** (`grep -n "logger" backend/app/blockchain/hedera.py`). If none: add `import logging` and `logger = logging.getLogger(__name__)` at module top.

- [ ] **Step 2: Replace the silent except:**

```python
        except Exception as exc:  # pragma: no cover - defensive parse of SDK record
            # Anchoring already succeeded at this point; a missing consensus
            # timestamp degrades the receipt, so record why instead of hiding it.
            logger.warning("Could not read consensus timestamp from tx record: %s", exc)
            consensus_timestamp = None
```

- [ ] **Step 3: Run backend gate, stage**

```bash
git add backend/app/blockchain/hedera.py
```

Suggested commit: `fix(blockchain): log consensus-timestamp parse failures instead of swallowing them`

### Task C3: Document + pin the driver-receipts asymmetry (decision: keep, not redact)

**Decision (made with Tim's sign-off pending — confirm before dispatch):** `GET /trips/me/active` keeps returning `blockchain_receipts` to the driver. The driver PWA's anchor UI (AnchorProgress, anchor badges) consumes them; receipts contain hashes/tx ids, no PII. The fix is to make the asymmetry *intentional and tested* rather than accidental.

**Files:**
- Modify: `backend/app/orchestration/trip_service.py` (`get_active_trip_for_driver`, ~lines 313-331 — comment only)
- Test: `backend/tests/integration/test_trips.py` (or the module that covers `/trips/me/active`)

- [ ] **Step 1: Add the intent comment** above the return in `get_active_trip_for_driver`:

```python
    # Deliberate asymmetry with GET /trips/{id} (which strips receipts for
    # non-admin dispatchers): the driver's own active trip keeps its
    # blockchain_receipts because the PWA anchor UI renders them. Receipts
    # carry hashes/tx ids only — no PII (POPIA-safe). Covered by
    # test_active_trip_includes_receipts_for_driver.
```

- [ ] **Step 2: Write the pinning test** (fails only if someone later strips receipts):

```python
async def test_active_trip_includes_receipts_for_driver(client_with_db, seed_trip):
    resp = await client_with_db.get("/api/v1/trips/me/active")

    assert resp.status_code == 200
    body = resp.json()
    assert "blockchain_receipts" in body
    # anchored seed trip → at least the H0 anchor receipt must be visible
    assert isinstance(body["blockchain_receipts"], list)
```

Adapt fixtures to the file's existing driver-auth seeding pattern.

- [ ] **Step 3: Run backend gate, stage**

```bash
git add backend/app/orchestration/trip_service.py backend/tests/integration/test_trips.py
```

Suggested commit: `test(orchestration): pin driver visibility of own-trip blockchain receipts as intentional`

---

## Section D — Frontend dead code & refactors

### Task D1: Delete the TripContext dead state machine

**Files:**
- Modify: `frontend/driver-pwa/lib/context/TripContext.tsx` (remove `currentHandshake`, `advance()`, `goBack()`, `handshakeFromStatus()` and their `TripState` fields — audit located them at lines 19, 23-24, 44-61, 131-182, 124, 231)
- Modify: `frontend/driver-pwa/lib/context/__tests__/TripContext.test.tsx` (remove the `handshakeFromStatus` describe block, ~lines 140-156)

- [ ] **Step 1: Re-verify zero consumers** (guard against drift):

Run: `cd frontend/driver-pwa && grep -rn "currentHandshake\b\|\.advance(\|\.goBack(\|handshakeFromStatus" app components lib --include="*.ts*" | grep -v "lib/context/TripContext" | grep -v "__tests__"`
Expected: no output. Real progress logic lives in `lib/utils/handshake-progress.ts` (`currentHandshakeNumber`) — do NOT touch that file.

- [ ] **Step 2: Delete** the state field, both callbacks, the `handshakeFromStatus` helper, their `TripState` type members, and the context value entries. Remove the now-dead tests.

- [ ] **Step 3: Run gates.** `tsc --noEmit` is the real check here — it will catch any consumer the grep missed. Expected: clean, vitest green (count drops by the deleted tests).

- [ ] **Step 4: Stage**

```bash
git add frontend/driver-pwa/lib/context/TripContext.tsx frontend/driver-pwa/lib/context/__tests__/TripContext.test.tsx
```

### Task D2: Make StepHeader derive its labels (kills 18 hardcoded call sites + adopts useStepIndicator)

**Files:**
- Modify: `frontend/driver-pwa/components/handshake/StepHeader.tsx`
- Modify: all 18 step components under `frontend/driver-pwa/components/handshake/steps/` that render `<StepHeader ... />`
- Delete nothing: `lib/hooks/useStepIndicator.ts` becomes the single derivation point.

- [ ] **Step 1: Change StepHeader's contract.** Give it `(handshake, step)` and derive the rest via the hook:

```tsx
import { useStepIndicator } from '@/lib/hooks/useStepIndicator'
import type { HandshakeNumber } from '@shared/lib/types/handshake'

interface StepHeaderProps {
  handshake: HandshakeNumber
  step: number
  // keep any existing presentational props (onBack etc.) unchanged
}

export function StepHeader({ handshake, step, ...rest }: StepHeaderProps) {
  const { handshakeName, stepName, current, total } = useStepIndicator(handshake, step)
  // render exactly what the component rendered before, sourcing the four
  // values from the hook instead of props
```

- [ ] **Step 2: Update every call site.** Example — `components/handshake/steps/H2Linehaul.tsx:77` changes from

```tsx
<StepHeader handshakeName="Loading" stepName="Confirm Linehaul" stepIndex={2} totalSteps={5} />
```

to

```tsx
<StepHeader handshake={2} step={2} />
```

Each step component already knows its handshake number and step index (they're in the filename/slug). Apply to all 18 sites.

- [ ] **Step 3: Verify zero hardcoded labels remain:**

Run: `grep -rn "handshakeName=\|stepName=\|totalSteps=" frontend/driver-pwa/components/handshake/steps`
Expected: no output.

- [ ] **Step 4: Run gates.** Any StepHeader tests asserting the old props: update to the new contract. Expected: green — and now `shared/handshake-meta.ts` is the single source the compiler enforces.

- [ ] **Step 5: Stage**

```bash
git add frontend/driver-pwa/components/handshake/StepHeader.tsx frontend/driver-pwa/components/handshake/steps frontend/driver-pwa/lib/hooks/useStepIndicator.ts
```

### Task D3 — **BLOCKED: team ack** — Delete `frontend/shared/lib/constants/copy.ts`

Zero importers, demonstrably drifted strings. It lives in `shared/`, so Tim must get a team yes first. After ack: `git rm frontend/shared/lib/constants/copy.ts`, then `grep -rn "constants/copy" frontend` (expect nothing), run both surfaces' type checks (`driver-pwa` AND ask the dispatcher owner to run theirs), stage.

### Task D4: Un-export the internal SEAL_FORMAT regex

**Files:** `frontend/driver-pwa/lib/utils/seal-format.ts:5`

- [ ] Change `export const SEAL_FORMAT = ...` to `const SEAL_FORMAT = ...`. Run `grep -rn "SEAL_FORMAT" frontend/driver-pwa --include="*.ts*"` — only this file may reference it. Gates, then stage the file.

### Task D5: Replace framer-motion with CSS animations (drops a full dependency from the APK)

**Files:**
- Modify: `frontend/driver-pwa/components/ui/Toast.tsx` (slide/fade in + exit via `AnimatePresence`)
- Modify: `frontend/driver-pwa/components/handshake/HoldButton.tsx` (confirm pulse `[1,1.15,1]`)
- Modify: `frontend/driver-pwa/components/handshake/GpsCapture.tsx` (captured fade-in + looping radar ring)
- Modify: `frontend/driver-pwa/components/handshake/CameraCapture.tsx` (empty↔captured cross-fade)
- Modify: `frontend/driver-pwa/tailwind.config.ts` (keyframes)
- Modify: `frontend/driver-pwa/package.json` (remove dep — last step)

- [ ] **Step 1: Add keyframes/utilities to `tailwind.config.ts`** under `theme.extend`:

```ts
      keyframes: {
        'fade-in-scale': {
          from: { opacity: '0', transform: 'scale(0.95)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'confirm-pulse': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.15)' },
        },
        'radar-pulse': {
          from: { transform: 'scale(1)', opacity: '0.6' },
          to: { transform: 'scale(1.8)', opacity: '0' },
        },
      },
      animation: {
        'fade-in-scale': 'fade-in-scale 200ms ease-out',
        'toast-in': 'toast-in 250ms ease-out',
        'confirm-pulse': 'confirm-pulse 400ms ease-in-out',
        'radar-pulse': 'radar-pulse 1.2s ease-out infinite',
      },
```

- [ ] **Step 2: Convert one file at a time**, replacing `motion.div` with `div` + the matching `animate-*` class and `motion-reduce:animate-none` (this replaces every per-file `useReducedMotion()` ternary — delete those). For Toast's exit animation (the only `AnimatePresence` exit that matters): keep it simple — on dismiss, set a `leaving` state that applies `opacity-0 translate-y-2 transition-all duration-200`, and remove the toast in an `onTransitionEnd`/200ms timeout. Run vitest after EACH file before starting the next.

- [ ] **Step 3: Visual check.** `npm run dev`, exercise: toast appears/dismisses, HoldButton confirm pulse, GPS capturing ring + captured state, camera photo swap. Take it slow — this is the one task in this section where "tests green" isn't proof.

- [ ] **Step 4: Remove the dependency.** `grep -rn "framer-motion" frontend/driver-pwa --include="*.ts*"` → expect no output → `npm uninstall framer-motion`. Full gates.

- [ ] **Step 5: Stage** all touched files + `package.json` + `package-lock.json`.

### Task D6: Shared time-format helper

**Files:**
- Create: `frontend/driver-pwa/lib/utils/format-time.ts`
- Modify: the three duplication sites — `app/(app)/trip/handshake/[h]/step/[slug]/HandshakeStepPageClient.tsx:249`, `app/(app)/trip/in-transit/InTransitPageClient.tsx:86`, `app/(app)/trips/page.tsx:25-31`

- [ ] **Step 1: Create the helper** (match the exact behavior of the existing sites — read all three first; they use `en-ZA` + 2-digit hour/minute):

```ts
// Single locale-pinned time formatter — the driver app is ZA-only and evidence
// timestamps must render identically on every screen.
const TIME_FORMAT = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' })

export function formatTime(date: Date | string): string {
  return TIME_FORMAT.format(typeof date === 'string' ? new Date(date) : date)
}
```

If one of the three sites also formats the *date* part, add a `formatDateTime` alongside rather than overloading.

- [ ] **Step 2: Replace all three sites**, run `grep -rn "toLocaleTimeString\|en-ZA" frontend/driver-pwa/app frontend/driver-pwa/components` to confirm no stragglers, gates, stage (4 files).

### Task D7: Stop precaching /dev/tokens in production

**Files:** `frontend/driver-pwa/next.config.ts:78`

- [ ] Remove `'/dev/tokens'` from `STATIC_ROUTES`. The page keeps working in dev (it's still a route); it just stops shipping in the SW precache. Run `npm run build` once to confirm the precache list builds. Gates, stage.

### Task D8: Rename the mock-data ActiveTripPageClient

**Files:**
- Rename: `frontend/driver-pwa/app/(app)/trips/[id]/ActiveTripPageClient.tsx` → `TripDetailPageClient.tsx` (component `ActiveTripPage` → `TripDetailPage` if it carries the same conflated name)
- Modify: `frontend/driver-pwa/app/(app)/trips/[id]/page.tsx` (import)
- Modify: `frontend/driver-pwa/app/(app)/trips/[id]/__tests__/ActiveTripPageClient.test.tsx` → rename + update import

- [ ] Use `git mv` for both renames, update the imports, run gates, stage. The real active-trip page at `trips/active/` keeps its name.

### Task D9 — **BLOCKED: team ack** — Add `pod_signature_artifact_id` to shared HandshakeEvent

**Files:** `frontend/shared/lib/types/handshake.ts:29-55`

After ack, add below `pod_photo_artifact_id`:

```ts
  pod_signature_artifact_id: string | null
```

Backend already sends it (`backend/app/schemas/handshakes.py:71-72`). Check `frontend/shared/lib/mocks/trips.ts` handshake fixtures compile (add `pod_signature_artifact_id: null` where required — the field is non-optional to force fixture honesty). Both surfaces must type-check; coordinate with the dispatcher owner. Gates, stage.

Suggested commits for Section D (Tim splits as staged): `refactor(driver-pwa): remove dead trip state machine`, `refactor(driver-pwa): derive step headers from shared handshake-meta`, `refactor(driver-pwa): replace framer-motion with CSS animations`, `chore(driver-pwa): dead-code cleanup (seal regex, dev tokens precache, rename trip detail client, shared time formatter)`

---

## Section E — Backend cleanup

> Tasks E1–E3 touch **shared files** (`core/config.py`, `requirements.txt`, `.env.example`). Not blocked, but Tim should drop a heads-up in the team channel before the commit lands on `dev`.

### Task E1: Make unbuilt-integration config optional; keep GPS_TOLERANCE_METRES

**Files:**
- Modify: `backend/app/core/config.py`
- Modify: `backend/.env.example`

- [ ] **Step 1:** In `config.py`, give the five unimplemented-integration settings safe defaults so the app boots without dummy values:

```python
    # Twilio — NOT YET IMPLEMENTED (no client code). Optional until the SMS
    # integration lands; required-ness should return with the feature.
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""

    # SendGrid — NOT YET IMPLEMENTED (no client code). Same deal.
    SENDGRID_API_KEY: str = ""
    SENDGRID_FROM_EMAIL: str = ""
```

- [ ] **Step 2:** Delete the dead settings outright: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET_NAME` (storage is Supabase — `app/storage/supabase_storage.py`), and `SUPABASE_JWT_SECRET` (zero usages; its docstring describes local verification that `auth/dependencies.py` doesn't do — it fetches JWKS). First guard: `grep -rn "AWS_ACCESS_KEY_ID\|S3_BUCKET_NAME\|SUPABASE_JWT_SECRET" backend/app backend/tests backend/scripts` → only config.py lines may appear.

- [ ] **Step 3:** **Keep** `GPS_TOLERANCE_METRES` — it is the config for the geofence check this branch will build. Improve its comment: `# Used by the (upcoming) H1/H4 gate geofence check — see feature/gps-warehouse-geofencing.`

- [ ] **Step 4:** Mirror every removal/optional-ing in `.env.example` (remove dead keys; keep Twilio/SendGrid keys listed with a `# not yet used` note). Never touch `.env` itself.

- [ ] **Step 5:** Backend gate (`conftest.py` may set dummy values for the deleted keys — clean those too if present). Stage:

```bash
git add backend/app/core/config.py backend/.env.example
```

### Task E2: Drop unused Python dependencies

**Files:** `backend/requirements.txt`

- [ ] **Step 1: Guard-grep each candidate** before removal:

```bash
cd backend && for pkg in "twilio" "sendgrid" "boto3" "nacl" "PIL" "dotenv"; do echo "== $pkg =="; grep -rn "import $pkg\|from $pkg" app tests scripts; done
```

Expected: no output for all six.

- [ ] **Step 2: Remove the lines** for `twilio==9.0.4`, `sendgrid==6.11.0`, `boto3>=1.35.0,<2.0.0`, `pynacl==1.5.0`, `pillow>=11.0.0,<12.0.0`, `python-dotenv==1.0.1`. **Note:** CLAUDE.md names PyNaCl for Ed25519 in `crypto/` — that code doesn't exist yet; add a comment `# pynacl returns when crypto/ Ed25519 signing lands` where it was, so intent isn't lost.

- [ ] **Step 3:** Fresh-install check in a throwaway venv if time permits, else at minimum `cd backend && .venv/bin/python -m pytest -q` (the venv still has the packages — the greps are the real guard). Check `.github/workflows/` for any workflow installing these explicitly (`grep -rn "twilio\|sendgrid\|boto3" .github/` → expect nothing). Stage `backend/requirements.txt`.

### Task E3: Split dev tooling out of production requirements

**Files:**
- Modify: `backend/requirements.txt` (remove the `# Dev & testing` block)
- Create: `backend/requirements-dev.txt`
- Modify: any CI workflow that installs requirements (`grep -rn "requirements.txt" .github/`)

- [ ] **Step 1:** Create `backend/requirements-dev.txt`:

```
-r requirements.txt
pytest>=8.3.0,<9.0.0
pytest-asyncio>=0.24.0,<1.0.0
respx>=0.21.0,<1.0.0  # httpx transport mock — PP client unit tests
ruff>=0.7.0,<1.0.0
mypy>=1.13.0,<2.0.0
```

- [ ] **Step 2:** Delete those five lines from `requirements.txt`. Update every CI job found in Step 0's grep to `pip install -r requirements-dev.txt`. If Docker files under `infrastructure/docker/` install requirements, check whether the dev compose needs the dev file — **do not** edit `docker-compose.dev.yml` without flagging it (shared file).

- [ ] **Step 3:** Backend gate. Stage `backend/requirements.txt backend/requirements-dev.txt` + touched workflow files.

### Task E4: Typed /health response

**Files:** `backend/app/main.py:52-58`

- [ ] Add next to the endpoint:

```python
class HealthResponse(BaseModel):
    status: str
    version: str  # match whatever keys the current dict returns — read it first
```

and set `response_model=HealthResponse`, returning `HealthResponse(**the_same_values)`. `main.py` is a shared file — trivial change, but flag it. Gate, stage.

### Task E5: Move Hedera exception types to core (fixes endpoint-layer imports)

**Files:**
- Modify: `backend/app/core/exceptions.py` (add `HederaServiceError`, `HederaTimeoutError` — move the class definitions verbatim from `app/blockchain/hedera.py`)
- Modify: `backend/app/blockchain/hedera.py` (import them from core; keep raising them)
- Modify: every importer — `grep -rn "from app.blockchain.hedera import" backend/app backend/tests` and update each to `from app.core.exceptions import ...` for the two error classes (other symbols keep their hedera import)

- [ ] Steps: move classes → update hedera.py → update all importers (endpoints `vehicles.py`, `handshakes.py`, plus whatever the grep finds in orchestration/tests, plus `drivers.py` from C1) → backend gate → verify the layering rule now holds: `grep -rn "from app.blockchain" backend/app/api` → expect only `subject_visibility` (blockchain.py) remaining, which E6 addresses. Stage all touched files.

### Task E6: Push inline endpoint queries down into services

**Files:**
- Modify: `backend/app/api/v1/endpoints/handshakes.py:124-137` — move the two `select()`s (event fetch + ownership scoping) into a new `get_handshake_detail(db, trip_id, handshake_type, driver_id)` in `backend/app/orchestration/handshake_service.py`; endpoint becomes validate → call → map exceptions.
- Modify: `backend/app/api/v1/endpoints/blockchain.py:37-45` — move the `BlockchainReceipt` listing query into `backend/app/blockchain/anchor_service.py` (e.g. `list_receipts_for_subject(db, ...)`) or an orchestration wrapper; keep `assert_subject_visible` inside the service, not the endpoint.

- [ ] For each: write the service function with the exact query lifted verbatim (behavior-preserving — no query changes in this task), swap the endpoint body to the call, keep every raised exception type identical so the endpoint's HTTP mapping is untouched. The existing integration tests (`test_handshakes.py`, `test_blockchain.py`) are the safety net — run the backend gate after each of the two moves, not just at the end. Stage.

### Task E7 (optional, LOW — do only if the section is ahead of schedule): centralize `MAX_FILE_SIZE_BYTES`

Move `backend/app/orchestration/artifact_service.py:17` to `core/config.py` as `MAX_ARTIFACT_SIZE_BYTES: int = 10 * 1024 * 1024` and import it. Note the frontend mirrors this limit in `lib/api/artifacts.ts` (pre-upload 413) — add a cross-reference comment on both sides. The remaining timeout literals (JWKS TTL, PP timeout, mirror URLs) stay as-is this round.

Suggested commits for Section E: `chore(core): make unbuilt-integration config optional, drop dead AWS/JWT settings`, `chore(db): drop unused dependencies, split requirements-dev`, `refactor(api): typed health response, Hedera errors in core, endpoint queries moved into services`

---

## Section F — UI polish

### Task F1: AnchorProgress long-wait copy

**Files:** `frontend/driver-pwa/components/blockchain/AnchorProgress.tsx:58-70`

- [ ] **Step 1: Track elapsed time while pending:**

```tsx
const LONG_WAIT_MS = 15_000

// inside the component
const [longWait, setLongWait] = useState(false)
useEffect(() => {
  if (anchored) return
  const t = setTimeout(() => setLongWait(true), LONG_WAIT_MS)
  return () => clearTimeout(t)
}, [anchored])
```

- [ ] **Step 2:** In the pending branch, under the existing "Submitted to Hedera HCS" line add:

```tsx
{longWait && (
  <p className="text-xs text-surface-on-variant">
    Still anchoring — Hedera consensus can take a minute on a slow connection.
    Your evidence is already saved on this device.
  </p>
)}
```

- [ ] **Step 3:** Add a vitest case with fake timers: render un-anchored, `vi.advanceTimersByTime(15000)`, assert the copy appears; assert it never appears when `anchored` is true. Gates, stage (component + new/updated test).

### Task F2: SignaturePad resize/orientation handling (opus)

**Files:** `frontend/driver-pwa/components/handshake/SignaturePad.tsx`

Requirements: on CSS-box resize (rotation, keyboard, split-view), re-size the backing store **without losing strokes already drawn**, keeping coordinate mapping correct.

- [ ] **Step 1: Store strokes as data, not just pixels.** Keep a `strokesRef: MutableRefObject<Array<Array<{x: number, y: number}>>>` in **normalized** coordinates (0..1 relative to the CSS box). `getPoint()` divides by `rect.width/height` on capture; the draw routine multiplies back.

- [ ] **Step 2: Extract a `redraw(canvas)`** that clears, applies the DPR transform, and replays all strokes from `strokesRef`.

- [ ] **Step 3: Observe size changes:**

```tsx
useEffect(() => {
  const canvas = canvasRef.current
  if (!canvas) return
  const ro = new ResizeObserver(() => {
    sizeBackingStore(canvas) // existing width/height * dpr logic
    redraw(canvas)
  })
  ro.observe(canvas)
  return () => ro.disconnect()
}, [])
```

This replaces the current run-once sizing effect (`SignaturePad.tsx:22-41`); the ResizeObserver fires once on mount, preserving the current behavior.

- [ ] **Step 4: Keep the exported PNG path working** — whatever currently reads the canvas for upload (`toDataURL`) is unchanged; verify the existing SignaturePad test still passes and add one: simulate two strokes, dispatch a resize (mock `ResizeObserver` in jsdom — see how other tests mock observers in `vitest.setup.ts`), assert `toDataURL` output is non-empty and `strokesRef` retained 2 strokes (export a test-only handle if needed, following the `__resetOfflineQueueStoreForTests` precedent).

- [ ] **Step 5:** Gates; manual check in `npm run dev` (draw → shrink window → stroke persists, new strokes land under the pointer). Stage.

Suggested commit: `fix(driver-pwa): anchor long-wait messaging + signature pad survives resize/rotation`

---

## Section G — Orchestration unit tests (opus)

Priority order: the two services carrying critical-field-diff + anchoring logic first. The trap to avoid: `tests/unit/test_exceptions.py` tests `core/exceptions.py`, NOT `exception_service` — name new files unambiguously.

### Task G1: `tests/unit/test_driver_service.py`

**Files:**
- Create: `backend/tests/unit/test_driver_service.py`
- Read first: `backend/app/orchestration/driver_service.py` (anchor calls at 113, 199), `backend/app/blockchain/critical_fields.py`, existing `tests/unit/test_critical_fields.py` for fixture style

Cover, with mocked `AsyncSession` (follow the `_mock_db()` pattern used in `tests/unit` auth tests) and monkeypatched `anchor_subject`:

- [ ] `create_driver` → `anchor_subject` called once; **assert the anchored payload contains no PII fields** (no name, phone, id number — POPIA; mirror the assertion style of `test_create_driver_does_not_anchor_pii` at unit level)
- [ ] `update_driver` with only cosmetic fields → `anchor_subject` NOT called, event diff recorded
- [ ] `update_driver` with a critical field → anchored with only the critical diff
- [ ] `update_driver` unknown id → raises `ResourceNotFoundError`
- [ ] `create_driver` duplicate → raises `DuplicateResourceError`

Each test: Arrange/Act/Assert with blank lines, `uuid4()` ids, no shared state. Write test-by-test: red (function/behavior asserted precisely) → green against the real service (these are characterization tests — they should pass immediately; if one fails, STOP and report, you may have found a real bug — do not change the service to match the test without flagging it).

### Task G2: `tests/unit/test_vehicle_service.py`

Same shape as G1 for `vehicle_service.py`, plus its SEC-5 property: **assert the Pulsit device id appears only hashed in the anchored payload** (mirror `test_create_vehicle_payload_json_hashes_pulsit_device_id` at unit level).

### Task G3 (follow-up batch, separate session): `checkpoint_service`, `exception_service`, `manifest_service`, `resource_service`, `artifact_service` unit tests — same pattern, lower risk. Do not start in this plan's execution; open a tracking issue.

- [ ] After G1+G2: backend gate; stage `backend/tests/unit/test_driver_service.py backend/tests/unit/test_vehicle_service.py`.

Suggested commit: `test(orchestration): unit coverage for driver/vehicle services (anchoring, critical-field diff, POPIA payloads)`

---

## Section H — Coordination items (humans, no agent)

| # | Item | Who |
|---|---|---|
| H1 | Team ack for the `shared/` changes: this branch's existing `handshake-meta.ts` + `exception.ts` edits, plus planned D3 (`copy.ts` delete) and D9 (`pod_signature_artifact_id`) | Tim → team channel / standup |
| H2 | Apply `2026_07_17_tim_add_exception_gps` to the shared dev DB (`alembic upgrade head`) after merge coordination | Tim + whoever owns dev DB |
| H3 | Sync branch with `origin/dev` (currently 8 ahead / 1 behind; the behind commit is dev's merge of this branch's own PR #26/#29 line) before the next PR | Tim |
| H4 | `updated_at` policy: 6 append-only tables lack it (TripTrailer lacks both timestamps) vs the CLAUDE.md every-table rule — either add columns via Alembic or write the documented exception into CLAUDE.md (needs 4-reviewer PR) | Team |
| H5 | Ratify `eslint.ignoreDuringBuilds: true` (added July 18) or revert it | Team |
| H6 | TestFlight checklist: remove the `NSAppTransportSecurity` DEV ONLY block from Info.plist; requires HTTPS backend URL | Tim, at release time |
| H7 | Rebuild the graphify graph on `main` after next merge (designated maintainer only, per Team Graph Policy) | Maintainer |
| H8 | Token-vocabulary migration (59 files `surface-*` vs 6 shadcn-style) — direction decision, then piecemeal; not in this plan | Team / Tim |
| H9 | Geofencing feature itself (`GPS_TOLERANCE_METRES` consumer, haversine vs `organisations.geofence_radius_metres`) — this branch's actual feature; needs its own brainstorm + plan, not a "fix" | Tim |

---

## Self-review checklist (done at write time)

- Spec coverage: every Fix-first/UI/cleanup/testing finding from the 2026-07-19 audit maps to a task (A1, B1–B4, C1–C3, D1–D9, E1–E7, F1–F2, G1–G3) or a coordination row (H1–H9). Dispatcher-side findings intentionally have no tasks (scope wall).
- No placeholders: every code step shows code; the two pattern-fan-out tasks (D2, D5) show one complete example plus a zero-remaining grep.
- Type consistency: `StepHeader(handshake, step)` in D2 matches `useStepIndicator(handshake: HandshakeNumber, step: number)`; C1's exception imports account for E5 having possibly run first.
