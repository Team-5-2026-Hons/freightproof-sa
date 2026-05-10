# FreightProof SA — Frontend Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared foundation both frontend surfaces depend on — token map, lint rules, type system, fixture data, context/hooks, constants, and UI primitives — so Phase 1 page work can begin on both surfaces in parallel.

**Architecture:** Two independent Next.js 15 surfaces, no shared code between them. `dispatcher/` (port 3000) uses Server Components where possible. `driver-pwa/` (port 3001) uses `output: 'export'` for Capacitor static bundling — every `page.tsx` must be `"use client"`. Both surfaces use Tailwind v3.4 with identical design-system token maps and identical `lib/types/` + `lib/mocks/` layers.

**Key references before starting:**
- `frontend/DESIGN_SYSTEM.md` — token values, component specs, spacing, shadows, typography
- `docs/FreightProof_Frontend_Spec_v1.md` — types, mock shapes, context interfaces, component props, page catalogue
- `docs/FreightProof_Full_Picture_v6.md` — domain concepts (handshakes, exceptions, trip lifecycle)

**Tech stack:** Next.js 15 App Router, React 19, TypeScript 5.5 (strict, no `any`), Tailwind v3.4, `lucide-react`, `recharts` (dispatcher only), `@serwist/next` + Capacitor 6 + `@capacitor/camera` + `@capacitor/geolocation` + `@capacitor/push-notifications` (driver-pwa only).

---

## Task 1: Pre-flight — fix stale docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/FreightProof_Frontend_Spec_v1.md`

- [ ] In `CLAUDE.md` Architecture section, update the `driver-pwa/` description from `(Next.js + next-pwa)` → `(Next.js + Capacitor + @serwist/next)`.
- [ ] In `CLAUDE.md` Standards section, add a note that the `"use client"` at-lowest-level rule has a driver-pwa exception: all `page.tsx` files in driver-pwa must be `"use client"` due to `output: 'export'`.
- [ ] In `CLAUDE.md` Architecture section, add a note that `driver-pwa/next.config.ts` must set `output: 'export'` — no SSR, no server actions, no `next/headers` on any driver page.
- [ ] In `docs/FreightProof_Frontend_Spec_v1.md` §8.0 conventions, update the photo capture sentence to match §5.2: use `@capacitor/camera` (`Camera.getPhoto()`), falling back to `<input type="file" capture="environment">` in a desktop browser.
- [ ] Commit: `docs: align CLAUDE.md and spec §8.0 with Capacitor v1.1 changes`

If already done then skip.

---

## Task 2: Scaffold driver-pwa/ as a Next.js 15 app

`dispatcher/` already has a working scaffold. `driver-pwa/` has only a README — it needs everything.

**Files to create in `frontend/driver-pwa/`:**
- `package.json` — Next.js 15, React 19, Tailwind 3.4, TypeScript 5.5, lucide-react, @serwist/next, serwist, @capacitor/core, @capacitor/cli, @capacitor/android, @capacitor/camera, @capacitor/geolocation, @capacitor/push-notifications, @capacitor-community/background-geolocation. Scripts: `dev` (port 3001), `build`, `lint`, `type-check`.
- `tsconfig.json` — copy from `dispatcher/tsconfig.json`, add `"android"` to the exclude list.
- `postcss.config.js` — standard Tailwind postcss config.
- `next.config.ts` — must set `output: 'export'` and wrap with `withSerwist` from `@serwist/next` pointing to `swSrc: 'app/sw.ts'`.
- `capacitor.config.ts` — appId `za.ac.uct.freightproof.driver`, appName `FreightProof Driver`, webDir `out`.
- `app/layout.tsx` — minimal shell (fonts + providers, same structure as dispatcher but without DispatcherShell).
- `app/globals.css` — Tailwind directives.
- `app/sw.ts` — Serwist service worker entry point (standard `@serwist/next` worker boilerplate, precache + defaultCache runtime caching).
- `app/page.tsx` — placeholder `"use client"` page.
- `public/manifest.json` — PWA manifest: `display: standalone`, `theme_color: #000000`, `background_color: #000000`, icon entries for 192 and 512.
- `public/icons/icon-192.png` and `icon-512.png` — placeholder black squares for now (can be replaced before demo).

- [ ] Create all files above. Run `npm install` inside `frontend/driver-pwa/`.
- [ ] Run `npm run dev` (port 3001) and confirm Next.js starts without errors.
- [ ] Commit: `feat(driver-pwa): scaffold Next.js 15 app with Capacitor and serwist`

---

## Task 3: Configure both surfaces — tokens, lint, fonts, globals

Do this in `dispatcher/` first, then repeat identically in `driver-pwa/` except where noted.

**Files:**
- Modify: `dispatcher/tailwind.config.ts` and `driver-pwa/tailwind.config.ts`
- Create: `dispatcher/.eslintrc.json` and `driver-pwa/.eslintrc.json`
- Modify: `dispatcher/app/layout.tsx` and `driver-pwa/app/layout.tsx`
- Modify: `dispatcher/app/globals.css` and `driver-pwa/app/globals.css`

- [ ] **Tailwind token map.** In both `tailwind.config.ts` files, extend `theme.extend` with the complete colour map from `DESIGN_SYSTEM.md §2.3` (verbatim), plus `fontFamily: { sans: ['var(--font-space-grotesk)', ...], mono: ['var(--font-ibm-plex-mono)', ...] }`, plus hard shadow utilities (`shadow-hard-sm: 2px 2px 0px #000`, `shadow-hard: 4px 4px 0px #000`, `shadow-hard-lg: 6px 6px 0px #000`, `shadow-hard-up: 0 -4px 0px #000`).

- [ ] **ESLint hex rule.** Create `.eslintrc.json` in both surfaces with the `no-restricted-syntax` rule from `spec §4.2` that rejects bare hex literals in component code, with overrides for `lib/tokens.ts` and `tailwind.config.ts`.

- [ ] **Fonts.** In both `app/layout.tsx` files, load `Space_Grotesk` (weights 400/500/600/700) and `IBM_Plex_Mono` (weights 400/500/600) via `next/font/google`. Apply both font variables to `<html>`. Set `<body>` class to `font-sans bg-surface text-surface-on`.

- [ ] **globals.css.** In both files, add: (a) `prefers-reduced-motion` rule from `DESIGN_SYSTEM.md §13.3` that collapses all animation/transition durations to `0.01ms`; (b) `:focus-visible` rule: `2px solid secondary colour, offset 2px, radius 4px`.

- [ ] Run `npm run lint` in both surfaces. Fix any errors.
- [ ] Run `npm run type-check` in both surfaces. Fix any errors.
- [ ] Commit: `feat(dispatcher,driver-pwa): add design-system token map, ESLint hex rule, fonts, globals`

---

## Task 4: lib/types/ — both surfaces

All 11 files are **identical** in both surfaces. Write them once, copy to the other.

**Files to create (in both `dispatcher/lib/types/` and `driver-pwa/lib/types/`):**
`trip.ts`, `handshake.ts`, `driver.ts`, `vehicle.ts`, `manifest.ts`, `seal.ts`, `exception.ts`, `checkpoint.ts`, `evidence.ts`, `precinct.ts`, `user.ts`

**Rules (from spec §3.1 — read it before writing):**
- Every type has a one-line comment naming its domain concept from the Full Picture doc.
- IDs are branded strings: `type TripId = string & { readonly __brand: 'TripId' }`.
- Timestamps are `string` (ISO 8601), never `Date`.
- Enums are string unions, not TS `enum`.
- `TripStatus` must match the backend enum exactly: `'created' | 'origin_gate_in' | 'loading' | 'origin_gate_out' | 'in_transit' | 'dest_gate_in' | 'unloading' | 'closed' | 'cancelled' | 'exception_hold'` (10 values — see `backend/app/db/models/enums.py`).
- `HandshakeNumber` is `0 | 1 | 2 | 3 | 4 | 5`.
- `AuthState` (in `user.ts`) includes `signIn` and `signOut` methods as defined in spec §3.3.
- Type files may import from each other (e.g. `trip.ts` imports `DriverId` from `driver.ts`).

- [ ] Write all 11 type files in `dispatcher/lib/types/`.
- [ ] Copy them verbatim to `driver-pwa/lib/types/`.
- [ ] Run `npm run type-check` in both surfaces. Fix any errors.
- [ ] Commit: `feat(dispatcher,driver-pwa): add all 11 domain type files`

---

## Task 5: lib/mocks/ — both surfaces

All fixture files are **identical** in both surfaces. Write once, copy.

**Files to create (in both `dispatcher/lib/mocks/` and `driver-pwa/lib/mocks/`):**
`trips.ts`, `drivers.ts`, `vehicles.ts`, `manifests.ts`, `exceptions.ts`, `checkpoints.ts`, `precincts.ts`, `principals.ts`, `index.ts`

**Rules (from spec §3.2 — read it):**
- Every export has an explicit type from `lib/types/`. No `as const` shortcuts.
- IDs are UUID-format strings. No sequential numbers like `'trip-1'`.
- Timestamps are recent (within last 7 days of 2026-05-09) and plausible.
- Names are South African: Linbro Park, N3 corridor, Tugela Plaza, Mooi River, Harrismith.
- **6 trips:** 1 `created`, 1 `origin_gate_in`, 2 `in_transit`, 1 `dest_gate_in`, 1 `closed`.
- **4 drivers:** One must be `S. Dlamini` (the canonical driver from Full Picture §6.4). Others can use dev-inspired names.
- **3 horses, 5 trailers.**
- **4 precincts:** FedEx JHB (Linbro Park), FedEx DBN, Courier Guy CT, and one more.
- **2 principals:** FedEx, Courier Guy.
- **3 manifests:** One per active in-transit trip.
- **8 exceptions** across the 6 trips, mixed types covering several of the 12 types from Full Picture §5.1.
- **12 checkpoints** across the in-transit trips.
- The trip `TRP-2026-0041` (JHB→DBN, driver S. Dlamini) **must exist verbatim** — this is the canonical demo trip used in all documentation.
- `index.ts` re-exports everything.

- [ ] Write all mock files in `dispatcher/lib/mocks/`.
- [ ] Copy verbatim to `driver-pwa/lib/mocks/`.
- [ ] Run `npm run type-check` in both. Fix any errors.
- [ ] Commit: `feat(dispatcher,driver-pwa): add typed fixture data`

---

## Task 6: lib/context/ + lib/hooks/ — both surfaces

**Dispatcher creates:** `AuthContext.tsx`, `ToastContext.tsx`
**Driver-pwa creates:** `AuthContext.tsx`, `TripContext.tsx`, `ToastContext.tsx`

**Dispatcher creates hooks:** `useAuth.ts`, `useToast.ts`, `useTrips.ts`, `useExceptions.ts`, `useStepIndicator.ts`
**Driver-pwa creates hooks:** `useAuth.ts`, `useTrip.ts`, `useToast.ts`, `useStepIndicator.ts`, `useExceptions.ts`, `useHoldToConfirm.ts`, `useLocation.ts`, `usePushNotifications.ts`

**Rules (from spec §3.3 and §6.5 — read both):**
- Context files export the context object AND the provider component. The context object is not exported for direct consumption by components — only hooks consume contexts.
- Every hook throws a descriptive error if used outside its provider.
- `AuthContext`: `signIn` resolves after 600 ms artificial delay. Dispatcher sets a hardcoded dispatcher user; driver sets the first driver from `lib/mocks/drivers.ts`.
- `TripContext` (driver only): `advance()` navigates to the next step URL using `useRouter` and `ROUTES`/`STEP_SLUGS` constants. `goBack()` navigates backwards. `logException` appends to local exceptions state. `triggerPanic` routes to the panic URL.
- `ToastContext`: auto-dismisses `info`/`success` toasts after 4 s; `error`/`sticky` toasts require manual dismiss. Max 3 toasts visible at once.
- `useHoldToConfirm(durationMs, onConfirm)`: uses `setInterval` at 16 ms to track hold duration and compute progress 0→1. Clears on release. Returns `{ isPressing, progress, onPressStart, onPressEnd }`.
- `useLocation`: on a native Capacitor device calls `@capacitor/geolocation`. In a desktop browser returns hardcoded Linbro Park coords after a 300 ms simulated delay. Never calls the web `navigator.geolocation` API directly.
- `usePushNotifications` (driver only): on native, registers with `@capacitor/push-notifications` and on `GATE_ARRIVAL` push navigates to the correct handshake step URL. Exposes `simulateGateArrival(handshake: 1 | 4)` for the dev tokens page.
- `useTrips(filter?)` and `useExceptions(filter?)` filter fixture data via `useMemo`.
- `useStepIndicator(handshake, step)` reads from `HANDSHAKE_NAMES`, `HANDSHAKE_STEP_COUNTS`, `STEP_NAMES` constants.
- Wire `AuthProvider` and `ToastProvider` into `app/layout.tsx` in both surfaces. Wire `TripProvider` into `app/(app)/layout.tsx` in driver-pwa (Phase 1 will create this file — leave a note).

- [ ] Write all context and hook files per surface.
- [ ] Run `npm run type-check` in both. Fix any errors.
- [ ] Commit: `feat(dispatcher,driver-pwa): add context providers and hooks`

---

## Task 7: lib/constants/ + lib/tokens.ts + lib/z-index.ts — both surfaces

**Files (in both surfaces unless noted):**
- `lib/constants/routes.ts` — `ROUTES` object with all route strings/functions. Dispatcher and driver-pwa have different routes (see spec §7 and §8 for full page lists). Dispatcher uses plain strings; driver uses functions like `handshakeStep(tripId, handshake, stepSlug)`.
- `lib/constants/handshake-meta.ts` — `HANDSHAKE_NAMES` (0–5), `HANDSHAKE_STEP_COUNTS` (0–5), `STEP_SLUGS` (handshake → step → URL slug), `STEP_NAMES` (handshake → step → display name). Values match spec §8 page slugs exactly.
- `lib/constants/status-meta.ts` — maps `TripStatus`, `HandshakeStatus`, `ExceptionSeverity`, `ExceptionType` to `{ kind: ChipKind, label: string, icon: string }` where `icon` is the Lucide icon name from `DESIGN_SYSTEM.md §9`.
- `lib/constants/copy.ts` — empty-state copy strings, error messages, action labels from `DESIGN_SYSTEM.md §10.8` and spec pages.
- `lib/tokens.ts` — all design token hex values as a typed `TOKENS` object. Used by recharts configs and SVG elements that cannot reference Tailwind classes. Values from `DESIGN_SYSTEM.md §2.2`.
- `lib/z-index.ts` — `Z` constant from `DESIGN_SYSTEM.md §8`: `{ base:0, raised:10, sticky:20, overlay:40, modal:60, toast:80, panic:100 }`.

- [ ] Write all constant/token/z-index files in both surfaces.
- [ ] Run `npm run type-check` in both. Fix any errors.
- [ ] Commit: `feat(dispatcher,driver-pwa): add constants, tokens, z-index`

---

## Task 8: components/ui/ — both surfaces

14 components for dispatcher; driver-pwa gets the same minus `DataTable` and `DateRangePicker` (desktop-only).

**All components live in `components/ui/` in each surface. No cross-surface imports.**

Read `DESIGN_SYSTEM.md §10` and `spec §5.1` for every component's visual spec before implementing. Key constraints:
- Use Tailwind token classes only — no raw hex (ESLint will fail if you do).
- `"use client"` only on components with internal state. Static components are server components.
- `Button`: variants `primary | secondary | ghost | danger`, sizes `sm | md | lg`. Driver-pwa default size is `lg` full-width. Loading state shows `Spinner`.
- `Chip`: always includes an icon alongside text. Never colour-only. Icon from `lucide-react`.
- `Card`: variants `default | exception | selected`. Hard 2px black border, no radius on outer container.
- `Input` / `TextArea`: label always visible above field. Validate on blur, not on keystroke. Driver-pwa: `min-h-[52px]`.
- `Modal`: traps focus while open, restores focus to trigger on close. Scrim `rgba(0,0,0,0.48)`.
- `Drawer`: `side: 'left' | 'right' | 'bottom'`. Bottom drawer used for panic confirmation.
- `Toast`: rendered by `ToastProvider`. Not used directly — consumers call `useToast().notify(...)`.
- `IconButton`: `aria-label` prop is required and enforced. Lint failure if missing would be ideal but the TypeScript required prop is enough.
- `Skeleton`: respects `prefers-reduced-motion` — when reduced-motion is active, show static block, no shimmer.
- `DataTable` (dispatcher only): renders a real `<table>` element, not a div grid. Supports `aria-sort`.
- `DateRangePicker` (dispatcher only): controlled with `value` + `onChange`. Presets optional.

- [ ] Implement all 14 (dispatcher) / 12 (driver-pwa) components.
- [ ] Run `npm run lint` and `npm run type-check` in both. Fix any errors.
- [ ] Commit: `feat(dispatcher,driver-pwa): add components/ui primitives`

---

## Task 9: /_dev/tokens pages — both surfaces

**Files:**
- Create: `dispatcher/app/_dev/tokens/page.tsx`
- Create: `driver-pwa/app/_dev/tokens/page.tsx`

- [ ] Both pages: gate with `if (process.env.NODE_ENV !== 'development') notFound()` at the top.
- [ ] Render every colour swatch from `TOKENS` (name + hex + coloured block), every type role (live text samples using the correct font/size), every shadow, every border radius. Use `DESIGN_SYSTEM.md §17 Quick Reference Card` as the checklist.
- [ ] Driver-pwa token page additionally: a "Simulate gate arrival H1" and "Simulate gate arrival H4" button that calls `usePushNotifications().simulateGateArrival(1|4)`. This is the v1 substitute for a real FCM push.
- [ ] Start both dev servers. Open `http://localhost:3000/_dev/tokens` and `http://localhost:3001/_dev/tokens`. Visually verify every colour matches `DESIGN_SYSTEM.md §2.2`. This is the Phase 0 sign-off gate — do not proceed to Phase 1 until this page looks correct.
- [ ] Commit: `feat(dispatcher,driver-pwa): add dev token preview pages`

---

## Task 10: Capacitor android scaffold (driver-pwa only)

- [ ] Inside `frontend/driver-pwa/`, run `npm run build` and confirm the static export produces `out/`.
- [ ] Run `npx cap add android`. This creates the `android/` directory.
- [ ] Run `npx cap sync android`. Confirm it copies `out/` into the Android project without errors.
- [ ] Verify `android/` is committed to git (it should be — it's the native project teammates open in Android Studio).
- [ ] Commit: `feat(driver-pwa): add Capacitor Android project`

---

## Phase 0 done — verification checklist

Before handing off to Phase 1, confirm all of the following:

- [ ] `npm run type-check` passes in both surfaces with zero errors
- [ ] `npm run lint` passes in both surfaces with zero errors (especially no raw hex)
- [ ] Both dev servers start and the homepage renders without a console error
- [ ] `/_dev/tokens` page renders correctly in both surfaces — colours match the design system
- [ ] `npx cap sync android` runs clean inside `driver-pwa/`

---

## Phase 1 — what comes next (reference, not tasks)

**Dispatcher (one dev):** `DispatcherShell` + `Sidebar` layout components → Login page → Active Trips page (the default `/`) → Trip Detail → Trip Creation. Then in order: Trip History, Exceptions list + detail, SLA Reports, Settings, 404/error pages. Domain components (`HandshakeChain`, `EvidencePacket`, `TripIdStamp`, `BlockchainReceipt`, `ExceptionBanner`, `TimestampWithIcon`, `ChecklistRow`, `SLAChartCard`) live in `components/domain/` and are built alongside the pages that first need them.

**Driver PWA (one dev, in parallel):** `DriverShell` + `OfflineBanner` + `BottomBar` + `PanicButton` layout → Login → Driver Home → Handshake 1 (3 pages) → Handshake 2 (5 pages) → Handshake 3 (3 pages). Domain components (`StepHeader`, `PhotoCapture`, `LocationCapture`, `SealNumberInput`, `SealStatusBadge`, `PanicButton`, `HandshakeChain`, `EvidencePacket`, `ExceptionBanner`, `TimestampWithIcon`) built alongside the pages that first need them.

**Important driver-pwa constraint:** Every `page.tsx` needs `generateStaticParams` for dynamic segments (`[id]`, `[h]`, `[n]-[slug]`) to satisfy `output: 'export'`. Return the fixture trip IDs / handshake numbers / step slugs from `lib/mocks` and `lib/constants/handshake-meta.ts`.

---

## Phase 2 — driver continued (reference)

In-transit hub + 5 utility pages (checkpoint, upload, exception picker, panic, panic submitted). Handshake 4 (3 pages). Handshake 5 (6 pages). Driver Settings, 404/error.

---

## Phase 3 — polish (reference)

Loading `Skeleton` states on every list and detail page. `EmptyState` on every zero-data view. Accessibility audit with axe-core in dev on every page. Reduced-motion verification on every animated component. Lighthouse PWA audit on driver-pwa targeting 90+ Performance, 100 Accessibility.
