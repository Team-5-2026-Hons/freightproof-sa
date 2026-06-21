# Dispatcher — Forensic-View UX Completion (FP-115)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This single document is **both** the design spec and the implementation plan — read the Design section before touching any task.

**Goal:** Finish the dispatcher side of FP-115. The backend role gating and per-widget `ForensicOnly` gating already work and are tested; what is missing is the *operator-facing UX*: a usable global forensic toggle, clear signals that the user is in an admin account and that forensic detail is currently exposed, and a human-readable event history that stops dumping raw JSON.

**Surface:** dispatcher only (`frontend/dispatcher/`). **Branch:** `Ciaran`.
**Backend:** untouched — the `admin_dispatcher` role already arrives via `GET /api/v1/auth/me` (`DispatcherUser.role: 'dispatcher' | 'admin_dispatcher'`), and receipt-stripping/`require_admin_dispatcher` are done and green (`test_auth_dependencies.py`, `test_detail_receipts_gating.py`, `test_blockchain.py`).

---

## Background — what's broken today

Three concrete defects, all frontend:

1. **The forensic toggle is invisible on desktop.** The only toggle lives inside a `md:hidden` mobile header strip in `DispatcherShell.tsx`, so on a desktop browser it never renders. There is no global, persistent control.
2. **An admin can't tell they're an admin.** `Sidebar.tsx` hard-codes the footer role label to the literal string `"Dispatcher"`; it never reads `user.role`.
3. **The event timeline dumps raw JSON.** `EventTimeline.tsx` renders `changed_fields` via `JSON.stringify(..., null, 2)` inside a `<pre>`, and the *entire* block (including the human-meaningful "what changed") sits inside `ForensicOnly`, so a normal dispatcher sees no operational history at all.

The gating logic itself is correct and stays — this work only changes presentation and where state lives.

---

## Design decisions (resolved)

These were settled during brainstorming; do not re-litigate them mid-build.

**D1 — One global forensic control, persistent, default OFF.**
A single forensic toggle, visible on every dispatcher page, controls blockchain detail everywhere at once. It is **not** per-entity — "per trip / per vehicle / per driver" is satisfied because the same switch applies on whichever page you are viewing. State persists across reloads via `localStorage` (key `fp.forensicOn`), defaulting OFF when unset. (Tradeoff noted: persisting a sensitive-data toggle is a mild exposure choice; OFF-by-default + admin-only gate keeps it acceptable, and it matches the agreed UX.)

**D2 — The global control mounts inside `TopBar`.**
`components/ui/TopBar.tsx` is already rendered by ~every app page and exposes a right-side slot. The forensic control + role indicator render automatically inside TopBar's right cluster, so the control is consistent everywhere with zero per-page wiring. This deliberately couples the `ui/TopBar` primitive to app context (`useAuth`, `useForensicMode`) — an accepted tradeoff for guaranteed consistency over keeping TopBar perfectly dumb.

**D3 — Admin differentiators: sidebar badge, top-bar role indicator, forensic-ON styling.**
(a) Sidebar footer shows the real, humanized role with an **ADMIN** badge for `admin_dispatcher`. (b) The TopBar control shows the role beside the toggle. (c) While forensic mode is ON, the toggle takes the `chain` accent and a small "Forensic view" badge appears, so the admin always knows hashes are currently on screen. (Admin-only *nav* gating was explicitly excluded.)

**D4 — Split the event timeline: operational facts for everyone, proof for forensics.**
`changed_fields` is humanized into labelled rows rendered **outside** `ForensicOnly`, visible to every dispatcher as normal history. Only the `BlockchainBadge` (Hedera seq / HashScan link) stays **inside** `ForensicOnly`. The raw `JSON.stringify`/`<pre>` block is **removed entirely** (no raw-JSON expander).

**POPIA:** the humanizer must only surface fields already visible to dispatchers elsewhere (e.g. licence number already shows on the driver detail page). It must not introduce any new PII surface, and it never renders hashes/receipt data (those remain forensic-gated).

---

## Design language

Follow the dispatcher app's existing token vocabulary — `surf*` / `on-surf*` surfaces, `sec`/`ok`/`warn`/`err` semantic colours, the `chain` token (`#006874`, `chain-c`, `chain-on`, `chain-onc`) for all blockchain/forensic accenting, `r-sm`/`r-md`/`rounded-xl` radii, `shadow-level-*` elevation, Inter weights. **No raw Tailwind palette classes** (`bg-gray-100`, `text-blue-600`, `#hex`). Reuse `components/ui/*` primitives; the ADMIN and "Forensic view" badges are small bespoke inline badges (do **not** overload `Chip`, whose `ChipType` is for trip statuses). No emoji — use `lucide-react` icons consistent with the rest of `components/`.

---

## Files

**Modify**
- `frontend/dispatcher/lib/context/ForensicModeContext.tsx` — localStorage persistence.
- `frontend/dispatcher/components/ui/TopBar.tsx` — mount the forensic control cluster.
- `frontend/dispatcher/components/layout/DispatcherShell.tsx` — remove the broken `md:hidden` toggle.
- `frontend/dispatcher/components/layout/Sidebar.tsx` — real role + ADMIN badge in footer.
- `frontend/dispatcher/components/blockchain/EventTimeline.tsx` — humanize `changed_fields`, drop raw JSON, keep badge forensic-only.

**Create**
- `frontend/dispatcher/components/blockchain/ForensicControls.tsx` — admin-aware toggle + role badge + forensic-ON badge.
- `frontend/dispatcher/lib/forensic/describeChange.ts` — pure `changed_fields` → labelled rows helper.

---

## Out of scope

- Trip detail page (`trips/[id]/page.tsx`) — its forensic gating is already correct; do not restyle it here.
- Any backend / `auth/` / Alembic change — the role and gating are done and tested.
- `frontend/shared/` types — `DispatcherUser.role` and the event types already exist; do not edit shared types.
- Other devs' surfaces (`driver-pwa/`, backend). No shared-file (`main.py`, `config.py`, `models/__init__.py`, `package.json`, etc.) changes.
- Admin-only navigation gating (explicitly excluded in D3).

---

## Tasks

### Task 1 — Persist forensic mode (default OFF)
- [ ] In `ForensicModeContext.tsx`, initialise `forensicOn` from `localStorage` (`fp.forensicOn === 'true'`), falling back to `false` when unset or unavailable (guard for SSR/no-storage with a try/catch — log and default OFF, never throw).
- [ ] On `toggle()`, write the new value back to `localStorage`. Keep the existing `canViewForensics` (role) check and the no-op-when-not-admin behaviour.
- [ ] Extract the storage key to a module constant (no magic string).

### Task 2 — `ForensicControls` component
- [ ] Create `components/blockchain/ForensicControls.tsx` (`"use client"`). Reads `useForensicMode()` and `useAuth()`.
- [ ] Renders nothing when `!canViewForensics` (regular dispatchers see no control).
- [ ] For admins: a toggle button (`aria-pressed={forensicOn}`, ≥ adequate hit area) that is neutral when OFF and uses `chain` accent (`bg-chain-c text-chain-onc border-chain/40`) when ON; plus a small "Forensic view" badge shown only while ON; plus a compact role indicator ("Admin").
- [ ] Type every prop; comment *why* the component self-hides rather than relying on callers.

### Task 3 — Mount globally via TopBar; remove the dead toggle
- [ ] In `components/ui/TopBar.tsx`, render `<ForensicControls />` in the right cluster (before `children`), so it appears on every page using TopBar. Keep the existing `children` right-slot working for page-specific actions.
- [ ] Remove the `md:hidden` forensic `<button>` block from `DispatcherShell.tsx` (the mobile-only one that caused the "no toggle" symptom). Leave the mobile hamburger intact.

### Task 4 — Sidebar role + ADMIN badge
- [ ] In `Sidebar.tsx` footer, replace the hard-coded `"Dispatcher"` string with the humanized `user.role` ("Admin Dispatcher" / "Dispatcher").
- [ ] When `user.role === 'admin_dispatcher'`, render a small **ADMIN** badge next to the name (bespoke inline badge using tokens; not `Chip`).

### Task 5 — Split the event timeline
- [ ] Create `lib/forensic/describeChange.ts`: a pure helper mapping known `changed_fields` keys to friendly labels and returning rows of `{ label, value }`. Handle the value defensively — primitives render as `Label: value`; if a value is an `{ old, new }`-shaped object, render `old → new`. Unknown keys fall back to a humanized key. **Verify the actual `changed_fields` shape against the backend writer** (search `backend/app/orchestration/`/event-creation for where vehicle/driver `changed_fields` is populated) before finalising the value handling.
- [ ] In `EventTimeline.tsx`, render the `describeChange` rows **outside** `ForensicOnly` (visible to all dispatchers), beneath the event title/timestamp.
- [ ] Keep `<BlockchainBadge receipt={receipt} />` **inside** `ForensicOnly`. **Delete** the `<pre>{JSON.stringify(...)}</pre>` block entirely.
- [ ] Ensure the humanizer never emits hash/receipt fields (POPIA + forensic separation).

---

## Final verification (run once, after all tasks)

- [ ] `cd frontend/dispatcher && npm run lint` (or `tsc --noEmit`) — no type errors, no `any`.
- [ ] Manual, **as `admin_dispatcher`**: sidebar shows name + ADMIN badge; forensic toggle visible in the top bar on trips, vehicles, drivers, and dashboard; toggling ON reveals hashes/HashScan everywhere and shows the "Forensic view" badge; the choice **persists across a page reload**.
- [ ] Manual, **as regular `dispatcher`**: no forensic toggle, no ADMIN badge, no hashes anywhere; the **friendly change-summary in the event timeline is still visible**.
- [ ] No raw JSON anywhere in the event timeline.
- [ ] Desktop + 390px viewport screenshot check against the dispatcher design language (token colours only, no emoji, calm accent use, hierarchy reads at a glance).
- [ ] Confirm `admin_dispatcher` is the *only* gate — re-run the existing backend suite if any auth file was touched (it should not be): `cd backend && pytest -q`.

---

## Suggested commits

> **Suggested commit:** `feat(dispatcher): persistent global forensic toggle + admin role differentiators (FP-115)`
> **Suggested commit:** `feat(dispatcher): human-readable event timeline, drop raw changed_fields JSON (FP-115)`

> ⚠ This plan never runs git commands. Stage and commit yourself after `npm run lint` and the manual passes above. Move FP-115 to In Review/Done in Jira once verified.

---

## Notes for the implementer
- This is pure presentation/state work; the authoritative gating stays in the backend and in `ForensicOnly`. Do not add business logic.
- Keep components small and single-responsibility (`ForensicControls` is the single forensic UI gate; `describeChange` is pure and unit-testable).
- The one genuine unknown is the `changed_fields` payload shape — resolve it by reading the backend writer, not by guessing, since it determines whether the timeline shows `value` or `old → new`.
