# Dispatcher trip detail, incidents and driver-transfer polish

**Date:** 21 Oct 2026 · **Author:** Opus assessment session (Ciaran) · **Branch:** `Ciaran`
**Executor:** a fresh Sonnet session. **Reviewer:** Ciaran, or a later Opus session.

This plan comes from a walkthrough of the running dispatcher on three trips:

- `FP-20261020-E30768BA` (`d50243ca-565e-4e5a-a96e-eaa13d1874b8`): cancelled, one completed driver transfer, incident INC1 Hijacking, SAPS case recorded.
- `FP-20261021-9FD8655E` (`b720dd15-39f7-4d78-ab9c-aead8b76a26f`): active, in loading, with the Transfer driver button.
- `FP-20261020-209B8B89` (`886750db-aa13-4894-b053-448a78f319d8`): closed, one completed driver transfer.

The scope is **the dispatcher only**. Driver app items are recorded at the end under "Deferred" and must not be touched.

---

## 0. Read this first (executor rules)

1. **Read `CLAUDE.md` in full.** Its rules override anything here. In particular:
   - **No git write commands.** You may `git add <specific files>` only. Never commit, stash, restore or checkout.
   - Give a `TASK COMPLETE` block at the end of each batch.
2. **Do not touch these pre-existing uncommitted files.** They belong to other work. Do not edit or stage them:
   - `backend/app/core/exceptions.py`
   - `backend/app/orchestration/consignments/manifest_import.py`
   - `backend/app/orchestration/consignments/sync.py`
   - `backend/tests/integration/test_consignment_move_incidents.py`
   - Everything under `.codex/`, `.impeccable/`, `docs/reviews/`, `graphify-out/`
3. **Before any UI edit**, read `~/.claude/skills/impeccable/reference/craft-floor.md` and `frontend/DESIGN_SYSTEM.md`.
   - **Hard rule from Ciaran:** never mark status or selection with a coloured leading bar or side stripe (`border-l-*` in a colour, an inset shadow stripe). Use a fill, a full-perimeter hairline, an icon or a text token instead.
4. **Reuse before you create.** Every shared component or helper named below already exists. Grep for an existing label map or helper before adding one; the codebase has many.
5. **Work batch by batch, in order (A → B → C → D → E).** Stop after each batch, report `TASK COMPLETE` and wait for Ciaran. He commits between batches.
6. **Tests:**
   - Every changed component keeps or extends its colocated `*.test.tsx`. Every new pure helper gets a `*.test.ts`.
   - Backend changes follow CLAUDE.md's testing section.
   - Run the backend suite **in the foreground**. A background run races a hook that wipes the test DB.
7. **No database migrations are needed anywhere in this plan.** If you believe one is needed, stop and ask.
8. **If an instruction here contradicts what the code actually does, stop and report.** Do not improvise.

### Verification commands

```bash
# Dispatcher (from frontend/dispatcher)
npx vitest run <changed test files>     # per task
npm run type-check
npm run lint
npm test                                 # full suite, once per batch

# Backend (from backend)
.venv/bin/pytest tests/unit/<file> tests/integration/<file> -q   # per task
.venv/bin/pytest -q                                              # full suite, once, foreground
```

Use `backend/.venv/bin/pytest`. `pytest` is not on PATH, and `backend/venv` is a stale 3.11 environment.

### Visual check (Batches A–D)

- The dispatcher dev server is usually already running on `:3000`, with the backend on `:8000`.
- Sign in with the demo dispatcher account. Ciaran will supply the credentials. Never write them into a file.
- **Before you look at anything, wait 10–20 s per page.** The local backend talks to remote Supabase and is slow (trip detail took about 17 s). A slow load is not a bug in your change.
- View the trip page at ≥1440 px wide so the Info panel docks beside the timeline.

---

## Batch A — quick fixes (frontend only)

### A1. Brand mark: sign-in page, sidebar and favicon

**Decision (Ciaran, 21 Oct):**

- The sign-in page uses black (primary) buttons and the landing-page logo from `main`, not the blue shield-and-tick.
- The same mark goes in the sidebar and becomes the favicon.

**Background:**

- `main` has a `LogoMark` component and icon files. This branch does not, because `main` is not merged into `Ciaran`.
- The blue mark (`components/brand/FreightProofLogo.tsx`) and the `brand` Button variant were added by **Tim** (see the comment in `components/ui/Button.tsx`). Flag this under "Shared files / cross-dev" in TASK COMPLETE.

**Steps:**

1. Bring the files across from `main` byte-for-byte, **at the same paths**, so a later merge of `main` does not conflict. Use `git show` with redirection. It is read-only and allowed.

   ```bash
   cd /Users/ciaranformby/dev/freightproof-sa-4
   mkdir -p frontend/dispatcher/components/landing
   git show origin/main:frontend/dispatcher/components/landing/Logo.tsx > frontend/dispatcher/components/landing/Logo.tsx
   git show origin/main:frontend/dispatcher/app/icon.svg       > frontend/dispatcher/app/icon.svg
   git show origin/main:frontend/dispatcher/app/favicon.ico    > frontend/dispatcher/app/favicon.ico
   git show origin/main:frontend/dispatcher/app/apple-icon.png > frontend/dispatcher/app/apple-icon.png
   ```

   - Do not edit `Logo.tsx`; it must stay identical to `main`.
   - Next.js picks up the `app/icon.svg`, `favicon.ico` and `apple-icon.png` files on its own. No `metadata` change is needed.
2. **Contrast.** `LogoMark` is an ink (`fill-primary`) shield. Both the sidebar and the login hero are dark, so the mark must sit on a light tile there.
3. **Sidebar** (`components/layout/Sidebar.tsx`, about line 261):
   - Replace `<Shield className="w-4 h-4 text-white" />` with `<LogoMark size={22} />`.
   - Change the tile from `bg-white/10 ring-1 ring-white/10` to a paper tile (`bg-surf`, same `w-9 h-9 rounded-lg`) so the ink shield reads.
   - Remove the now-unused `Shield` import from lucide.
4. **Sign-in page** (`app/(public)/login/page.tsx`):
   - Replace `<FreightProofLogo tone="on-dark" size="lg" />` with a lockup: `LogoMark` (size 36) on the same paper tile as the sidebar, followed by the existing white "FreightProof" wordmark styling (white, `font-[800]`, `tracking-[-0.035em]`, `text-[28px]`).
   - Do not use `Logo` from landing here. Its wordmark is `text-on-surf` (dark) and would vanish on the photo.
   - The submit button: `variant="brand"` → `variant="primary"`.
5. **Cleanup:**
   - If `FreightProofLogo` / `FreightProofMark` and the `brand` Button variant have no remaining users (grep the whole `frontend/` tree, tests included), delete the file and the variant.
   - If anything else still uses them, leave them in place and report it.
6. **Tests:**
   - Update `app/(public)/login/page.test.tsx` if it asserts on the logo or the button variant.
   - Update `components/layout/__tests__/Sidebar.test.tsx` if it asserts on the shield.

**Done when:** the favicon shows the black road-shield in the browser tab, and the sidebar and sign-in page both show it legibly. No blue remains on the sign-in page.

### A2. Incidents icon in the sidebar

**Problem:** `components/layout/Sidebar.tsx:56` gives Incidents `icon: 'shield'`. A shield is the brand motif and reads as "security", not "an incident under investigation".

**Fix:**

- In `components/ui/Ic.tsx`, the `siren` path is incomplete (rays only, no body). Replace it with a full siren drawn in the same 24-viewBox, stroke-only style as the other icons.
- **Source the path from lucide's `siren` icon.** Lucide is already a dependency, and its SVG lives in `node_modules/lucide-react`, or use `lucide-static` if present. Merge lucide's separate elements into this file's single-path, `' M '`-separated format.
- Set Incidents to `icon: 'siren'`.
- Grep for other `n="siren"` users first. If any exist, check they still look right.

**Done when:** the sidebar shows a siren for Incidents, in both collapsed and expanded rails.

### A3. "Transfer driver" button placement in the header

**Problem:**

- `components/trips/TripSummary.tsx:69` passes the transfer action as `SummaryCell`'s `action`. That pins it to the **label row**, top-right of the "Driver" cell (line 125).
- Ciaran wants it beside the driver's name, vertically centred with it.

**Fix:**

- In the non-compact branch, stop passing `action` to the Driver `SummaryCell`.
- Render the name button and `<TransferAction>` in one `flex items-center gap-2 min-w-0` row. The name keeps `truncate`; the action is `shrink-0`.
- Keep the phone link on its own line below.
- Leave the compact (`compact && transferAction`) placement at line 63 unchanged.
- **Restyle `TransferAction` as a small secondary button**, not blue link text, to match the design system's ink-first rule:
  - Reuse `Button` with `size="sm" variant="secondary"` and `iconLeft={<ArrowRightLeft size={12} />}`.
  - Keep the `hidden sm:inline` label behaviour.
  - Keep `aria-label` / `title`.
- If `SummaryCell`'s `action` prop has no users left, remove it.

**Tests:** `components/trips/TripSummary.test.tsx`. The action must still render, be clickable and keep its label when not compact.

**Done when:** on `b720dd15…` the button sits on the same line as "Ciaran Formby", vertically centred.

### A4. Raw user ID in the cancellation note

**Problem:**

- `backend/app/orchestration/trips/administration.py:111` writes the description `Cancelled by user <uuid>: <note>` on a `dispatcher_note` exception.
- The comment at line 27 says the prefix is deliberately machine-findable. **Do not change the backend.**
- The UUID shows in the timeline "Trip record" and in exception rows.

**Fix (display only):**

1. In `frontend/dispatcher/lib/format/exception.ts`, add a pure function:

   ```ts
   exceptionDescriptionText(exception: { exception_type: string; description: string; reviewed_by_name?: string | null }): string
   ```

   - If `exception_type === 'dispatcher_note'` and `description` matches `/^Cancelled by user [0-9a-f-]{36}: /i`, return `Cancelled by ${reviewed_by_name ?? 'a dispatcher'}: ${rest}`.
   - The cancelling dispatcher is recorded as the reviewer (`dispatcher_authored_review`), so `reviewed_by_name` is the right name.
   - Otherwise return `description` unchanged.
2. Apply it wherever the dispatcher renders an exception's `description` as text:
   - `components/domain/ExceptionRow.tsx`
   - `components/domain/ExceptionSummary.tsx`
   - `components/domain/ExceptionEvidence.tsx`
   - `components/exceptions/exceptionColumns.tsx`
   - `app/(app)/exceptions/[id]/page.tsx`
   - `components/incidents/ReportIncidentDialog.tsx`
   - `components/incidents/IncidentEvidencePanel.tsx`

   Grep `\.description` to confirm the list. Ignore `dev/` and fixture files.
3. Check which exception types carry `reviewed_by_name` (`frontend/shared/lib/types/exception.ts`, around lines 154–217). Pass it where available.
4. Add tests to the existing `lib/format/exception.test.ts`:
   - the cancel prefix is rewritten with a name;
   - it falls back to "a dispatcher" when there is no name;
   - other `dispatcher_note` text is untouched;
   - other exception types are untouched.

**Done when:** on `d50243ca…` the Trip record reads "Cancelled by Demo Dispatcher: Trip stopped by dispatch."

### A5. Plain-English labels on the transfer timeline card

**Problem:** `components/trips/DriverTransferTimelineEvent.tsx:30` prints raw enum values: "dispatcher attested · Anchor: anchored".

**Fix:**

- Create `frontend/dispatcher/lib/format/driver-transfer.ts` with:
  - `COMPLETION_MODE_LABELS: Record<SubstitutionCompletionMode, string>`: `normal` → "Driver accepted", `dispatcher_attested` → "Completed by dispatcher".
  - `ANCHOR_STATUS_LABELS: Record<AnchorStatus, string>`: `anchored` → "Sealed on Hedera", `pending` → "Sealing pending", `failed` → "Sealing failed", `not_required` → "Not sealed".
  - **First grep for an existing `AnchorStatus` label map** (`grep -rn "not_required" frontend/dispatcher/lib frontend/shared/lib`). If one exists, reuse it instead of adding a second.
- The card's line becomes `{completion label} · {anchor label}`. A null value prints "Not recorded".
- Do the same in `DriverSubstitutionPanel.tsx`'s `HistoryItem` (line 238), which hand-rolls the same wording.
- Add tests in `lib/format/driver-transfer.test.ts` and update `DriverTransferTimelineEvent.test.tsx`.

---

## Batch B — Incidents list page on the shared components

**File:** `frontend/dispatcher/app/(app)/incidents/page.tsx`.

**Problem:** the page uses the shared `Table`, but everything else is hand-built: the status switcher, a raw `<select>` and a raw checkbox. It has no `ListToolbar`, `SearchField` or `FilterSelect`, no sorting, no search and no pagination.

**Reference implementations to copy (read both first):**

- `app/(app)/fleet/drivers/page.tsx`: a client-side list with `ListToolbar` + `SearchField` + `FilterSelect` + `useTableSort` + `sortRows`.
- `app/(app)/exceptions/page.tsx`, lines 280–320 and 360–400: `Tabs` for views above a `ListToolbar` with `hasActiveFilters` / `onClear`, and `Pagination`.

**Data note:**

- `GET /incidents` (`backend/app/api/v1/endpoints/incidents.py:137`) has no paging or search, and returns the whole org list.
- **Keep it that way.** Incident volume is small. Do search, sort and paging client-side, like Drivers.
- `useIncidents` already filters server-side by `status`, `incident_type` and `assigned_to`. Keep those three server-side.

**Build:**

1. **Status views:**
   - Replace the hand-built segmented buttons with `Tabs` (`components/ui/Tabs.tsx`): All · Open · Investigating · Closed.
   - Use the same props pattern as Exceptions: `className="w-fit [&>button]:flex-none"`, `ariaLabel="Incident status"`.
   - **All stays the default.** The comment in the current file explains why.
2. **`ListToolbar`** (`hasActiveFilters` / `onClear`):
   - `SearchField`: placeholder "Search trip reference, incident or summary…". It matches case-insensitively on `trip_reference`, `reference`, `summary` and `assigned_to_name`.
   - `FilterSelect` for type: the options come from `INCIDENT_TYPE_LABELS`, plus "All types".
   - `FilterSelect` for owner, replacing the "Mine only" checkbox: "Anyone" / "Assigned to me" / "Unassigned".
     - "Assigned to me" keeps the server `assigned_to=user.id`.
     - "Unassigned" filters client-side (`assigned_to_user_id === null`).
3. **Sorting:**
   - Use `useTableSort` + `sortRows` (`lib/sort/sort-rows.ts`).
   - Sortable columns: Incident (by `trip_reference`, then `reference`), Type, Status, Unresolved (`parcels_unresolved`), Investigated by, Received.
   - Default sort: Received, descending.
   - Pass `sort={tableSort}` and `onSort` to `Table`.
4. **Pagination:**
   - Page size comes from `readPreferences().rowsPerPage` (as in `useTripHistory.ts:67`).
   - Slice client-side.
   - Render `Pagination` under the table, as Exceptions does.
   - Reset to page 1 whenever the search, filters or sort change.
5. **Copy:** keep the "Report an incident from a trip's Info tab, or from an exception." hint. It may move into `TopBar`'s `sub` if that reads better.
6. **States:**
   - Initial load keeps `Table isLoading`.
   - The error and empty states keep `EmptyState`.
   - The empty-state copy distinguishes "No incidents yet" (no filters active) from "Nothing matches these filters".
7. **Pure helpers:** put the filtering and sort-key logic in `frontend/dispatcher/lib/incidents/incident-list.ts` and test it in `incident-list.test.ts`, covering search fields, owner filter, sort keys and paging boundaries.
8. **Add `app/(app)/incidents/page.test.tsx`** (none exists). Mock `useIncidents` / `useAuth` the way `exceptions/page.test.tsx` does. Cover:
   - tabs change the status filter;
   - search narrows rows;
   - Clear filters resets everything;
   - a header click sorts.

**Done when:** the Incidents page looks and behaves like Exceptions and Drivers, built from the same components.

---

## Batch C — trip Info panel restructure

**Files:**

- `components/trips/TripDetailPanel.tsx`
- `components/trips/TripInformation.tsx`
- `components/trips/DriverSubstitutionPanel.tsx`
- `components/incidents/TripIncidentsSection.tsx`
- `components/trips/AuditPacksPanel.tsx`
- `components/trips/LateDriverEvidencePanel.tsx`
- `components/trips/trip-help-copy.ts` (only if it names sections that move)
- a new `components/ui/Disclosure.tsx`

**Current order** (one long scroll, with headings in mixed styles):

Custody (one row) → Schedule & recorded times → Route → **full-width red Cancel trip button** → Driver and handover → late driver evidence → INCIDENTS (uppercase eyebrow) → Audit packs → Police & notifications (nested inside the audit packs component).

### C1. New `Disclosure` component (`components/ui/Disclosure.tsx`)

**Built on native `<details>`/`<summary>`.** It gives keyboard, screen-reader and find-in-page support for free, and the codebase already uses `<details>` in `AuditPacksPanel.tsx:106`.

**Props:**

```ts
interface DisclosureProps {
  id: string                 // stable; used for the heading id and the localStorage key
  title: string
  summary?: ReactNode        // one line shown in the header beside the title, always visible
  defaultOpen?: boolean
  open?: boolean             // optional controlled mode (needed for audit-pack landing, C5)
  onOpenChange?: (open: boolean) => void
  children: ReactNode
}
```

**Behaviour:**

- The header row shows the title (`text-sm font-bold text-on-surf`), the summary (`text-xs text-on-surf-v`, truncating) and a chevron that rotates when open.
- **No buttons inside `<summary>`.** Interactive controls inside a summary are an a11y and click-target problem. Section actions go at the top of the body.
- Remember the open/closed state per section in `localStorage`, under the key `fp.tripInfo.section.<id>`.
  - Wrap every read and write in try/catch. Storage can be unavailable.
  - The stored value wins over `defaultOpen`, except when the `open` prop is controlled.
- Sections are separated by `border-t border-outline-v/30`, with consistent vertical padding. No coloured side bars.
- **Tests (`Disclosure.test.tsx`):**
  - it toggles on click and on Enter;
  - `defaultOpen` works;
  - controlled `open` works;
  - the summary shows while closed;
  - it persists to storage;
  - it survives a storage that throws.

### C2. New section order and content

All sections use `Disclosure`, with sentence-case titles. The uppercase "INCIDENTS" eyebrow goes.

| # | Section id / title | Default | Summary line (closed state) | Content |
|---|---|---|---|---|
| 1 | `schedule` · **Schedule & seal** | open | Departure delay via `fmtDelay(delayMinutes(...))` (e.g. "Departed 1 h 11 m late"), else "Not departed"; or "Cancelled {date}" / "Closed {date}" when terminal | The existing Schedule rows **plus** "Last departure seal", moved here from the one-row "Custody" section, which is deleted |
| 2 | `route` · **Route** | closed | `"{n} stops · {first} → {last}"` | The existing route list, unchanged |
| 3 | `custody` · **Driver & custody** | open if a transfer is pending, else closed | `"{current driver} · {k} handover(s)"` or `"Transfer pending"` | See C3 |
| 4 | `incidents` · **Incidents** | open if any incident `status !== 'closed'`, else closed | `"{n} open"` / `"{n} investigating"` / `"None"` | See C4 |
| 5 | `audit` · **Audit packs** | closed | Static: "Sealed records for insurers, clients and SAPS" | The `AuditPacksPanel` body **minus** the police section; see C5 |

After the last section comes **Trip actions**. It is a plain block, not a `Disclosure`:

- It shows only when `!isTripTerminal(trip.status)`.
- It contains the **Cancel trip** button: `variant="danger" size="sm"`, **not `full`**. It is removed from `TripInformation`.
- `TripInformation` keeps its `onCancelTrip` prop only if it still renders the button. Otherwise move the prop to wherever the block lives (`TripDetailPanel`) and delete it from `TripInformation`.

`TripInformation` should now render only sections 1 and 2. Rename nothing else.

### C3. Driver & custody (`DriverSubstitutionPanel.tsx`)

**Decision (Ciaran):** actions live in the header's Transfer driver modal and in the transfer evidence modal. The Info panel only *summarises* custody.

- **Keep:**
  - "Current driver";
  - "Original driver" (only when it differs);
  - the integrity chip with its pending-anchor and findings lines;
  - the pending-transfer sentence (it already points to the header).
- **Remove the "Custody period" row.** A bare number means nothing to a dispatcher; the handover count is in the summary line.
- **History items become read-only rows:**
  - Each shows "Outgoing → Incoming", the status chip and the effective time with A5's plain-English labels.
  - A **completed** row is a button that opens the transfer evidence modal for that `completed_substitution_id`.
  - To open it, **lift the modal state** out of `TripTimeline`:
    - today `TripTimeline.tsx:112` owns `openTransferId`;
    - move that state to `app/(app)/trips/[id]/page.tsx`;
    - pass `openTransferId` / `onOpenTransfer` down to both `TripTimeline` and `TripDetailPanel`;
    - render the one `<Modal>` + `<DriverTransferDetail>` once, in `page.tsx`, as a sibling of `DetailPanel`.
    - The comment at `TripDetailPanel.tsx:69` explains why modals must sit outside `DetailPanel`.
- **Move "Add clarification" into the evidence modal.** Move its whole form (`HistoryItem` lines 204–260: reason, note, submit, idempotency key, error handling) into `DriverTransferDetail` as a section at the bottom. Then delete it from `HistoryItem`.
- **Late driver evidence:** `<LateDriverEvidencePanel>` moves *inside* this section, at its bottom. It already renders nothing when empty.

**Tests:**

- Update `DriverSubstitutionPanel.test.tsx`: no clarification form; rows open the modal through the callback; no custody-period row.
- Update `DriverTransferDetail.test.tsx`: the clarification form submits and calls `correctSubstitution`; the existing error and version-conflict cases move with it.

### C4. Incidents section, now including police details

- Make `TripIncidentsSection` the body of the `incidents` Disclosure:
  - drop its own `border-t`, `pt-6` and eyebrow heading;
  - put the "Report incident" button at the top of the body, right-aligned.
- **Fix the unresolved count wording:**
  - before: `{parcels_unresolved} unresolved`;
  - after: `{parcels_unresolved} of {parcels_total} parcels unresolved` (singular "parcel" when the total is 1);
  - hide it when `parcels_total === 0`.
- **Move "Police & notifications" here** from `AuditPacksPanel.tsx`, lines 160–180:
  - Extract it into a new `components/incidents/TripPoliceDetails.tsx`. Keep the declarations fetch (`listIncidentDeclarations`), the "Record police details" and "Incident fact sheet" buttons and the busy/error handling.
  - It renders under the incident list, with a sub-heading "Police & notifications".
  - The `onDeclare` callback, `rememberAuditTrigger` focus-return logic and `DeclareIncidentDialog` wiring in `TripDetailPanel.tsx` (lines 106–119, 149, 158) must keep working. Update the focus-return query so it searches the new section's buttons, not only `auditSectionRef`.
  - The incident fact sheet download (`incidentSheetPdf`) moves with it.
- `AuditPacksPanel`: remove the police section and the now-unused `declarations`, `sheet` and `onDeclare`. Update `AuditPacksPanel.test.tsx` and move the police assertions into a new `TripPoliceDetails.test.tsx`.

### C5. Audit packs landing must still work

`TripDetailPanel` has a "legacy audit link lands on Audit packs" behaviour (`scrollToAuditPacks`, lines 90–104, plus `auditMinimumHeight`).

- Make the `audit` Disclosure **controlled**: `open = scrollToAuditPacks ? true : userState`. A legacy landing opens it before the scroll effect measures.
- Keep the `id={TRIP_AUDIT_PACKS_SECTION_ID}` / `aria-labelledby` on the element the effect scrolls to.
- The existing tests in `TripDetailPanel.test.tsx` covering audit landing must still pass unmodified, or with only selector changes. **If they need logic changes, stop and report.**

### C6. Loading states inside the panel

These are made consistent with the `SectionRowsSkeleton` already used by incidents (`components/incidents/IncidentSkeletons.tsx`):

- `AuditPacksPanel.tsx:111`: replace "Loading audit packs…" text with `SectionRowsSkeleton rows={2} label="Loading audit packs"`.
- `TripPoliceDetails`: show `SectionRowsSkeleton rows={1}` while the declarations load. Today it shows nothing.
- `DriverTransferDetail.tsx:18`: replace the bare `<p>` with a skeleton shaped like the new layout (D2).
- `LateDriverEvidencePanel`: rendering nothing while loading is acceptable now that it sits inside a collapsed section. Leave it.

Incidents already load separately (`useTripIncidents`); keep that.

**Done when:**

- On all three trips, the Info tab shows five tidy collapsible sections in the order above, with the summary lines correct.
- Cancel trip sits at the bottom on the active trip and is absent on the terminal trips.
- Police details sit under Incidents.
- Open/closed state survives a reload.
- Visiting the legacy audit URL still lands on Audit packs.

---

## Batch C-fix — review fixes for A–C (do these before Batch D)

Opus reviewed A–C on 21 Oct, in the browser and in code. Type-check, lint and all 3,127 tests pass. These five items came out of that review. Each is small; one `TASK COMPLETE` covers all of them.

### CF1. Driver name truncated by the Transfer button (A3 regression)

**What happens:**

- At 1440 px with the Info panel docked, the header's Driver cell is 205 px wide.
- On `b720dd15…`, "Ciaran Formby" shows as "Ciaran Fo": the name button gets 63 of the 115 px it needs, because the secondary button takes the rest.

**Fix** (`components/trips/TripSummary.tsx`, the Driver cell's name row):

- Let the row wrap: `flex flex-wrap items-center gap-x-2 gap-y-1`.
- Give the name button `min-w-0 max-w-full truncate` and **no** shrink pressure from the button. The name keeps its full width, and the button drops onto its own line when there's no room.
- The name must truncate only when it alone is wider than the cell.
- **Test:** the name and the button both render, and the name element carries no width cap tied to the button's presence.
- **Check in the browser:** on `b720dd15…` the full name shows at 1440 px with the panel docked, and at a narrow width.

### CF2. Police details and the fact sheet gated on the wrong condition

> **Correction (Opus, 22 Oct):** the rule below was incomplete. The server's `summarise_incident` (`backend/app/orchestration/audit_packs/analysis.py`) also builds a sheet for a recorded **hijacking** incident with no critical exception. `canBuildSheet` is therefore `hasCriticalException || incidents.some(i => i.incident_type === 'hijacking')`. Fixed and tested in `TripDetailPanel.tsx`.

**What happens:**

- `TripPoliceDetails` hides itself, and the "Incident fact sheet" button, when `hasIncidents` is false.
- The server builds the fact sheet when the trip has a **critical exception**, not when it has an incident record: `render_trip_incident_sheet` raises `NoIncidentError` "when the trip has no critical exception" (`backend/app/orchestration/audit_packs/lifecycle.py:152`).
- So a trip with a panic or hijack-type critical exception but no INC record lost both "Record police details" and the fact sheet. Before Batch C, both were always offered.

**Fix:**

- In `TripDetailPanel`, compute `hasCriticalException = uniqueExceptionsById(trip.exceptions).some(e => e.severity === 'critical')`. `exceptions` is already computed there.
- Pass two props to `TripPoliceDetails`:
  - `showSection = hasIncidents || hasCriticalException` (the section still shows when declarations are already recorded, as now);
  - `canBuildSheet = hasCriticalException`.
- Update the comment. It currently says "The server refuses a fact sheet for a trip with no incident", which is wrong: it's no **critical exception**.
- **Tests:** the section shows with a critical exception and no incidents; the fact sheet button is hidden without a critical exception even when there's an incident; the section is hidden with neither.

### CF3. Active incidents and pending transfers must not hide in a closed section

**What happens:**

- Every section except Schedule & seal starts closed, and the summary is grey text. The plan asked for Incidents to open when an incident isn't closed, and Driver & custody to open when a transfer is pending.
- The remembered state is stored **per section, not per trip** (`fp.tripInfo.section.incidents`). Collapsing Incidents once therefore hides an active hijacking on every other trip too.

**Fix:**

1. Pass `defaultOpen` as the plan specified:
   - `incidents`: `tripIncidents.data.some(i => i.status !== 'closed')`;
   - `custody`: `trip.pending_driver_substitution != null`.

   `Disclosure` already keeps `defaultOpen` live until the reader chooses.
2. Make the summary carry weight when something is active, because a stored "closed" still wins:
   - Allow `Disclosure`'s `summary` to be a node (it already is), and pass a `Chip` instead of plain text in two cases:
     - Incidents, when any incident is open or investigating: an `exception`-type chip, e.g. "1 investigating";
     - Driver & custody, when a transfer is pending: a `pending`/warn chip reading "Transfer pending".
   - Otherwise keep the grey text.
   - Keep `incidentsSummary` / `custodySummary` as the string sources. Add an `isActive` helper in `lib/trips/info-summary.ts`, with tests, that the panel uses to choose chip or text.
3. **Tests:** both `defaultOpen` cases, and the chip shown when active.

### CF4. Audit landing: section can't be collapsed, and its min-height lingers

**What happens:**

- On `?panel=audit`, the `audit` Disclosure is controlled (`open={scrollToAuditPacks ? true : undefined}`), so clicking its header does nothing.
- `auditMinimumHeight` (906 px when measured) is never reset. After landing, or after issuing a pack (`refreshAuditPacks`), collapsing Audit packs leaves a large blank area.

**Fix:**

- Replace control with a one-shot open. When `scrollToAuditPacks` is true, the landing makes the section open **once**: e.g. a `forceOpenKey` prop, or calling `writeStoredOpen('audit', true)` and re-keying. The reader can then collapse it as normal.
- Clear `auditMinimumHeight` back to 0:
  - once the landing scroll has happened (after `auditLandingTripRef.current = trip.id`, reset on the next frame);
  - after the remounted `AuditPacksPanel` finishes loading (an `onLoaded` callback);
  - whenever the audit section is collapsed.
- The legacy-landing tests must still pass. Add one test that the section can be collapsed after a landing.

### CF5. Minor items

- `DriverSubstitutionPanel` lists all completed handovers, then all cancelled ones. Merge them into **one list in time order** (`effective_at ?? terminal_at ?? created_at`; use whatever timestamps `SubstitutionRequestRead` has).
- Incidents page: the "Report an incident from a trip's Info tab…" hint in `TopBar sub` renders in link blue (`text-sec`) and reads like a link. Move it to a muted `text-xs text-on-surf-v` line under the toolbar, or drop it from `sub`. It's already in the empty state.
- A5 merged "both drivers confirmed" (legacy two-confirmation requests) into "Driver accepted". Restore the distinction:
  - `fmtCompletionMode(mode, requestFormat?)` returns "Both drivers confirmed" when `mode === 'normal'` and `requestFormat !== 'immediate_v2'`;
  - update its tests and the callers that have `request_format`.

**Done when:** all of the above, and the full dispatcher suite, type-check and lint are green.

---

## Batch D — timeline: incident cards and the transfer evidence modal

### D1. Incidents in the trip timeline

**Decision (Ciaran):** an incident appears in the timeline like a driver transfer, but more prominent.

1. **Lift the data.** Call `useTripIncidents(trip.id)` once in `app/(app)/trips/[id]/page.tsx`. Pass the `AsyncState` to `TripDetailPanel` (replacing its internal call at line 77) and `incidents.data` to `TripTimeline`. One fetch, two consumers. Keep `refetchSilent` wired to `onReported`.
2. **Generalise placement:**
   - Refactor `lib/phase/driver-transfers.ts` into a generic `positionTimelineEvents<T>(phases, events, at: (e: T) => string, key: (e: T) => string, tieBreak?: (a: T, b: T) => number)`, returning `{ beforeFirst, afterPhase, unplaced }`.
   - Keep `positionDriverTransfers` as a thin wrapper with the **same signature and behaviour**, so `driver-transfers.test.ts` passes unchanged.
   - Add tests for the generic function.
3. **Incident time:** `reported_occurred_at ?? received_at`.
4. **New component** `components/incidents/IncidentTimelineEvent.tsx`, mirroring `DriverTransferTimelineEvent.tsx`'s structure (rail column + button card):
   - **Rail node:** 30 px circle, **filled** `bg-err text-err-on`, with the `siren` icon from A2. The transfer's node is outlined and neutral.
   - **Card:** full-perimeter `border border-err/40 bg-err-c/40`, `rounded-lg`, the same padding as the transfer card. **No side stripe.**
   - **Content:**
     - line 1: **"{reference} · {type label}"** in bold, plus `IncidentStatusChip`;
     - line 2: the summary, clamped to 2 lines;
     - line 3: "Reported {time}", "· {n} of {m} parcels unresolved" when `parcels_total > 0`, and "· {assigned_to_name}" when set.
   - Tokens (from `tailwind.config.ts:35`): `bg-err` + `text-err-on` for the node, `bg-err-c/40` + `border-err/40` for the card, `text-err-onc` for the title.
   - **Click** navigates to the incident detail: `router.push(withReturnTo(ROUTES.incidentDetail(id), returnTo))`, the same target `TripIncidentsSection` links to. `TripTimeline` needs `returnTo`; `page.tsx` already has it.
   - It renders in **both** the evidence and minimised timeline views.
5. **Render** in `TripTimeline.tsx`:
   - Place incidents alongside transfers in `beforeFirst`, each `afterPhase` slot and `unplaced`.
   - When a transfer and an incident share a slot, order them by time.
   - Include incidents in the `isLast` check (line 205) so the rail doesn't end early.
   - For unplaced incidents (no consistent phase boundaries), add an "Incidents" block beside "Unplaced historical driver transfers", with the same treatment.
6. **Tests:**
   - `IncidentTimelineEvent.test.tsx`: content, chip, the parcels line hidden at 0, and click navigation.
   - Extend `TripTimeline.test.tsx`: an incident placed after the right phase, and an incident sorted against a transfer in the same slot.

**Done when:** on `d50243ca…`, INC1 Hijacking shows as a red-tinted card at the right point in the timeline, and clicking it opens the incident.

### D2. Transfer evidence modal: readable layout and names, not IDs

**Problem:** `components/trips/DriverTransferDetail.tsx` is an unstructured list of `<p>`s that prints raw UUIDs for:

- the dispatcher (`arranged_by_user_id`, `completed_by_user_id`, `identity_attestation.attested_by_user_id`, `corrections[].recorded_by_user_id`);
- the drivers (`confirmations[].driver_id`, `completed_by_driver_id`);
- the vehicles (`seal_checks[].vehicle_id`).

#### Backend: add display names

There is no migration; this is a read-model change only.

- **Schema** (`backend/app/schemas/driver_substitutions.py`):
  - `CompletedSubstitutionDetail` (line 431): add `arranged_by_name: str | None`.
  - `SubstitutionCompletionRead`: add `completed_by_name: str | None`.
  - `IdentityAttestationRead`: add `attested_by_name: str | None`.
  - `SubstitutionCorrectionRead`: add `recorded_by_name: str | None`.
  - **Check whether any of these models is reused elsewhere** (grep). If so, give the new field a `None` default, so other constructors keep working.
- **Reader:** in `backend/app/orchestration/substitutions/reads.py::get_completed_substitution` (line 384):
  - collect every user id above, plus every driver id;
  - resolve them in **one** query each against `User.full_name` (`app.db.models.people.User`, as in `audit_packs/incident_declarations.py:84`) and `Driver.full_name`;
  - fill the new fields. An unknown id gives `None`. Never raise.
  - A driver's name can come from `summary.outgoing` / `summary.incoming` when the id matches; only query if needed.
- **Frontend type:** mirror the fields in `frontend/shared/lib/types/driver-substitution.ts`.
- **Backend tests:** extend `tests/integration/test_driver_substitution_endpoints.py`, near `test_completed_detail_is_dispatcher_org_scoped` at line 370, with a test that the detail returns the arranging dispatcher's name, the attester's name and a correction's recorder name. Cover the 401 and 404 cases if they aren't already covered. Assert by fixture user names; no hardcoded IDs.

#### Frontend: restructure `DriverTransferDetail`

Use `InfoRow` (`components/ui/InfoRow.tsx`) for label/value pairs. Groups:

1. **Header:** "{Outgoing} → {Incoming}", effective time, completion label (A5), and the phase ("During loading") from `PHASE_NAMES`.
2. **Arrangement:**
   - Reason;
   - Arranged by {arranged_by_name};
   - Completed by {completed_by_name ?? the driver's name via the outgoing/incoming id match};
   - Declared exchange time;
   - a missing-confirmation reason, when present.
3. **Incoming driver's check** (one block per confirmation):
   - Declared {time} · received {time};
   - Location: `PROXIMITY_LABELS[...]` (reuse from `lib/phase/location-evidence.ts:85`), with the reasons in plain English. Reuse any existing reason-label map in that file; otherwise add one there with tests;
   - Vehicles checked: registrations, not a count. Map ids through `trip.horse` / `trip.trailers`, which needs `trip` (or a vehicle map) passed in;
   - Seals: "{registration}: Intact · FP-1233";
   - Note;
   - the photos (`EvidencePhoto`, as now).
4. **Identity:** the identity status. If attested: "Identity attested by {name} at {time}: {reason}".
5. **Driver notifications:** the outgoing notices, as now but labelled.
6. **Record integrity:** anchor label (A5), custody integrity chip, any findings in `text-err`.
7. **Clarifications:** the list (names, not IDs), plus the "Add clarification" form moved here in C3.
8. The existing footnote ("Names are current display labels…") stays.

The props change to `{ trip: Trip; substitutionId: string; onChanged: () => void }`. Take `tripId` from `trip.id`. `onChanged` is now used, after a clarification.

**Tests:** update `DriverTransferDetail.test.tsx`. Assert that no UUID-shaped string renders (`/[0-9a-f]{8}-[0-9a-f]{4}-/`), and that names and registrations appear.

**Note on "the modal never loads":** it does load. It took about 15–20 s because every request on that page is slow locally, and in dev React StrictMode queues a second fetch. That is not a bug in this modal. The proper skeleton (C6) is the fix in scope here; backend latency is out of scope (see Deferred).

---

## Batch E — exceptions for transfers with problems (backend)

**Decision (Ciaran, 21 Oct):**

- A completed driver transfer raises an exception **only when it carries a problem**, so a dispatcher watching Exceptions sees it.
- Ordinary, clean transfers do **not** raise one. They are planned, authorised custody amendments, and putting each one in the review queue would be noise.

**What already exists** (read before writing):

- `ExceptionType.DRIVER_SUBSTITUTION = "driver_substitution"` (`backend/app/db/models/enums.py:148`) exists and is unused.
  - `exception_type` is a plain `String(50)` column (`transit.py:233`), so **no migration** is needed.
  - The frontend already lists the type (`frontend/shared/lib/types/exception.ts:47`, `shared/lib/constants/status-meta.ts:66`).
- Handover captures **already** raise `driver_vehicle_separation` (when the phone was measured more than the limit from the tracker; `capture_assessment.py:71–87`) and seal findings (`seal_comparison.py`). **Do not duplicate those.**
- `DriverSubstitution.exception_id` (`trips.py:281`, `:348`) is documented as **legacy only**, and the row is frozen into an anchored commitment. **Do not set it.**

**Trigger conditions.** Evaluate in `_complete` (`backend/app/orchestration/substitutions/service.py:409`) after `anchors.freeze_substitution`. Raise **one** exception if **any** of these hold:

1. **Identity not verified.** `row.incoming_identity_status != IdvsStatus.VERIFIED`. This includes a dispatcher attestation over a PENDING identity.
2. **Required confirmation missing.** `row.missing_confirmation_reason is not None`.
3. **Location unverified on the incoming capture.** The incoming confirmation's `action_location_assessment.proximity == "unverified"`, read from the confirmation row's stored assessment.
   - `separated` is excluded because the existing `driver_vehicle_separation` exception already covers it.
   - Only check this if the assessment is available in `_complete`'s scope without a new query on the hot path. If it isn't, include condition 3 by querying the request's confirmations once.
   - **If that is not straightforward, implement conditions 1–2 only and report.**

**The exception:**

- `exception_type = DRIVER_SUBSTITUTION`, `source = ExceptionSource.SYSTEM`, `severity = ExceptionSeverity.WARNING`, `review_status = initial_review_status(WARNING)`.
- `trip_id = trip.id`. `phase_event_id` is `None` (a handover is not a phase; see the comment at `transit.py:214`).
- `description`: one plain sentence naming both drivers and listing **every** condition that fired, e.g.:

  > Driver transfer from Ciaran Formby to Timothy Gultig completed with: incoming identity not verified (attested by dispatcher); handover location not verified.

  Use driver names, never IDs.
- Create it with `register_exception(db, TripException(...))` (`evidence_anchors/recording.py:202`), inside `async with db.begin_nested():`, as in `seal_comparison.py:122–130`.
- Enqueue `RealtimeKind.EXCEPTION_RAISED` with `event_severity(WARNING)`, as in `seal_comparison.py:139`.
- **Fail-open.** A failure building or writing this exception must be logged (`logger.exception`) and must **never** block the completion. A finding never conditions custody (see the `_complete` and `confirm_substitution` docstrings).
  - Catch the specific error class you expect around the nested savepoint, log it, and continue.
  - No bare `except`.
- **Check first:** confirm a WARNING `driver_substitution` exception does **not** move the trip to `exception_hold`. Grep for where severity drives `TripStatus.EXCEPTION_HOLD`. **If it would, stop and report.**
- **Savepoint caveat** (known behaviour in this codebase): releasing a `begin_nested()` savepoint fires `after_commit` listeners, so queued realtime events can publish before the real commit. This matches `seal_comparison.py`. Note it in TASK COMPLETE; do not try to fix it here.

**Frontend:**

- Add `driver_substitution: 'Driver transfer needs review'` to `EXCEPTION_TYPE_LABELS` in `frontend/dispatcher/lib/format/exception.ts`.
- Verify the new exception renders in:
  - the Exceptions page;
  - the trip's Exceptions tab;
  - the timeline's "Trip record" section (phase-less exceptions land there).

**Tests:**

- **Integration** (extend `tests/integration/test_driver_transfer_v2.py` or `test_driver_substitution_service.py`, whichever already sets up completions):
  - an attested completion with PENDING identity raises exactly one `driver_substitution` WARNING exception, and its description names both drivers;
  - a clean completion (verified identity, required confirmation present, location `within_limit`) raises **none**;
  - a completion with `missing_confirmation_reason` raises one;
  - multiple conditions give one exception with all reasons, not several;
  - the trip status is unchanged (not `exception_hold`);
  - the completion still succeeds if the exception write fails (monkeypatch `register_exception` to raise the expected error).
- **Unit:** if you pull the condition logic into a pure function (recommended: `transfer_review_reasons(row, incoming_assessment) -> list[str]`), add a unit test file for it.

**Done when:** the backend suite is green, and completing an attested transfer on a test trip makes it appear on `/exceptions` as "Driver transfer needs review".

---

## Investigate only (report findings, do not fix without asking)

### I1. Trip History stuck on its skeleton

**Observed:**

- `/history` showed loading rows indefinitely.
- The network log showed four `GET /trips/history?...` requests; at least two returned 200, yet the table never filled.

**Hypothesis (unverified):**

- `lib/hooks/useTripHistory.ts` invalidates every earlier request on each new one (`requestGenerationRef`, line 97 onward).
- If live refetches keep arriving faster than a request completes (every request takes 2–4 s locally), no response is ever applied.
- `lib/hooks/useAsyncData.ts` (the comment above `inFlightRef`) documents exactly this failure mode and solves it with single-flight plus one follow-up request.

**Ask:**

- Reproduce it.
- Confirm or refute with evidence: log the generations, or count the live events.
- Report the cause and a proposed fix. Do not change the hook until Ciaran agrees.

---

## Deferred (do not touch in this plan)

- **Driver app: takeover check is not phase-aware.**
  - `frontend/driver-pwa/lib/hooks/useSubstitutionCapture.ts::captureProblems` requires a seal condition, number and photo per vehicle whatever the phase.
  - Before departure no seal exists, so the driver must pick "No seal (empty leg)" and type a reason.
  - Proposed: before departure, confirm the vehicles plus an optional photo and note; from departure on, the seal check. Needs Ciaran's go-ahead and backend validation changes.
- **Driver app: "jumped out of the step flow after scanning".** Unconfirmed; two hypotheses:
  1. Step routes carry no trip id. The foreground refresh after the camera returns (`useTripAutoRefresh`) can resolve a different trip (`TripContext.loadTrip`), and the mismatch guard (`PhaseStepPageClient.tsx:224`) redirects.
  2. Android kills the activity during camera capture, and Capacitor relaunches at root.

  Needs `adb logcat` / `chrome://inspect` evidence first.
- **Backend latency:**
  - `GET /trips/{id}` took about 17 s locally, and every request took 1.5–4 s, even `/auth/me`.
  - Suspected cause: connection-pool contention from roughly 15 parallel requests on page load against remote Supabase, plus `verify_custody_chain` on the transfer detail.
  - Profile separately.

---

## Cross-dev and shared-file flags for TASK COMPLETE

- **Tim's files:** A1 touches `components/brand/FreightProofLogo.tsx` (possibly deleting it) and the `brand` Button variant. Flag for Tim.
- **Shared files** as defined by `CLAUDE.md`: none of these tasks should touch them. If you find you need to, stop.
- **Suggested commits**, one per batch:
  - `fix(dispatcher): brand mark, incidents icon, header transfer action, readable cancel note and transfer labels`
  - `refactor(dispatcher): incidents list on shared toolbar, search, sort and pagination`
  - `feat(dispatcher): collapsible trip info sections; police details under incidents`
  - `feat(dispatcher): incidents in trip timeline; readable transfer evidence with names` (this one includes the backend read-model names)
  - `feat(orchestration): raise driver_substitution exception for unverified transfers`
