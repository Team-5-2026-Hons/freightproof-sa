# Dispatcher audit bug fixes: one PR, three stages

**Source:** `docs/frontend-cleanup-audits-2026-10-22/2026-10-22-dispatcher-cleanup-audit.md` §2 (B1–B18).
**Branch:** a fresh branch off `dev` (Ciaran creates it). **Scope:** `frontend/dispatcher/` only. No `frontend/shared/`,
no backend, no `package.json`, no comment cleanup (§5/§6), no dead-code sweep beyond what a fix below names.
**Status:** decisions D1–D7 confirmed by Ciaran, 22 Oct 2026.

Line numbers in the audit have drifted since the merge. Find each spot by symbol, not line.

## Decisions

| # | Bug | Decision | Why |
|---|---|---|---|
| D1 | B2 sign-out | Always clear local state: `try { await port.signOut() } finally { clearActivity; setUser(null) }`. Log the failure. Fix the `ProfileMenu` comment so it is true. | A dispatcher who clicks Sign out on a shared depot PC must be signed out locally even if the network call fails. The server token expires on its own; a live session left on screen does not. |
| D2 | B3 `var(--r-sm/md)` | Replace with the existing Tailwind steps `rounded-sm` (3 px) and `rounded-md` (6 px). Do not add CSS variables. | The config already defines these steps under the same names, so this is the intent with no new tokens. |
| D3 | B4 `bg-secondary-fixed` | Delete `Card`'s `selected` variant (no caller) and `components/domain/PhaseChain.tsx` (no importer). | Both uses are dead code, so the undefined class never renders. Adding a token for dead code is wasted work. |
| D4 | B13 "today" in UTC | Use `sastToday()` from `@shared/lib/utils/datetime`. Compute presets when the picker opens, not at module load. Day arithmetic on the SAST date string. `ppDate` formats in SAST. | The ops timezone is SAST (`OPERATIONS_TIMEZONE`). One shared helper already exists. |
| D5 | B15 `useAsyncData` ignores a new `fetchFn` | No behaviour change. Add one comment on the hook: "A changed fetchFn does not refetch; remount (key) to change the resource." | Latent only (pages remount on ID change). Making it refetch on `fetchFn` change risks loops in every caller that passes an inline function. |
| D6 | B18 SA ID number on create-trip | Remove the "ID number" field from `CrewFields`' driver card; keep name, licence, phone. | POPIA data minimisation: picking a driver needs the licence, not the ID number, and `DriverModal` already hides it for this reason. Mention it in the PR description for the team. |
| D7 | B16 dev tokens page | Move `app/(app)/dev/tokens/` to `app/dev/tokens/` (beside `app/dev/design`), keep the `NODE_ENV === 'production'` guard, and rename the heading "Mock Auth State" to "Dev sign-in". Update `ROUTES` if it lists the path. | Outside `(app)` the page renders signed out, so "Force Sign In" works. A move is lower risk than deleting a teammate's tool. |

## Stage 1: small, local logic fixes

| Bug | Change | Test (vitest) |
|---|---|---|
| B5 | "Return to first page" resets only the history cursor. Use or add a `firstPage()` on `useExceptionHistory` (it already tracks `pageIndex`/`cursorStack`), not `clearFilters`. | Filters set + on page 2 + error → click Return → filters kept, page index 0 |
| B6 | `trailer-combo.ts`: missing length → "`<reg>` has no recorded length"; any other two-trailer pair → "Two trailers must be one 6 m and one 12 m". `Maximum ${MAX_TRAILERS} trailers allowed`. Name the 18 m as a constant only if it is still used. | 6+6 message; 12+12 message; one length missing; 3 trailers |
| B7 | `describeChange.ts`: booleans render Yes/No; `is_active` alone keeps Active/Inactive (per-field map). | `is_shared: true` → "Yes"; `is_active: false` → "Inactive" |
| B8 | `costCopy.ts` `basis(trips, period)`: "by week/month/year departed" from the View-by value; update its caller. | One case per period |
| B9 | `fmtManifestCargo` uses `countLabel` for waybills and parcels; `ConfirmationDetail` unaccounted line uses `countLabel`. | 1 waybill · 1 parcel; 2 waybills · 5 parcels; "1 parcel" / "2 parcels unaccounted" |
| B11 | Add `isAnchoredTopic(topicId)` next to the hashscan helpers in `lib/format/hashscan.ts` (rejects null, empty and `'None'`). Use it in `BlockchainBadge`, `ChainReceiptTag`, `TripCreatedDetail`, `ExceptionHederaLinks`. | Helper: `'0.0.123'` true; `'None'`, `''`, null false. Badge with `'None'` → no "Verified on blockchain" |

## Stage 2: hooks and async behaviour

| Bug | Change | Test |
|---|---|---|
| B1 | `LateDriverEvidencePanel`: focus, visibility and live events call `refetchSilent`. One handler for focus+visibilitychange is fine; the in-flight guard in `useAsyncData` dedupes anyway. | Type a note → fire `focus` → note still in the textarea, panel still mounted |
| B2 | D1 | `port.signOut` rejects → user is null, activity cleared, error logged |
| B10 | New `lib/hooks/useCopyToClipboard.ts` → `{ copied, copy(text) }`: sets `copied` only on success, logs failures with `console.warn`, clears its reset timer on unmount; reset delay is a named constant. Replace the copy code in `PhaseDetailFields`, `EvidencePhoto`, `BlockchainBadge`, `ChainReceiptTag`, `TripIdStamp`, `IssueAuditPackDialog`. `AccountDetails` already handles errors correctly; switch it too only if trivial. | Hook: success → copied true then false after the delay; rejection → copied stays false and warns; unmount clears timer. One component test that a refused copy never shows "Copied". |
| B12 | `history/page.tsx`: compute `sastToday()` when building the query and in the "narrowed" check, rather than freezing it at mount; send `search.trim()`. | Fake time past midnight → default range not reported as filtered; `"  abc "` sends `q=abc` |
| B13 | D4 in `DateRangePicker`, `sla/page.tsx`, `lib/dev/presets.ts`. | Fake clock 2026-10-22T23:30Z (01:30 SAST on the 23rd) → "Today" = 2026-10-23 |
| B14 | Fleet driver and vehicle detail pages: show "Could not load" only when there is no data (`!driver`); with data on screen and a failed refresh, keep the page and show the error inline or as a toast. Drop the `await` on `refetchSilent()` (it returns void) and leave a one-line comment that the panel closes before fresh data lands. | Data loaded → refresh fails → page content still shown |
| B15 | D5 comment only | none |

## Stage 3: visual and policy

| Bug | Change | Check |
|---|---|---|
| B3 | D2 across the 14 uses (`BlockchainBadge`, `VerifyButton`, `StatCard`, `app/(app)/page.tsx`; the `DepartureDetail` hit is a comment, fix its wording) | `grep -rn "var(--r-" app components` returns nothing; browser: badges and verify panel have rounded corners |
| B4 | D3 | `tsc`, tests; `grep -rn secondary-fixed` returns nothing |
| B16 | D7 | `/dev/tokens` loads signed out in `next dev`; still 404s in a production build |
| B17 | Remove `autoFocus` from the `PhaseOverrideAction` textarea (same reason as `CancelTripAction`). | Test does not assert focus |
| B18 | D6 | `CrewFields` test: selected driver shows licence and phone, not the ID number |

Not in this PR: the audit's "lower-risk notes" list, every §3–§7 cleanup item not named above.

## Verification (end of each stage, from `frontend/dispatcher/`)

```
npx tsc --noEmit
npx eslint .
npx vitest run
```

After Stage 3 also `npm run build`, then a browser pass on: a trip with late driver evidence (tab away and back
with a half-typed note), Exceptions history error + Return, create-trip crew card, a blockchain badge and the
verify panel, a fleet driver edit, and sign-out with the network offline.

## Hand-off

Stop after Stage 3 with all checks green. No commits (Ciaran commits). Report per stage: files changed, tests
added, check output, and anything that did not match this plan.
