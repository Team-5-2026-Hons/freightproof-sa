# Driver PWA UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 18 UX findings from the 2026-07-02 browser walkthrough of the driver PWA (hold-button discoverability, seal-verify null state, evidence receipts, photo framing, button hierarchy, trip-card content, stepper overflow, jargon, nav consistency, offline banner, panic access, OTP resend, demo-session persistence, logout confirm).

**Architecture:** All changes are inside `frontend/driver-pwa` — components, app pages, lib constants/context. `frontend/shared/*` is READ-ONLY (imports allowed, edits forbidden — it is shared with the dispatcher surface). No backend changes. Tasks are grouped into 7 disjoint file sets so they can be implemented in parallel by independent agents.

**Tech Stack:** Next.js 15 App Router (`output: 'export'`, every page `'use client'`), TypeScript strict (no `any`), Tailwind, framer-motion, vitest + @testing-library/react.

**Hard rules for every task (from CLAUDE.md):**
- NEVER run `git commit`, `git push`, `git checkout`, `git stash`, or `git add`. Leave the working tree unstaged; the lead stages and the human commits.
- Do not touch any file outside your task's file list. Do not modify `frontend/shared/*`, `backend/*`, or any `package.json`.
- Comment the *why*, not the *what*. No magic values — extract constants.
- Every changed component needs a vitest test (new or updated) in the adjacent `__tests__/` dir.
- Verify with: `cd frontend/driver-pwa && npx vitest run <your test files> && npm run type-check`. Run the full `npm test` only if your slice is done early; the lead runs the full suite at the end.

---

## Task 1: HoldButton discoverability, overflow, and tap-to-confirm accessibility mode

**Files:**
- Modify: `frontend/driver-pwa/components/handshake/HoldButton.tsx`
- Create: `frontend/driver-pwa/lib/constants/preferences.ts`
- Modify: `frontend/driver-pwa/app/(app)/settings/page.tsx`
- Modify: `frontend/driver-pwa/lib/constants/app.ts`
- Modify: `frontend/driver-pwa/.env.example`
- Test: `frontend/driver-pwa/components/handshake/__tests__/HoldButton.test.tsx` (create dir/file if absent; check for an existing HoldButton test first and extend it instead)

### 1a. Early-release hint (the walkthrough's worst finding)

Today a plain tap on a HoldButton does nothing — no feedback at all. Users (and the walkthrough automation) tap repeatedly and conclude the app is broken.

- [ ] Write failing tests: (1) pointerDown+pointerUp shorter than `durationMs` renders hint text `Keep holding…`; (2) hint disappears after ~1.5s (use fake timers); (3) completed hold still fires `onConfirm`.
- [ ] Implement: track a `showHint` state set when a press ends with `0 < progress < 1` (expose release-progress from the existing `useHoldToConfirm` usage — if the hook doesn't expose enough, read `lib/hooks/useHoldToConfirm.ts` and add a non-breaking `wasReleasedEarly` callback or compute from `progress > 0` at `onPressEnd` time in the component). Clear via a 1500ms timeout (constant `HINT_DURATION_MS = 1500`), cleaned up on unmount like the existing flourish timeout.
- [ ] Render: when `showHint && !isPressing && !isDispatching`, the button label area shows `Keep holding…` and a one-line helper `<p role="status">Press and hold to confirm</p>` appears below the button (inside the component root, so every consumer gets it for free).

### 1b. Label overflow

"SUBMIT (FLAG MISMATCH)" clips outside the 80px circle.

- [ ] Increase the circle to `h-24 w-24` and scale text: keep `text-xs` for labels ≤ 12 chars, use `text-[10px]` otherwise (compute from `label.length`, constant `LONG_LABEL_CHARS = 12`). Update the SVG ring: viewBox stays `0 0 60 60` (it scales), no math change needed.
- [ ] Test: render with a 22-char label and assert the `text-[10px]` class is applied.

### 1c. Tap-to-confirm accessibility mode

A sustained 2–3s press excludes some motor-impaired users.

- [ ] Create `lib/constants/preferences.ts`:

```ts
// Driver-local UI preferences persisted on-device only (localStorage).
// Not synced to the backend — these are accessibility/comfort settings.
export const PREF_TAP_TO_CONFIRM = 'fp:pref:tap-to-confirm'

export function getTapToConfirmPref(): boolean {
  if (typeof window === 'undefined') return false
  return window.localStorage.getItem(PREF_TAP_TO_CONFIRM) === 'true'
}

export function setTapToConfirmPref(enabled: boolean): void {
  window.localStorage.setItem(PREF_TAP_TO_CONFIRM, String(enabled))
}
```

- [ ] In HoldButton: read the pref once on mount (`useState(() => getTapToConfirmPref())`). When enabled, replace hold behavior with two-tap arm/confirm: first tap → armed state (label `Tap again to confirm`, ring fully drawn, auto-disarm after 3000ms constant `ARM_TIMEOUT_MS`), second tap while armed → existing `handleConfirm()` flourish path. Keep pointer handlers but branch on the mode.
- [ ] In `app/(app)/settings/page.tsx`: add a "Accessibility" `Card` with a labeled toggle (a `<button role="switch" aria-checked=…>` styled like the app's chips is fine — there is no Switch component; don't build a new generic one) that reads/writes the pref. Note under it: "Applies the next time a confirm button appears."
- [ ] Tests: two-tap mode fires `onConfirm` on second tap; auto-disarm after 3s (fake timers) requires re-arming.

### 1d. Real support contact keys

- [ ] `lib/constants/app.ts`: source from env with the existing obviously-fake strings as fallbacks:

```ts
export const SUPPORT_PHONE = process.env.NEXT_PUBLIC_SUPPORT_PHONE ?? '+27 00 000 0000'
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? 'support@TODO-REPLACE.example'
```

Keep the existing "deliberately fake" comment, adjusted to say the real values come from env.
- [ ] Add empty `NEXT_PUBLIC_SUPPORT_PHONE=` / `NEXT_PUBLIC_SUPPORT_EMAIL=` lines to `frontend/driver-pwa/.env.example`.

---

## Task 2: Seal-verify null-reference state, raw GPS coords, photo framing

**Files:**
- Modify: `frontend/driver-pwa/components/handshake/steps/H4SealVerify.tsx`
- Modify: `frontend/driver-pwa/components/handshake/steps/H4ApproachDest.tsx` (and any other step rendering raw coords — `grep -rn "toFixed(5)" components/handshake/`)
- Modify: `frontend/driver-pwa/components/handshake/CameraCapture.tsx`
- Test: extend `frontend/driver-pwa/components/handshake/steps/__tests__/` for H4SealVerify; add/extend CameraCapture test.

### 2a. Null reference seal must not auto-flag the driver

Today `h2SealNumber = null` renders "Unknown" and every input shows the red "Mismatch — this discrepancy will be recorded" banner. The driver gets flagged for a data gap that isn't theirs.

- [ ] Failing tests: with `h2SealNumber: null` and input `"ABC123"` → (1) no mismatch banner, (2) an info-styled note "No seal is on record from loading. The number you enter will be recorded." (3) `onUpdate` called with `sealVerifiedMatch: null` (not `false`), (4) hold button label is `Hold to submit`. With `h2SealNumber: 'S1'` the existing match/mismatch behavior is unchanged.
- [ ] Implement a three-way state: `matches: boolean | null` — `null` when `h2SealNumber === null`. Reference card copy: label "Seal set at loading" (drop the "(H2)" jargon); value shows the seal or "No seal on record" in `text-surface-on-variant` (not bold mono "Unknown").
- [ ] HoldButton labels (all ≤ 16 chars to fit Task 1b sizing): match → `Hold to submit`; mismatch → `Hold to flag`; null-reference → `Hold to submit`. Variant: `danger` only for a true mismatch. Keep the existing mismatch banner for a real mismatch.

### 2b. Raw GPS coordinates

- [ ] Remove the `{draft.gpsLat?.toFixed(5)}, {draft.gpsLng?.toFixed(5)}` line from H4ApproachDest (and any sibling step found by the grep). `GpsCapture` already renders "Location captured" — that's the whole receipt a driver needs. Coordinates stay in the evidence draft untouched.
- [ ] Update/extend the step's test to assert coords are not rendered as text.

### 2c. Photo preview framing

The captured image renders unframed at natural height, so it visually merges with the page, and the Retake chip hugs the corner.

- [ ] In CameraCapture's captured branch: give the wrapper `aspect-video w-full rounded-xl overflow-hidden border border-outline-variant/40 bg-surface-container-low`; the `<img>` becomes `h-full w-full object-cover`. Keep `max-h-48` off (aspect ratio governs). Move Retake to `bottom-2 right-2` with `shadow-ambient-sm` so it reads as a control on top of a photo.
- [ ] Test: captured branch renders an `img` with `object-cover` class inside an `aspect-video` container.

---

## Task 3: Trips list — cards with route/date, tab wrap, collapsible past filters

**Files:**
- Modify: `frontend/driver-pwa/app/(app)/trips/page.tsx`
- Modify: `frontend/driver-pwa/components/ui/Tabs.tsx`
- Create: `frontend/driver-pwa/lib/utils/precinct-name.ts`
- Test: `frontend/driver-pwa/lib/utils/__tests__/precinct-name.test.ts`, extend any existing trips-page test.

### 3a. Precinct name helper (read-only use of shared mocks)

```ts
// frontend/driver-pwa/lib/utils/precinct-name.ts
import { mockPrecincts } from '@shared/lib/mocks/precincts'

// Resolve a precinct id to its short display name for trip cards.
// Mock-backed until GET /driver/trips nests precinct names (backend Iter 2);
// falls back to the raw id's first 8 chars so an unknown id is still visibly unique.
export function precinctName(precinctId: string): string {
  const p = mockPrecincts.find((x) => String(x.id) === precinctId)
  return p?.name ?? precinctId.slice(0, 8)
}
```

(Adjust to the actual export name/shape in `frontend/shared/lib/mocks/precincts.ts` — read it first. Do NOT edit the shared file.)

- [ ] Tests: known id → name; unknown id → 8-char fallback.

### 3b. TripCard route + date line

- [ ] Extend the local `TripCard` in `trips/page.tsx`: under the reference/order lines add a route line `{precinctName(trip.origin_precinct_id)} → {precinctName(trip.destination_precinct_id)}` (`text-sm font-medium`) and a date line from `planned_departure_at` formatted `en-ZA` (e.g. "Wed 2 Jul, 06:00" via `Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })`); when null render "Departure not scheduled". `Trip` already carries these fields — no type changes.

### 3c. Tab wrap ("UPCOMING (1)" wraps to two lines)

- [ ] In `Tabs.tsx`: add `whitespace-nowrap` and drop horizontal padding to `px-2`; add optional `count?: number` to the `Tab` interface rendered as a small `tabular-nums` badge span (`text-[10px] rounded-full bg-surface-container px-1.5 py-0.5`) instead of being baked into the label string.
- [ ] In `trips/page.tsx`: pass `label: 'Active', count: active.length` etc.
- [ ] Test: labels render without parentheses; counts render in badges.

### 3d. Collapsible past filters

- [ ] Wrap the three filter inputs in a collapsed-by-default section behind a `Filter` ghost `Button` (`iconLeft={<SlidersHorizontal …/>}`) with count-of-active-filters badge when any of dateFrom/dateTo/search is set. Keep the existing clear-on-tab-switch behavior.

---

## Task 4: Visual hierarchy — secondary buttons, stepper overflow, H-number jargon

**Files:**
- Modify: `frontend/driver-pwa/components/ui/Button.tsx`
- Modify: `frontend/driver-pwa/components/trip/HandshakeProgressBar.tsx`
- Modify: `frontend/driver-pwa/components/trip/CurrentHandshakeCard.tsx` (only if it renders "H4"/"H5" text or the In-Transit Hub button styling — read first)
- Test: extend `frontend/driver-pwa/components/trip/__tests__/`.

### 4a. Secondary buttons read as disabled

`secondary` is gray-on-gray, nearly identical to the disabled state. "In-Transit Hub", "Log Checkpoint", "Log Exception", "Capture GPS Location" all use it.

- [ ] Change the `secondary` variant to a bordered tonal style clearly distinct from `disabled:opacity-40`:

```ts
secondary: 'bg-surface-container-lowest text-surface-on border border-outline-variant/60 shadow-ambient-sm hover:bg-surface-container-low',
```

- [ ] Snapshot-free test: render `<Button variant="secondary">` and assert the border class; render disabled and assert `opacity-40` still applies.

### 4b. Stepper clips the 5th step off-screen

- [ ] In `HandshakeProgressBar.tsx` (read it first): make the five steps fit the viewport — `grid grid-cols-5` (or `flex` with `flex-1 min-w-0` per step), circle size down to `h-9 w-9`, labels `text-[10px] leading-tight text-center break-words`. No horizontal scrolling.
- [ ] Replace visible `H4`/`H5` chip text inside circles with the plain step number (`4`, `5`) — drivers don't speak handshake codes. Keep the checkmark for completed steps.
- [ ] Test: renders all five step names; no element carries the text `H4` or `H5`.

---

## Task 5: Evidence receipts — completion toast, exception feedback + local list update, expandable notes, exception back-link

**Files:**
- Modify: `frontend/driver-pwa/app/(app)/trip/handshake/[h]/step/[slug]/HandshakeStepPageClient.tsx`
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx`
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/exception/` client component
- Possibly modify: `frontend/driver-pwa/lib/context/TripContext.tsx` (only if the exceptions list lives there)
- Test: extend the existing `__tests__` for these clients.

Read all four files before changing anything — this task depends on how submission and the exceptions list actually flow.

### 5a. Handshake completion receipt

- [ ] When the final step of a handshake completes (the navigation-back-to-trip branch), fire `useToast().notify({ kind: 'success', title: '<Handshake name> recorded', body: 'Saved <HH:MM> — evidence stored on this device.' })` before/with the redirect. Time from `new Date()` formatted `en-ZA` `HH:mm`. Do NOT claim blockchain/server sync — demo mode stores locally.
- [ ] Test: completing the last step calls notify with kind success (mock the toast hook).

### 5b. Exception submit receipt + visible in list

- [ ] On exception submit: success toast (`'Exception recorded'` / body naming the chosen category), then navigate back to the hub as today.
- [ ] The hub's exceptions list must include the just-submitted exception. In demo mode the list is mock-fed; add local state so submissions during the session appear (e.g. TripContext keeps `sessionExceptions: TripException[]` appended on submit, and the hub renders `[...mock, ...session]`). Follow whatever pattern the files already use — the acceptance test is: submit an exception, land on the hub, see it listed and the open-exceptions count incremented.
- [ ] Test: after submit handler runs, the new exception is in the rendered list / context value.

### 5c. Expandable exception & dispatcher-note cards

- [ ] Hub cards currently truncate ("…") with no way to read the rest. Make each card a `<button>` toggling a `line-clamp-2` ↔ unclamped state with `aria-expanded`. 
- [ ] Test: tapping a card removes the clamp class.

### 5d. Back-link consistency (this file set only)

- [ ] Exception page's centered `← Back` becomes left-aligned `← In-Transit Hub` matching the hub's own `← Trip detail` pattern (same classes/placement).

---

## Task 6: Shell & navigation — drawer inert, offline banner, SOS in step header, checkpoint padding + back-link, logout confirm

**Files:**
- Modify: `frontend/driver-pwa/components/ui/Drawer.tsx`
- Modify: `frontend/driver-pwa/components/layout/AppShell.tsx`
- Create: `frontend/driver-pwa/components/layout/OfflineBanner.tsx`
- Modify: `frontend/driver-pwa/components/handshake/StepHeader.tsx`
- Modify: `frontend/driver-pwa/components/layout/ProfilePanel.tsx`
- Modify: `frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/` client component
- Test: new `OfflineBanner` test; extend Drawer/ProfilePanel/StepHeader tests.

### 6a. Closed drawers pollute the accessibility tree

Both drawers stay mounted, translated off-canvas — screen readers and find-in-page hit "Driver Profile … LOG OUT" on every screen.

- [ ] In `Drawer.tsx`: on the panel div add `aria-hidden={!open}` and `inert={!open ? true : undefined}` (React 19 supports the `inert` boolean prop natively). Keep children mounted (the memo comment in ProfilePanel depends on it).
- [ ] Test: closed drawer root has `aria-hidden="true"` and `inert`; open drawer has neither.

### 6b. Offline banner

```tsx
// frontend/driver-pwa/components/layout/OfflineBanner.tsx
'use client'

import { useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'

// navigator.onLine via useSyncExternalStore: SSR-safe (server snapshot = online)
// and updates on the browser's online/offline events without manual listeners in effects.
function subscribe(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function OfflineBanner() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
  if (online) return null
  return (
    <div role="status" className="flex items-center gap-2 bg-tertiary-container px-4 py-2 text-xs font-medium text-tertiary-on-container">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      You’re offline — evidence you capture is saved on this device.
    </div>
  )
}
```

- [ ] Mount it at the top of `AppShell.tsx` (below the header). Test with a mocked `navigator.onLine`.

### 6c. Panic reachable from handshake steps

- [ ] In `StepHeader.tsx`: add a right-aligned icon button after the step counter — `ShieldAlert` icon, `text-error`, `aria-label="Emergency — open panic alert"`, `router.push(ROUTES.panic)`. Min touch target 44px. Also give the existing bare `←` button `aria-label="Back to trip"`.
- [ ] Test: header renders the panic button; clicking pushes `ROUTES.panic`.

### 6d. Checkpoint page

- [ ] Left-aligned `← In-Transit Hub` back link (same pattern as Task 5d — coordinate copy: identical classes).
- [ ] Add bottom padding (`pb-8` on the scroll container or equivalent) so the HoldButton never floats over the note textarea at small viewport heights.

### 6e. Logout confirmation

- [ ] In `ProfilePanel.tsx`: `Log out` opens the existing `Modal` (`components/ui/Modal.tsx` — read for its API) asking "Log out? You'll need a new OTP to sign back in." with Cancel / Log out (danger). Only confirm runs `signOut()`.
- [ ] Test: tapping Log out renders the modal; confirming calls `signOut`.

---

## Task 7: OTP resend & escape hatch, demo session persistence

**Files:**
- Modify: `frontend/driver-pwa/app/otp/page.tsx`
- Modify: `frontend/driver-pwa/lib/context/AuthContext.tsx`
- Test: extend `frontend/driver-pwa/lib/context/__tests__/AuthContext.test.tsx`; add OTP page test.

### 7a. OTP page

- [ ] Add under the Verify button: (1) `Resend code` ghost button — calls `auth.requestOtp(phone)`, disabled for 30s after each send with a visible countdown (`Resend in 24s`), constant `RESEND_COOLDOWN_S = 30`; (2) `Wrong number? Go back` link → `router.push(ROUTES.login)`.
- [ ] Auto-submit when the 6th digit lands: in the input onChange, when the cleaned value reaches length 6 and not already loading, trigger the same verify handler. Guard against double-fire with the existing `loading` state.
- [ ] Tests (fake timers): resend disabled immediately after tap, enabled after 30s; typing 6 digits calls `signIn` without pressing Verify.

### 7b. Demo session survives refresh

Demo auth is in-memory — any reload mid-demo dumps to /login.

- [ ] In `AuthContext.tsx`, demo branch only (`IS_DEMO_MODE`): on `signIn` → `sessionStorage.setItem(DEMO_SESSION_KEY, 'true')`; on mount → if flag present, hydrate `MOCK_DRIVER` (and set `isLoading` correctly); on `signOut` → remove it. `DEMO_SESSION_KEY = 'fp:demo-session'` as a module constant. Real-mode paths untouched. sessionStorage (not localStorage) so closing the tab still ends the demo.
- [ ] Tests: demo signIn sets the flag; a fresh provider mount with the flag set exposes a user without signIn; signOut clears it.

---

## Explicitly out of scope (decided, not forgotten)

- **Full offline evidence sync queue** — backend-dependent; the banner (6b) is the honest slice for now.
- **`/dev/tokens` prod exclusion** — already guarded by `notFound()` outside development.
- **Uppercase button styling** — deliberate design language; not churning it.
- **`frontend/shared/*` edits** (e.g. richer mock trips) — shared with dispatcher; trip cards use fields that already exist.
- **H1–H3/H5 step flows** — unreachable in demo state; they inherit fixes via shared components (HoldButton, CameraCapture, GpsCapture, StepHeader).

## Final verification (lead runs after all tasks merge into the working tree)

- [ ] `cd frontend/driver-pwa && npm test` — all green
- [ ] `npm run type-check` — clean
- [ ] `npm run lint` — clean
- [ ] Re-run the browser walkthrough (Playwright scripts in the session scratchpad) against `NEXT_PUBLIC_DEMO_MODE=true npm run dev`: verify seal-verify null state, hold hint on tap, completion toast, exception in hub list, tab labels on one line, stepper shows 5 steps, offline banner with devtools offline, panic button in step header, OTP resend visible, refresh keeps demo session.

Suggested commits (one logical change each, run by the human):
- `fix(driver-pwa): hold-button hint, overflow, tap-to-confirm mode`
- `fix(driver-pwa): seal-verify null reference, photo framing, gps copy`
- `feat(driver-pwa): trip cards with route/date, tab badges, filter collapse`
- `fix(driver-pwa): secondary button hierarchy, stepper fit, drop H-jargon`
- `feat(driver-pwa): evidence receipts and expandable exception cards`
- `feat(driver-pwa): offline banner, step SOS, drawer inert, logout confirm`
- `feat(driver-pwa): otp resend + demo session persistence`
