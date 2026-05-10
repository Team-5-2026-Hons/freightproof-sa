# FreightProof SA — Frontend Spec v1

**The page-by-page build manual for the Dispatcher Portal and Driver PWA.**

UCT INF4027W Honours Project · 2026 · Ciaran Formby, Tim Gultig, Chiko Kasongo, Tom Davis

This document is the single source of truth for the FreightProof frontend. It is paired with two sibling documents and inherits everything in them — read both before using this one:

- [`docs/FreightProof_Full_Picture_v6.md`](FreightProof_Full_Picture_v6.md) — what the system does, who uses it, the five handshakes, exceptions, integrations
- [`frontend/DESIGN_SYSTEM.md`](../frontend/DESIGN_SYSTEM.md) — colour tokens, typography, spacing, components, motion, accessibility

This spec covers **only** the Dispatcher Portal and the Driver PWA. The guard page and client portal are out of scope for v1 and will get their own spec.

---

## How to use this document

This doc has two audiences:

1. **Wireframe tooling (Claude Design / Figma).** Sections 7–8 enumerate every page with its layout, components, states, and step indicator. Feed this doc + `FreightProof_Full_Picture_v6.md` to the wireframe tool.

2. **Implementation (Claude Code).** Sections 1–6 define the foundation every page must be built on: file layout, shared component library, mock data, state, code reusability rules. **Build sections 1–6 first, then build pages.** A page that doesn't reuse the shared components is a bug.

There is **no backend**. Every page in this spec is UI/UX only. State is local + React Context; data is typed TS fixtures. The transition path to a real API is described in §3.4 — types and interfaces are designed so the swap is mechanical.

---

## 1. Stack and ground rules

The stack is **not negotiable** and is fixed by [`CLAUDE.md`](../CLAUDE.md) and [`README.md`](../README.md):

| Concern | Choice |
|---|---|
| Framework | Next.js 15 App Router (no Pages Router, no `getServerSideProps`/`getStaticProps`) |
| Language | TypeScript 5.5+, **no `any` anywhere** |
| Runtime | React 19. **Dispatcher:** Server Components default; `"use client"` only at lowest level needed. **Driver PWA:** all pages are `"use client"` — required by static export (see below). |
| Styling | Tailwind v3.4+ (`content`, not `purge`); design tokens via `tailwind.config.ts` |
| Driver PWA output | `output: 'export'` in `next.config.ts` — static HTML/JS/CSS so Capacitor can bundle it into the Android APK. No SSR, no server actions, no `next/headers` on any driver page. |
| Native shell | **Capacitor** — wraps the driver-pwa static build as an Android APK. Provides native plugins for camera, geolocation, push notifications, and background location. Replaces `next-pwa`; `@serwist/next` handles the browser PWA path (service worker + offline). |
| Native plugins | `@capacitor/camera` · `@capacitor/geolocation` · `@capacitor/push-notifications` · `@capacitor-community/background-geolocation` |
| Browser PWA | `@serwist/next` (Workbox-based; the maintained Next.js 15 successor to the abandoned `next-pwa`) |
| Icons | `lucide-react` (1.5px stroke, no other libraries) |
| Forms | Native `<form>` + controlled inputs. **No** form library on v1. |
| Charts | `recharts` (dispatcher only, SLA Reports page) |
| Lint | `eslint-config-next` + a custom rule blocking raw hex in component code |

**Ground rules — every page must hold to all of these:**

1. **Type every signature and prop.** No `any`. No `unknown` without narrowing.
2. **No raw hex colours in component code.** Reference Tailwind classes that come from the design-system token map. The token map lives in `tailwind.config.ts` and is the only place hex appears.
3. **Reusability is compulsory.** If a UI pattern appears on two pages, it belongs in `components/ui/` or `components/domain/`. See §6.
4. **One responsibility per file.** A `page.tsx` composes; it does not implement.
5. **Accessibility is non-negotiable.** Every interactive element has a visible focus ring; every icon-only button has `aria-label`; every chart has an `aria-label` summary; status is never colour-only.
6. **Comment the *why*, not the *what*.** Self-documenting names are the goal.
7. **No backend calls.** All data flows through `lib/mocks/*` and `lib/context/*`. Network fetches do not exist on v1.

---

## 2. Repository layout

Two surfaces, identical internal structure. The dispatcher already has a Next.js scaffold; the driver-pwa is greenfield.

```
frontend/
├── DESIGN_SYSTEM.md                 # source of truth for tokens
├── dispatcher/                      # port :3000
└── driver-pwa/                      # port :3001
```

### 2.1 Per-surface structure

Both `dispatcher/` and `driver-pwa/` use this layout. **Do not deviate.**

```
<surface>/
├── app/
│   ├── layout.tsx                   # fonts, providers, html shell
│   ├── globals.css                  # Tailwind directives, focus ring, reduced-motion
│   ├── not-found.tsx                # 404 page
│   ├── error.tsx                    # error boundary
│   ├── (public)/                    # route group: unauthenticated
│   │   └── login/page.tsx
│   └── (app)/                       # route group: authenticated
│       └── …                        # see §7 (dispatcher) and §8 (driver)
├── components/
│   ├── ui/                          # design-system primitives — see §5.1
│   ├── domain/                      # FreightProof concepts — see §5.2
│   └── layout/                      # shells, sidebars, headers — see §5.3
├── lib/
│   ├── mocks/                       # typed fixture data — see §3
│   ├── types/                       # shared TS interfaces — see §3.1
│   ├── context/                     # AuthContext, TripContext, ToastContext
│   ├── hooks/                       # useTrip, useHandshake, useStepIndicator, useToast
│   ├── constants/                   # route paths, step counts, copy strings
│   └── tokens.ts                    # design tokens as TS constants (for charts, SVG)
├── public/
│   ├── manifest.json                # PWA manifest: display standalone, theme #000000, icons
│   ├── icons/
│   │   ├── icon-192.png             # maskable, for Android home screen
│   │   └── icon-512.png             # maskable, for splash screen
│   └── …                            # other static assets
├── capacitor.config.ts              # driver-pwa only — app ID, server URL, plugin config
├── android/                         # driver-pwa only — generated by `npx cap add android`
│   └── …                            # Android Studio project; committed to git
├── tailwind.config.ts               # extends with §2.3 of DESIGN_SYSTEM.md verbatim
├── postcss.config.js
├── tsconfig.json                    # strict: true; no implicit any
└── package.json
```

**Driver-pwa-specific rules (in addition to the shared rules above):**

- `next.config.ts` must set `output: 'export'`. No dynamic routes without `generateStaticParams`. No `next/headers`, no server actions.
- Every `page.tsx` in `driver-pwa` is `"use client"`. The static export constraint means this is required, not a style choice.
- After `next build`, run `npx cap sync android` to push the updated web build into the Android project.
- The Android project (`android/`) is checked into git — teammates run `npx cap open android` then "Run" in Android Studio to get the APK on a device.

**Forbidden patterns:**

- Importing across surfaces. `dispatcher/` and `driver-pwa/` do not share code on v1. If a component appears in both, it is duplicated. (Phase 2 may extract a `frontend/shared` package — out of scope for v1.)
- Components defined inside `page.tsx` files. All components live in `components/`.
- Inline styles or arbitrary Tailwind values like `bg-[#FF4F00]`. Use the token map.

### 2.2 Naming conventions

- Components: `PascalCase.tsx` — `EvidencePacket.tsx`, `HandshakeChain.tsx`
- Hooks: `useCamelCase.ts` — `useTrip.ts`
- Mock fixtures: `kebab-or-flat.ts` — `trips.ts`, `manifests.ts`
- Route folders: `kebab-case` — `in-transit`, `1-acknowledge-gate`
- Constants files: `kebab-case` — `routes.ts`, `step-copy.ts`

---

## 3. Mock data and state architecture

Backend doesn't exist yet. Everything is fixtures + React Context. The shape decisions in this section are deliberate so the swap to a real API later is mechanical.

### 3.1 Type definitions

Domain types live in `lib/types/` and mirror the eventual Pydantic v2 schemas. Each model gets one file. Keep these in sync conceptually with `backend/app/db/models/` once it's stable, but for now define them in TS only.

**Required types (one per file in `lib/types/`):**

```
lib/types/
├── trip.ts            # Trip, TripStatus, TripSummary
├── handshake.ts       # HandshakeNumber (0|1|2|3|4|5), HandshakeStatus, HandshakeStep
├── driver.ts          # Driver, DriverIdentity
├── vehicle.ts         # Horse, Trailer
├── manifest.ts        # ParcelPerfectManifest, Parcel, DeliveryStop
├── seal.ts            # Seal, SealVerification
├── exception.ts       # Exception, ExceptionType, ExceptionSource
├── checkpoint.ts      # Checkpoint
├── evidence.ts        # EvidenceArtifact, BlockchainReceipt
├── precinct.ts        # Precinct, Principal
└── user.ts            # DispatcherUser, DriverUser, AuthState
```

**Type rules:**

- Every type has a docstring comment naming the corresponding domain concept from `FreightProof_Full_Picture_v6.md`.
- IDs are branded strings — `type TripId = string & { readonly __brand: 'TripId' }` — to prevent accidental mixing.
- Timestamps are ISO 8601 strings, never `Date`. Conversion happens at the display boundary only.
- Enums are string unions, not TS `enum`s.
- Status values match the backend enum verbatim. Trip status: `'created' | 'origin_gate_in' | 'loading' | 'origin_gate_out' | 'in_transit' | 'dest_gate_in' | 'unloading' | 'closed' | 'cancelled' | 'exception_hold'` (10 values — see `backend/app/db/models/enums.py` `TripStatus`).

### 3.2 Fixture data

Fixtures live in `lib/mocks/` and are **typed** — every export has an explicit return type from `lib/types/`. No `as const` shortcuts that bypass typing.

**Required fixture files:**

```
lib/mocks/
├── trips.ts           # 6 trips: 1 created, 1 origin_gate_in, 2 in_transit, 1 dest_gate_in, 1 closed
├── drivers.ts         # 4 drivers (matches the 4 dev names for fun)
├── vehicles.ts        # 3 horses, 5 trailers
├── manifests.ts       # 3 manifests (one per active trip)
├── exceptions.ts      # 8 exceptions across the 6 trips, mixed types
├── checkpoints.ts     # 12 checkpoints across in-transit trips
├── precincts.ts       # 4 precincts (FedEx JHB, FedEx DBN, Courier Guy CT, Linbro Park)
├── principals.ts      # 2 principals (FedEx, Courier Guy)
└── index.ts           # re-exports
```

**Fixture rules:**

- IDs use `uuid()`-style strings. **No** sequential numbers like `'trip-1'`.
- Timestamps are recent and plausible (within the last 7 days).
- Names are South African — use Bruce's domain (Linbro Park, N3 corridor, Tugela Plaza, Mooi River, Harrismith).
- Every fixture has at least one example of each non-trivial state (e.g. exceptions covers all 9 system-detected types from `Full Picture §5.1`).
- The example trip in `Full Picture §6.4` (TRP-2026-0041, JHB→DBN, Driver S. Dlamini) **must exist verbatim** in `trips.ts` so the demo matches the docs.

### 3.3 State (React Context only)

Three providers, set once each in `app/layout.tsx` of each surface.

#### `AuthContext` (both surfaces)

```ts
interface AuthState {
  user: DispatcherUser | DriverUser | null
  status: 'idle' | 'authenticating' | 'authenticated' | 'error'
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
}
```

`signIn` resolves after a 600 ms artificial delay regardless of input. On the dispatcher it sets a hard-coded dispatcher user; on the driver it sets the first driver in `lib/mocks/drivers.ts`. This is enough to demo the login flow without real auth.

#### `TripContext` (driver only)

```ts
interface TripState {
  trip: Trip | null
  currentHandshake: HandshakeNumber
  currentStep: number              // 1..N within the handshake
  totalSteps: number               // total steps for the current handshake
  exceptions: Exception[]
  advance: () => void              // moves step+1, or handshake+1 if at last step
  goBack: () => void               // step-1, or handshake-1 if at step 1
  logException: (type: ExceptionType, payload: Record<string, unknown>) => void
  triggerPanic: () => void
  reset: () => void                // for demo/dev use
}
```

#### `ToastContext` (both surfaces)

```ts
interface ToastState {
  toasts: Toast[]
  notify: (toast: { kind: 'info' | 'success' | 'warning' | 'error'; title: string; body?: string; sticky?: boolean }) => void
  dismiss: (id: string) => void
}
```

**Hard rule:** Components consume context only via the matching hook (`useAuth`, `useTrip`, `useToast`). Never `useContext(AuthContext)` directly outside the hook. This is the seam where mock state is swapped for real-API state.

### 3.4 Path to the real API

When the backend ships, replacing fixtures with HTTP fetches is mechanical:

1. Add `lib/api/<resource>.ts` modules with the same return types as the matching fixture exports.
2. Replace direct fixture imports inside hooks with calls to those API modules.
3. Pages and components don't change — they consume hooks, not data sources.

Pages that import from `lib/mocks/` directly are a code-review block.

---

## 4. Design-system enforcement

The design system in [`frontend/DESIGN_SYSTEM.md`](../frontend/DESIGN_SYSTEM.md) is the visual contract. This spec adds enforcement.

### 4.1 Token map

Both `tailwind.config.ts` files extend `theme.extend.colors` with the §2.3 token map from `DESIGN_SYSTEM.md`, **verbatim**. Spacing, font sizes, radii, and shadows are also extended.

### 4.2 Lint rule (compulsory)

Add this to both `.eslintrc.json` files:

```json
{
  "rules": {
    "no-restricted-syntax": [
      "error",
      {
        "selector": "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
        "message": "No raw hex in component code. Use the Tailwind token map (see DESIGN_SYSTEM.md §2.3)."
      }
    ]
  },
  "overrides": [
    { "files": ["lib/tokens.ts", "tailwind.config.ts"], "rules": { "no-restricted-syntax": "off" } }
  ]
}
```

CI must run `next lint` and fail on hits.

### 4.3 Living token page

Both surfaces include a development-only page at `/_dev/tokens` that renders every colour swatch, type role, spacing scale, radius, and shadow. The page is gated by `process.env.NODE_ENV === 'development'` — it does not ship to production. It is the visual proof that the token map matches the design system.

### 4.4 Fonts

`Space Grotesk` (primary) and `IBM Plex Mono` (mono) are loaded via `next/font/google` in `app/layout.tsx`. **Do not** use the `<link>` tag method shown in `DESIGN_SYSTEM.md §3.1` — `next/font` is the App Router pattern and gives automatic layout-shift-free loading.

### 4.5 Reduced motion and dark mode

- `prefers-reduced-motion` rules in `globals.css` per `DESIGN_SYSTEM.md §13.3` are compulsory.
- **No dark mode on v1.** The design system is a single light theme by design (it is brutalist; light/dark variants would dilute the aesthetic). Don't add a theme toggle.

---

## 5. Shared component library

Three folders, each with strict ownership. Every page in §7 and §8 cites the components it composes.

### 5.1 `components/ui/` — design-system primitives

Pure, presentational, framework-free of FreightProof concepts. These are the building blocks. Each is a `"use client"` component only if it has internal state; static ones are server components.

| Component | Props | Notes |
|---|---|---|
| `Button` | `variant: 'primary'\|'secondary'\|'ghost'\|'danger'`, `size?: 'sm'\|'md'\|'lg'`, `disabled?`, `loading?`, `iconLeft?`, `iconRight?`, all native `button` props | Driver PWA defaults to `size="lg"` and full-width per `DESIGN_SYSTEM.md §10.3`. |
| `Card` | `variant?: 'default'\|'exception'\|'selected'`, children | The Evidence Packet container. 2px black border, hard offset shadow on the `floating` variant only. |
| `Chip` | `kind: 'success'\|'warning'\|'error'\|'pending'\|'overridden'\|'info'`, `icon?`, children | Status badge. **Always** has an icon; never colour-only. |
| `Input` | `label`, `helperText?`, `error?`, `inputMode?`, all native `input` props | Label always visible above. Validates on blur. Driver-PWA default `min-h-[52px]`. |
| `TextArea` | `label`, `helperText?`, `error?`, native props | Same rules as `Input`. |
| `Modal` | `open`, `onClose`, `title`, children, `footer?` | Traps focus, scrim per `DESIGN_SYSTEM.md §10.10`, restores focus on close. |
| `Drawer` | `open`, `onClose`, `side: 'left'\|'right'\|'bottom'`, children | Bottom drawer is used for the panic confirmation. |
| `Toast` | rendered by `ToastProvider`; consumers call `useToast().notify(...)`. |
| `Spinner` | `size?: 'sm'\|'md'\|'lg'` | The only animation primitive. |
| `Skeleton` | `lines?`, `variant: 'text'\|'block'\|'card'` | For loading states; respects reduced-motion. |
| `EmptyState` | `icon`, `title`, `body`, `cta?` | Per `DESIGN_SYSTEM.md §10.8`. Used on every list. |
| `IconButton` | `aria-label` required, `icon`, native `button` props | Lint rule: `aria-label` cannot be missing. |
| `Tabs` | `tabs: { id, label, icon? }[]`, `active`, `onChange` | Used on dispatcher Trip Detail. |
| `DataTable` | `columns`, `rows`, `sort`, `onSort`, `empty?` | Dispatcher only. Renders `<table>` with sortable columns; never a div-grid. |
| `DateRangePicker` | `value`, `onChange`, `presets?` | Dispatcher only (SLA, History). |

### 5.2 `components/domain/` — FreightProof concepts

These are reused across pages and encode FreightProof-specific behaviour. Driver PWA and Dispatcher each have their own copy on v1.

| Component | Surfaces | Purpose |
|---|---|---|
| `HandshakeChain` | both | The 6-node progress indicator (Handshakes 0–5) per `DESIGN_SYSTEM.md §10.2`. Vertical on driver (full-screen step list), horizontal on dispatcher (top of trip detail). |
| `EvidencePacket` | both | A `Card` with the standardised header (status chip + ID stamp), title, evidence rows, footer actions. Used everywhere. |
| `TripIdStamp` | both | `mono-id` typeface, includes copy-to-clipboard on dispatcher hover. |
| `SealStatusBadge` | both | A `Chip` specialised for seal states (Intact, Broken, Verified, Mismatch). Always has the `Lock` or `ShieldAlert` icon. |
| `BlockchainReceipt` | dispatcher | Shows the SHA-256 hash, Hedera tx ID, and a "view on HashScan" deep link. Mono-hash typography. |
| `ExceptionBanner` | both | The critical alert from `DESIGN_SYSTEM.md §10.7`. `error-container` background, left accent, `ShieldAlert` icon, mandatory action button. |
| `TimestampWithIcon` | both | Replaces the original "secondary-coloured timestamp text" pattern (which fails contrast). Renders `on-surface` text + an orange-filled `Clock` icon pill alongside. See `DESIGN_SYSTEM.md §14.1`. |
| `StepHeader` | driver | The compulsory header on every handshake step page. Renders `Handshake X of 5 — <Name> · Step Y of Z: <Step Name>`. Step counter is computed from `useStepIndicator()`. |
| `PhotoCapture` | driver | The full-width camera tap-target per `DESIGN_SYSTEM.md §10.9`. Uses `@capacitor/camera` (`Camera.getPhoto()`), which gives the native Android camera UI on-device and falls back to `<input type="file" capture="environment">` in a desktop browser. Captures, shows a thumbnail, allows retake. |
| `LocationCapture` | driver | Invisible at step-load — fires `@capacitor/geolocation` (`Geolocation.getCurrentPosition()`) automatically when the page mounts. Shows a "GPS captured" status card (`MapPin` icon + coordinates + accuracy). No button required; the driver does not trigger it manually. On push-notification-triggered gate arrivals (H1, H4), the location is captured before the page renders. |
| `SealNumberInput` | driver | Specialised `Input` with `inputMode="numeric"`, format mask `XX-####`, validates length on blur. |
| `PanicButton` | driver | Always-visible, `z-panic`, requires 2-second hold to fire. Renders confirmation `Drawer` per `DESIGN_SYSTEM.md §11.2`. |
| `OfflineBanner` | driver | Renders at the top of `(app)` layout when `navigator.onLine === false`. Shows "Offline — actions queued, will submit on reconnect" per `DESIGN_SYSTEM.md §15.2`. |
| `ChecklistRow` | dispatcher | Trip-list row layout. Used on Active Trips and History. |
| `SLAChartCard` | dispatcher | A `Card` wrapping a `recharts` chart with required text summary and data-table toggle (`DESIGN_SYSTEM.md §12`). |

### 5.3 `components/layout/` — shells

| Component | Surfaces | Purpose |
|---|---|---|
| `DispatcherShell` | dispatcher | The full layout: 240 px sidebar at `lg+`, 64 px icon rail at `md`, top hamburger below `md`. Renders `Sidebar`, `MainContent`, `ToastViewport`. |
| `Sidebar` | dispatcher | Black background, signal-orange left accent on active item. Items: Active Trips, Trip History, Exceptions, SLA Reports, Settings. |
| `DriverShell` | driver | Full-bleed mobile layout with `OfflineBanner` (top), `StepHeader` (when in a handshake), main content, `BottomBar` (when in a trip), `PanicButton` (when in a trip). Uses `min-h-dvh` and `safe-area-inset-bottom`. |
| `BottomBar` | driver | 64 px + safe-area, three slots: current step, trip summary, panic. Hard 2 px top border, hard upward shadow. Per `DESIGN_SYSTEM.md §11.2`. |
| `PageHeader` | dispatcher | Page title + breadcrumb + page actions. |
| `PageShell` | dispatcher | Max-width `max-w-7xl` centred container. |

---

## 6. Code reusability — compulsory rules

This section is non-negotiable. Reusability is graded — the marker can read this section and grep the repo to verify.

### 6.1 The "two-uses" rule

**If a UI pattern appears on two pages, it lives in `components/`.** Not in a third page-local file. Not as a copy-paste. The component lives in `ui/`, `domain/`, or `layout/` depending on what it encodes.

Example: every dispatcher list page (Active Trips, Trip History, Exceptions) uses the same row layout. That row layout is `ChecklistRow` in `components/domain/`. Three pages compose it; none of them re-implement it.

### 6.2 The "three values" rule

**If a value appears in three places, it is a constant.** Strings, numbers, route paths, copy. They live in `lib/constants/`.

```
lib/constants/
├── routes.ts          # ROUTES.dispatcher.activeTrips, ROUTES.driver.handshake(h, s)
├── handshake-meta.ts  # HANDSHAKE_NAMES, HANDSHAKE_STEP_COUNTS, STEP_COPY
├── status-meta.ts     # status → chip kind, icon, label
└── copy.ts            # error messages, empty-state copy
```

Rationale: copy changes between v1 and demo; routes change as we refine; status meta is referenced from chips, badges, and the handshake chain. Centralising prevents drift.

### 6.3 The "one composer" rule

A `page.tsx` file:
- Imports components from `components/` and hooks from `lib/hooks/`.
- Composes them.
- Sets the page-level metadata.
- Does not implement components inline.
- Does not import from `lib/mocks/` directly — only via hooks.

A `page.tsx` over ~150 lines is almost certainly doing too much. Split it.

### 6.4 The "shared shell" rule

Every authenticated dispatcher page is wrapped by `DispatcherShell` in the `(app)/layout.tsx`. The page does not render its own sidebar, top bar, or toast viewport. Same on the driver — `DriverShell` wraps every authenticated driver route.

### 6.5 Hooks over duplication

Logic that more than one component needs is extracted into a hook in `lib/hooks/`. Required hooks:

- `useAuth()` — wraps `AuthContext`.
- `useTrip()` — wraps `TripContext` (driver only).
- `useToast()` — wraps `ToastContext`.
- `useStepIndicator(handshake)` — returns `{ current, total, name, stepName }` for the `StepHeader`.
- `useExceptions(tripId?)` — filtered access to fixture exceptions.
- `useTrips(filter?)` — paged/filtered access to fixture trips (dispatcher).
- `useHoldToConfirm(durationMs)` — for the panic button; returns `{ isPressing, progress, onPressStart, onPressEnd }`. Pure logic, unit-testable.
- `useLocation()` — wraps `@capacitor/geolocation`. Returns `{ coords, accuracy, status, capture }`. On a real device, calls `Geolocation.getCurrentPosition()`; in a desktop browser, returns a hardcoded Linbro Park coordinate for dev. Never calls the web `navigator.geolocation` API directly — always go through this hook so the Capacitor layer is swappable.
- `usePushNotifications()` — wraps `@capacitor/push-notifications`. Registers the FCM token on mount, listens for `pushNotificationReceived` events. On a `GATE_ARRIVAL` push from the backend, navigates the driver directly to the correct handshake step URL. On v1 (no backend), a dev helper button in `/_dev/tokens` simulates the push. Driver-pwa only.

### 6.6 Forbidden duplication patterns

- A component that wraps a single child and adds nothing — delete it.
- Two components with names like `<Foo>` and `<Foo2>` — one of them is a missed prop. Refactor.
- Duplicated icon-meta switch statements — they belong in `lib/constants/status-meta.ts`.
- Duplicated route strings as bare literals — use `ROUTES`.

---

## 7. Dispatcher Portal — page catalogue

Port :3000. Desktop-first, tablet-usable, never a mobile-first port. All pages are authenticated except `/login`.

### 7.0 Conventions

- Every page sets `<title>` via Next.js metadata.
- Every list page has a loading skeleton, an empty state, and a no-results-after-filter state.
- Every detail page has a back button and a breadcrumb.
- All money is ZAR; all timestamps are in SAST and shown as `15:42 · 4 May 2026`.

### 7.1 Login

| | |
|---|---|
| Route | `/login` |
| Layout group | `(public)` |
| User story | As a dispatcher, I want to sign in so that I can see and manage my company's active trips. |
| Purpose | Mock authentication entry point. |
| Components | `Card`, `Input`, `Button`, `Spinner` |
| Mock data | None — `useAuth().signIn` resolves on any input. |
| States | Idle · Authenticating (button shows `Spinner`) · Error (shake + helper text on field) |
| Notes | Email field has `inputMode="email"`. After 600 ms, navigate to `/`. |

### 7.2 Active Trips (default landing)

| | |
|---|---|
| Route | `/` (alias `/trips`) |
| Layout group | `(app)` — wraps in `DispatcherShell` |
| User story | As a dispatcher, I want to see all currently in-progress trips at a glance so that I can spot exceptions and check progress without opening each trip. |
| Purpose | The operational nerve centre. |
| Components | `PageHeader`, `DataTable` of `ChecklistRow`s, `Chip`, `HandshakeChain` (compact), `EmptyState`, `DateRangePicker` (filter), search input |
| Mock data | `useTrips({ status: ['created','origin_gate_in','loading','origin_gate_out','in_transit','dest_gate_in','unloading'] })` |
| Row anatomy | Status chip · `TripIdStamp` · Driver name · Route (origin → destination) · Compact `HandshakeChain` · Latest event timestamp · Open button |
| Filters | Status, driver, route, has-exceptions |
| Sort | Default: latest event timestamp desc |
| States | Loading · Empty (no trips today) · No-results-after-filter |
| Notes | Headline metric strip at top: "Active trips" (count), "Open exceptions" (count, links to `/exceptions`), "On-time today" (%). |

### 7.3 Trip Detail

| | |
|---|---|
| Route | `/trips/[id]` |
| User story | As a dispatcher, I want to drill into a single trip's complete evidence trail so that I can investigate exceptions and answer client questions. |
| Purpose | The full evidence record for one trip. |
| Components | `PageHeader` (with status chip + `TripIdStamp`), full-width `HandshakeChain` (horizontal), `Tabs`, `EvidencePacket` per event, `BlockchainReceipt`, `ExceptionBanner` |
| Tabs | **Timeline** (default — chronological list of events), **Manifest** (parcel list per stop), **Exceptions** (this trip only), **Blockchain** (anchored hashes + Hedera tx IDs) |
| Mock data | `useTrip(id)` — returns trip + handshake events + exceptions + manifest + receipts |
| States | Loading · Not found (404) · Trip closed (read-only banner) · Trip with active exception (banner above tabs) |
| Notes | No live map — show GPS as text per `DESIGN_SYSTEM.md §16 Don'ts`. Each evidence packet links to its blockchain receipt. |

### 7.4 Trip Creation

| | |
|---|---|
| Route | `/trips/new` |
| User story | As a dispatcher, I want to create a trip from an order in under a minute so that I can keep up with the volume of contractual jobs. |
| Purpose | Handshake 0 — capture the journey lock parameters. |
| Components | `PageShell`, `Card`, `Input` (order number), template toggle (`Chip` group), `Select` (driver, horse, trailers, precincts), `DatePicker` (slot times), summary card on the right, `Button` (submit) |
| Mock data | `useDrivers()`, `useVehicles()`, `usePrecincts()`, optional `useTemplates()` |
| Layout | Two-column desktop: form left, "Trip summary" preview card right showing the journey lock parameters as the dispatcher fills the form. |
| Template toggle | "Use template" (default ON for contractual feel). When ON, fields prefill from a chosen template; when OFF, form is blank. Single submit either way. |
| Validation | All fields required except slot times. Submit disabled until valid. |
| Submit behaviour | Mock POST: 600 ms delay, then `notify({ kind: 'success', title: 'Trip created · Journey lock anchored' })` and redirect to `/trips/[new-id]`. |
| States | Idle · Submitting · Submission error |

### 7.5 Trip History

| | |
|---|---|
| Route | `/history` |
| User story | As a dispatcher, I want to find a closed trip from any date so that I can resolve disputes or pull evidence months after delivery. |
| Purpose | Searchable archive of closed trips. |
| Components | Same `DataTable`/`ChecklistRow` as Active Trips, plus `DateRangePicker`, search input, multi-select filters |
| Mock data | `useTrips({ status: 'CLOSED' })` |
| Filters | Date range, driver, vehicle (horse or trailer), route, client, order number, exception type |
| States | Loading · Empty · No-results-after-filter |
| Notes | Tapping a row opens `/trips/[id]` (same Trip Detail page; banner indicates closed). |

### 7.6 Exceptions

| | |
|---|---|
| Route | `/exceptions` |
| User story | As a dispatcher, I want a single feed of all open exceptions across all trips so that I can triage and resolve them in priority order. |
| Purpose | Triage queue. |
| Components | `DataTable`, `Chip` (severity), `ExceptionBanner` summary at top |
| Row | Severity chip · type · trip ID · driver · timestamp · "View" button |
| Filters | Severity, type, source (system / driver / dispatcher), date range, status (open/resolved) |
| Mock data | `useExceptions({ resolved: false })` |
| States | Loading · Empty (zero state — celebrate this with a "All clear" empty state) · No-results-after-filter |

### 7.7 Exception Detail

| | |
|---|---|
| Route | `/exceptions/[id]` |
| User story | As a dispatcher, I want to see the full context of an exception so that I can decide whether to override, escalate, or note resolution. |
| Purpose | One exception, fully expanded. |
| Components | `PageHeader`, `EvidencePacket` (the exception itself), context cards (trip summary, last known checkpoint), `Button` group (override · escalate · resolve · add note) |
| Mock data | `useException(id)` |
| Actions (mock) | Override → toast + redirect. Escalate → toast. Resolve → toast + redirect to `/exceptions`. Add note → modal with `TextArea`. |
| States | Loading · Not found · Already resolved (read-only) |

### 7.8 SLA Reports

| | |
|---|---|
| Route | `/sla` |
| User story | As a dispatcher, I want to generate an SLA report for a client over a date range so that I have a credible commercial document to present at quarterly reviews. |
| Purpose | Commercial reporting per Bruce's "sales tool" framing. |
| Components | `DateRangePicker`, client `Select`, `SLAChartCard` × 4, summary card, "Export PDF" `Button` (mock: triggers a toast) |
| Charts | On-time pickup % over time (line) · On-time delivery % over time (line) · Exceptions by type (horizontal bar) · Handshake completion rate (donut) — see `DESIGN_SYSTEM.md §12` for colours |
| Mock data | `useSLAMetrics({ clientId, range })` — derived in-memory from fixture trips |
| States | Loading · Empty (no trips for filter) — show "No data for this period" empty state on each chart, not a broken axis |
| Accessibility | Each chart has an `aria-label` summarising the key insight; toggle to switch each chart to a `DataTable` view. |

### 7.9 Settings

| | |
|---|---|
| Route | `/settings` |
| User story | As a dispatcher, I want to manage my profile and notification preferences so that I'm reached the way I prefer. |
| Purpose | Minimal — name, email (read-only on v1), sign-out. |
| Components | `Card`, `Input`, `Button` (sign out) |
| Mock data | `useAuth().user` |
| States | Idle |

### 7.10 Not-found and error

| | |
|---|---|
| Routes | `not-found.tsx`, `error.tsx` |
| Purpose | 404 and runtime error pages, brutalist-styled. |
| Components | `EmptyState` with `AlertTriangle` icon and a "Back to Active Trips" button. |

### 7.11 Token preview (dev only)

| | |
|---|---|
| Route | `/_dev/tokens` |
| Purpose | §4.3 living style sheet. Renders every colour, type role, spacing, radius, shadow. |
| Production | Returns 404 in production builds. |

---

## 8. Driver PWA — page catalogue

Port :3001. Mobile-first Android (Samsung). Every page is one logical step. Every step page renders `StepHeader` showing `Handshake X of 5 — <Name> · Step Y of Z: <Step name>`. Every page has a single primary CTA: "Complete & continue".

### 8.0 Conventions

- All authenticated pages wrap in `DriverShell` (`OfflineBanner`, `StepHeader`, content, `BottomBar`, `PanicButton`).
- All forms validate on blur and only enable the primary CTA when valid.
- The Android back gesture confirms before discarding partial step data per `DESIGN_SYSTEM.md §15.2`.
- "Complete & continue" calls `useTrip().advance()` and routes to the next step's URL.
- All `inputMode` attributes are correct (numeric for seal numbers, text for names).
- **Photo capture uses `@capacitor/camera` (`Camera.getPhoto()`)** — native Android camera UI on-device; falls back to `<input type="file" accept="image/*" capture="environment">` in a desktop browser. Always use the `PhotoCapture` component, never the raw input. On v1 the captured file is held in `TripContext` for the demo; not uploaded.
- **All pages are `"use client"`** — the static export (`output: 'export'`) required by Capacitor means no Server Components in the driver app. This overrides the general CLAUDE.md rule of "`"use client"` only at lowest level needed" for this surface only.
- Step page URLs use the form `/trip/[id]/handshake/[h]/step/[n]-[slug]`.

### 8.1 Login

| | |
|---|---|
| Route | `/login` |
| Layout | `(public)` |
| User story | As a driver, I want to sign in on my company device so that the system knows it is me at the gate. |
| Purpose | Mock auth. |
| Components | `Input` (email or driver ID), `Input` (password), `Button` |
| Notes | After signin, redirect to `/`. |

### 8.2 Driver Home

| | |
|---|---|
| Route | `/` |
| Layout | `(app)` — wraps in `DriverShell` (without `StepHeader` and `BottomBar` because no trip is active or trip not yet started) |
| User story | As a driver, I want to see today's assigned trip and start it in one tap so that I don't have to navigate menus before driving off. |
| Purpose | The home screen between trips. |
| States | **No trip** — `EmptyState` with `Truck` icon, copy "No trip assigned. Check back with dispatch." · **Trip assigned, not started** — `EvidencePacket` showing trip summary (route, vehicle, expected origin gate, slot time) with a single full-width primary `Button` "Start Trip → Begin Handshake 1" |
| Mock data | `useTrip()` returns the first trip in `lib/mocks/trips.ts` with status `'created'` or `'origin_gate_in'`. |

### 8.3 Settings

| | |
|---|---|
| Route | `/settings` |
| User story | As a driver, I want to sign out at end of shift so that the next driver on the device is not impersonating me. |
| Components | `Card`, `Button` (sign out) |
| Notes | Profile is read-only. |

### 8.4 Handshake 1 — Origin Gate-In (3 pages)

Bruce's narrative: driver arrives at origin precinct, gate security performs three scans (vehicle disc, trailer disc, driver licence). Pulsit geofence is the primary programmatic check. Driver photographs the gate-entry event.

#### H1 · Step 1 of 3 — Gate arrival (auto-triggered)

| | |
|---|---|
| Route | `/trip/[id]/handshake/1/step/1-approach-gate` |
| User story | As a driver, I want the system to know I've arrived at the gate automatically — without me tapping anything — so I can keep my hands on the wheel until I'm parked. |
| Purpose | Auto-triggered by the backend `GATE_ARRIVAL` push (Pulsit geofence fires → backend sends FCM via `@capacitor/push-notifications` → `usePushNotifications()` navigates here). Driver does not tap to start; the page opens itself. `LocationCapture` fires on mount and silently records GPS. |
| Layout | `StepHeader` · `LocationCapture` status card (auto, shows GPS captured) · `Card` showing precinct name and Pulsit geofence match status · Helper copy: "Wait for guard to scan vehicle disc, trailer disc, and your licence." · CTA "Guard scans done · Continue" |
| Dev / v1 | On v1 (no backend), the `/_dev/tokens` page has a "Simulate gate arrival push" button that triggers navigation to this URL. The `useLocation()` hook returns a hardcoded Linbro Park coordinate in the browser. |

#### H1 · Step 2 of 3 — Capture gate-entry photo

| | |
|---|---|
| Route | `/trip/[id]/handshake/1/step/2-entry-photo` |
| User story | As a driver, I want to take a photo of the gate entry event so that the evidence trail has human-captured proof of entry. |
| Components | `PhotoCapture` (full-width tap target) · `TimestampWithIcon` (auto-captured) · GPS mini-card |
| CTA | "Submit photo · Continue" — disabled until photo captured |

#### H1 · Step 3 of 3 — Verification status

| | |
|---|---|
| Route | `/trip/[id]/handshake/1/step/3-verification` |
| User story | As a driver, I want to see the verification result so that I know whether to proceed to loading or wait for dispatcher. |
| Components | Three `EvidencePacket` rows: Vehicle GPS check · Trailer GPS check · Driver match check. Each row has a status `Chip` and a description. |
| States | All-pass (CTA enabled, "Proceed to loading bay") · Any-fail (`ExceptionBanner`, CTA disabled, copy "Wait for dispatcher override") |
| Mock | All pass by default; `?force=fail` query toggles the failure state for the demo. |

### 8.5 Handshake 2 — Loading (5 pages)

The doc: the system polls Parcel Perfect for scan-out status; only when loading is complete is the manifest revealed. Driver photographs the signed waybill. Driver captures seal number and photographs the sealed door.

#### H2 · Step 1 of 5 — Arrive at loading bay

| | |
|---|---|
| Route | `/trip/[id]/handshake/2/step/1-arrive-bay` |
| User story | As a driver, I want to confirm I'm at the loading bay so that the system can start polling for the manifest. |
| Layout | `StepHeader` · Bay number card (mocked) · "Loading status: not started / in progress / complete" status row that updates every 4 seconds (mock) · CTA "Continue" — disabled until status is "complete" |

#### H2 · Step 2 of 5 — Confirm manifest

| | |
|---|---|
| Route | `/trip/[id]/handshake/2/step/2-manifest` |
| User story | As a driver, I want to see the manifest grouped by stop and visually confirm the count so that I know what was loaded matches the system. |
| Components | `EvidencePacket` per delivery stop, each with parcel count and any flagged discrepancies · grand total card · single confirm checkbox "I confirm visual count matches" · CTA |
| Mock data | `useManifest(tripId)` returns one of the fixture manifests. |

#### H2 · Step 3 of 5 — Photograph signed waybill

| | |
|---|---|
| Route | `/trip/[id]/handshake/2/step/3-waybill` |
| User story | As a driver, I want to photograph the warehouse rep's signed waybill so that there is evidence of physical sign-off. |
| Components | `PhotoCapture` · helper copy: "Capture the entire waybill including the signature." · CTA |

#### H2 · Step 4 of 5 — Capture seal

| | |
|---|---|
| Route | `/trip/[id]/handshake/2/step/4-seal` |
| User story | As a driver, I want to record the seal number and photograph the sealed door so that the seal is committed and any mid-route tamper is provable. |
| Components | `SealNumberInput` (mask `XX-####`) · `PhotoCapture` (sealed door) · CTA |
| Validation | Seal number required, valid format. Photo required. |

#### H2 · Step 5 of 5 — Review and submit

| | |
|---|---|
| Route | `/trip/[id]/handshake/2/step/5-review` |
| User story | As a driver, I want to review what I've captured before committing the loading handshake so that I don't submit incomplete evidence. |
| Components | Read-only `EvidencePacket`s for each captured artifact (manifest, waybill photo thumbnail, seal number + photo) · helper copy: "Submitting will anchor a pickup receipt to the blockchain." · CTA "Submit pickup · Anchor to chain" |
| Submit | 600 ms mock delay → toast "Pickup anchored · Receipt #ABC…" → advance to H3. |

### 8.6 Handshake 3 — Origin Gate-Out (3 pages)

#### H3 · Step 1 of 3 — Approach exit gate

| | |
|---|---|
| Route | `/trip/[id]/handshake/3/step/1-approach-exit` |
| User story | As a driver, I want to confirm I'm at the exit gate so that the system knows to capture seal verification. |
| Components | Same pattern as H1.1 — acknowledgement only. |

#### H3 · Step 2 of 3 — Capture exit photo and verify seal

| | |
|---|---|
| Route | `/trip/[id]/handshake/3/step/2-exit-and-seal` |
| User story | As a driver, I want to photograph the gate exit event and confirm the guard verified my seal so that the trip transitions to in-transit cleanly. |
| Components | `PhotoCapture` (gate exit) · `SealStatusBadge` showing the seal number captured at H2.4 · checkbox "Guard verified seal" · CTA |

#### H3 · Step 3 of 3 — Confirm departure

| | |
|---|---|
| Route | `/trip/[id]/handshake/3/step/3-departure` |
| User story | As a driver, I want to see that the trip has officially started and what to expect during transit so that I know what to do at fuel stops. |
| Components | Success animation (respects reduced-motion) · "Trip is now in-transit" · `Card` listing transit reminders (log a checkpoint at fuel stops; don't exceed 15 min stationary; panic button is always available) · CTA "Go to in-transit home" |

### 8.7 In-Transit (1 hub page + 5 utility pages)

#### In-Transit Home

| | |
|---|---|
| Route | `/trip/[id]/in-transit` |
| Purpose | The non-handshake home for the long stretch of transit between H3 and H4. |
| User story | As a driver, I want one screen that lets me log a checkpoint, upload a document, or report a problem so that I'm never digging through menus while driving. |
| Components | Trip summary card · `HandshakeChain` (vertical, current step glows on H3 just-completed, H4 pending) · three large primary actions: "Log checkpoint" / "Upload document" / "Report exception" · `PanicButton` already in `DriverShell` |
| Notes | Driver returns here after completing any transit action. |

#### Log Checkpoint

| | |
|---|---|
| Route | `/trip/[id]/in-transit/checkpoint` |
| User story | As a driver, I want to log a quick checkpoint at a fuel stop so that the trip has a clean evidence trail across the corridor. |
| Components | `PhotoCapture` (selfie — `capture="user"`) · auto-captured GPS card · optional `PhotoCapture` (cargo area) · CTA "Log checkpoint" |

#### Upload Document

| | |
|---|---|
| Route | `/trip/[id]/in-transit/upload` |
| User story | As a driver, I want to attach a side-of-road inspection report so that any incident has supporting documentation. |
| Components | File picker (image/pdf) · note `TextArea` · CTA |

#### Report Exception

| | |
|---|---|
| Route | `/trip/[id]/in-transit/exception` |
| User story | As a driver, I want to report a non-emergency problem (cargo damage, broken seal at fuel stop, mechanical breakdown, delivery refused) so that the dispatcher can act. |
| Components | List of exception types as large radio cards · per-type follow-up card (photo + note) · CTA |

#### Panic Confirmation

| | |
|---|---|
| Route | `/trip/[id]/panic` |
| User story | As a driver, I want a hold-to-confirm flow before sending a panic so that an accidental tap doesn't trigger a real alert. |
| Components | Full-screen red `Drawer`-style page · `useHoldToConfirm(2000)` hook drives a circular progress ring around the `AlertTriangle` icon · CTA visually fills as the user holds. |
| Notes | This is the page reached when the floating `PanicButton` is held for 2 s. Always reachable from `DriverShell`. |

#### Panic Submitted

| | |
|---|---|
| Route | `/trip/[id]/panic/submitted` |
| User story | As a driver, I want to know the panic was sent so that I'm not unsure whether help is on the way. |
| Components | `success` styled hero card "Panic alert sent · Dispatcher and reaction company notified" · timestamp · CTA "Return to trip" |

### 8.8 Handshake 4 — Destination Gate-In (3 pages)

#### H4 · Step 1 of 3 — Destination gate arrival (auto-triggered)

| | |
|---|---|
| Route | `/trip/[id]/handshake/4/step/1-approach-dest` |
| User story | As a driver, I want the system to detect my arrival at the destination gate automatically so that I don't need to interact with my phone before parking. |
| Purpose | Same auto-trigger pattern as H1.1 — Pulsit geofence at destination fires → backend sends FCM `GATE_ARRIVAL` push → `usePushNotifications()` navigates here → `LocationCapture` fires on mount. |
| Components | Same layout as H1.1: `LocationCapture` status card · precinct name card · helper copy · CTA "Guard scans done · Continue" |

#### H4 · Step 2 of 3 — Capture destination entry photo

| | |
|---|---|
| Route | `/trip/[id]/handshake/4/step/2-dest-entry-photo` |
| User story | As a driver, I want to photograph my arrival so that the evidence trail has human-captured proof of arrival. |
| Components | `PhotoCapture` · CTA |

#### H4 · Step 3 of 3 — Seal verification

| | |
|---|---|
| Route | `/trip/[id]/handshake/4/step/3-seal-verify` |
| User story | As a driver, I want to confirm the guard verified the seal is intact (or report it broken) so that the strongest fraud signal is captured immediately. |
| Components | `SealStatusBadge` showing the seal number from H2.4 · two-button choice: "Seal intact · Continue" (success-styled) and "Seal broken · Report" (danger-styled, opens an inline `ExceptionBanner` and routes to `/in-transit/exception?type=seal-broken`) |
| States | Intact (continues to H5) · Broken (high-priority exception flow) |

### 8.9 Handshake 5 — Unloading (6 pages)

The doc emphasises arrival verification as the highest-weight evidence. Bruce's two-way exchange: driver hands waybill copy to handler → seals broken, load body and doors inspected → driver oversees scan-in and visual count → cargo officer hands driver signed POD → driver photographs POD.

#### H5 · Step 1 of 6 — Hand waybill copy

| | |
|---|---|
| Route | `/trip/[id]/handshake/5/step/1-hand-waybill` |
| User story | As a driver, I want to acknowledge that I've handed my waybill copy to the receiving handler so that the unloading sequence starts in the right place. |
| Components | Helper copy explaining the handover · checkbox "I have handed the waybill copy to the receiving handler" · CTA |

#### H5 · Step 2 of 6 — Wait for seal break and inspection

| | |
|---|---|
| Route | `/trip/[id]/handshake/5/step/2-seal-break-inspection` |
| User story | As a driver, I want to wait while the cargo officer breaks the seals and inspects the load body so that I know not to interfere. |
| Components | Sequenced status card: "Awaiting seal break" → "Awaiting load body inspection" → "Inspection complete" (mock auto-advance every 4 s) · CTA enables when inspection complete |

#### H5 · Step 3 of 6 — Visual unload count oversight

| | |
|---|---|
| Route | `/trip/[id]/handshake/5/step/3-visual-count` |
| User story | As a driver, I want to watch the live scan-in count and report any discrepancy so that mismatches are flagged before I leave. |
| Components | Big "Scanned: X / Y" counter (mock auto-increments) · per-stop breakdown · "Report discrepancy" link to in-transit exception |

#### H5 · Step 4 of 6 — Photograph signed POD

| | |
|---|---|
| Route | `/trip/[id]/handshake/5/step/4-pod-photo` |
| User story | As a driver, I want to photograph the signed master POD so that the depot-to-depot delivery is provable for invoicing. |
| Components | `PhotoCapture` · helper copy "Capture the entire POD including the signature." · CTA |

#### H5 · Step 5 of 6 — Reconciliation result

| | |
|---|---|
| Route | `/trip/[id]/handshake/5/step/5-reconciliation` |
| User story | As a driver, I want to see whether the three counts (manifest, scan-in, my visual) all agree so that I leave knowing whether the trip is clean or short-delivered. |
| Components | Three count cards side-by-side · summary `Chip` (Match / Short-delivered / Over-delivered) · `ExceptionBanner` if mismatch · CTA "Submit delivery · Anchor to chain" |
| Submit | 600 ms mock delay → toast "Delivery anchored · Receipt #DEF…" → advance to step 6. |

#### H5 · Step 6 of 6 — Trip closed

| | |
|---|---|
| Route | `/trip/[id]/handshake/5/step/6-closed` |
| User story | As a driver, I want clear confirmation the trip is closed so that I know I'm done and can return. |
| Components | Full-screen `success` styled hero · trip number · timestamp · summary stats (5/5 handshakes, N exceptions logged, N anchors) · CTA "Return home" → `/` |

### 8.10 Not-found and error

| | |
|---|---|
| Routes | `not-found.tsx`, `error.tsx` |
| Components | Mobile-optimised `EmptyState` with a "Go home" button. |

### 8.11 Token preview (dev only)

Same as dispatcher — `/_dev/tokens`.

---

## 9. Page count summary

| Surface | Pages | Notes |
|---|---|---|
| **Dispatcher** | 11 | Login, Active Trips, Trip Detail, Trip Creation, History, Exceptions, Exception Detail, SLA Reports, Settings, 404, Error (+ dev tokens) |
| **Driver — Auth/Shell** | 3 | Login, Driver Home, Settings |
| **Driver — Handshake 1** | 3 | Approach, entry photo, verification |
| **Driver — Handshake 2** | 5 | Arrive bay, manifest, waybill, seal, review |
| **Driver — Handshake 3** | 3 | Approach exit, exit photo + seal, departure |
| **Driver — In-transit** | 6 | Hub, checkpoint, upload, exception, panic, panic submitted |
| **Driver — Handshake 4** | 3 | Approach dest, dest entry photo, seal verify |
| **Driver — Handshake 5** | 6 | Hand waybill, seal break wait, visual count, POD photo, reconciliation, closed |
| **Driver — System** | 3 | 404, error (+ dev tokens) |
| **Driver total** | **32** | |

---

## 10. Build sequence (recommended)

If four developers split this work, build in this order:

**Phase 0 — Foundation (everyone aligned, do first, no parallel work).**
1. Token map in both `tailwind.config.ts` files.
2. Lint rule blocking raw hex.
3. `lib/types/*.ts` — every type.
4. `lib/mocks/*.ts` — every fixture.
5. `lib/context/*.ts` — Auth, Trip, Toast providers.
6. `lib/hooks/*.ts` — required hooks (including `useLocation`, `usePushNotifications`).
7. `components/ui/*` — every primitive in §5.1.
8. `/_dev/tokens` page in both surfaces (visual sign-off that design system is wired, plus the "Simulate gate arrival push" dev button on the driver surface).
9. **Capacitor scaffold** (driver-pwa only): `npx cap init`, set `output: 'export'` in `next.config.ts`, `npx cap add android`, verify `npx cap sync android` runs clean, open in Android Studio and confirm the emulator boots. Do this in Phase 0 — retrofitting Capacitor after pages are built is painful because every web API call needs swapping.

**Phase 1 — Dispatcher in parallel with Phase 1 Driver.**
- Dispatcher: `DispatcherShell` → Login → Active Trips → Trip Detail → Trip Creation. Then History, Exceptions list/detail, SLA, Settings, 404/error.
- Driver: `DriverShell` (incl. `OfflineBanner`, `BottomBar`, `PanicButton`) → Login → Driver Home → Handshake 1 (3 pages) → Handshake 2 (5 pages) → Handshake 3 (3 pages).

**Phase 2 — Driver, continued.**
- In-transit hub, checkpoint, upload, exception picker, panic + panic submitted.
- Handshake 4 (3 pages), Handshake 5 (6 pages).
- Settings, 404/error.

**Phase 3 — Polish.**
- Loading skeletons everywhere.
- Empty states everywhere.
- Accessibility audit (axe-core in dev) on every page.
- Reduced-motion verification on every animated component.
- Lighthouse PA pass on the driver PWA (target: 90+ Performance, 100 Accessibility).

---

## 11. Out of scope for v1

These are intentionally excluded so the spec doesn't sprawl. Each has a future home:

- **Guard page** (`frontend/guard/`) — plain HTML+JS, no framework. Will get its own short spec when Phase 2 principal SLA work begins.
- **Client portal** (`frontend/client-portal/`) — read-only evidence access for FedEx and similar clients. Future spec.
- **Real authentication** (JWT, refresh tokens, role-based routing). Backend territory.
- **Live GPS map** inside FreightProof. Pulsit owns this — `Full Picture §6.1, §10`.
- **React Native.** Explicitly ruled out — Capacitor wraps the same Next.js web codebase without a parallel native codebase. "Two simultaneous mobile strategies exceed team capacity" (`Full Picture §10`); Capacitor is one strategy, not two.
- **iOS build.** Capacitor supports iOS, but it requires a Mac with Xcode and an Apple Developer account. Android-only for this project. `npx cap add ios` is deferred.
- **Play Store listing.** Sideloading the APK onto company-issued Samsung devices via `adb install` is sufficient for the demo. A TWA / Play Store submission is Phase 2.
- **Background geolocation during transit.** The `@capacitor-community/background-geolocation` plugin is installed for future use but is only called from `usePushNotifications()` on gate-arrival events. Continuous background tracking during the N3 drive is Pulsit's job.
- **Dispatcher dark mode.** Brutalist aesthetic is single-theme by design.
- **Internationalisation.** English-only on v1.
- **Analytics / telemetry.** Not in MVP.
- **Form library** (react-hook-form, formik). Native `<form>` is sufficient for the page count.
- **State library** (Redux, Zustand, Jotai). Context is sufficient for the page count.
- **MSW (Mock Service Worker).** Fixtures + hooks are sufficient and mechanically swappable to a real API later — see §3.4.

---

## 12. References

- [`docs/FreightProof_Full_Picture_v6.md`](FreightProof_Full_Picture_v6.md) — domain reference; the source of truth for what each page must record.
- [`frontend/DESIGN_SYSTEM.md`](../frontend/DESIGN_SYSTEM.md) — visual reference; the source of truth for tokens, type, and components.
- [`CLAUDE.md`](../CLAUDE.md) — Claude Code instructions; covers stack, layering, testing, git rules.
- [`README.md`](../README.md) — project overview, ports, install steps.

---

## 13. Changelog

| Version | Date | Notes |
|---|---|---|
| v1 | 2026-05-09 | First spec. Covers Dispatcher Portal and Driver PWA only. Page granularity = "logical-step grouping" (option B). Mock data via TS fixtures + React Context (option A). |
| v1.1 | 2026-05-09 | Added Capacitor for native Android support. Replaced `next-pwa` with `@serwist/next` (browser PWA) + Capacitor (Android APK). Driver PWA switches to `output: 'export'` (all pages `"use client"`). `PhotoCapture` uses `@capacitor/camera`. Added `LocationCapture` component (auto, no button). Added `useLocation()` and `usePushNotifications()` hooks. Gate arrivals (H1.1, H4.1) are now auto-triggered by FCM push + Pulsit geofence, not manual acknowledgement. Capacitor scaffold added to Phase 0 build sequence. iOS and Play Store out of scope for v1. |
