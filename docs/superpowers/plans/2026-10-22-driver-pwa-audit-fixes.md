# Driver PWA audit fixes: decisions and stages

**Source:** `docs/frontend-cleanup-audits-2026-10-22/2026-10-22-driver-pwa-cleanup-audit.md`.
**Scope:** `frontend/driver-pwa/` only. Not `frontend/shared/` (the `shared/lib/types/phase.ts` finding waits for
coordination), not the backend, not `package.json`, not `android/`, `ios/` or `public/sw.js`.
**Status:** decisions P1–P10 confirmed by Ciaran, 22 Oct 2026.

The audit's line numbers are a snapshot. Find each spot by symbol, and verify each row before acting on it; skip
and report any row that is already fixed or no longer true.

## Decisions on the **Confirm** rows

| # | Row (audit §) | Decision | Why |
|---|---|---|---|
| P1 | `SignaturePad` + its test (§4.1) | Delete | Superseded: the receiver now signs on their own device via `ReceiverHandover`. Git keeps it. |
| P2 | `AnchorProgress` + its test (§4.1) | Delete | No importer; nothing planned before submission. |
| P3 | `ui/Chip` + `lib/utils/trip-status-chip.ts` + tests (§4.1) | Delete the pair | Each is only used by the other or by its test. |
| P4 | `app/dev/tokens/page.tsx` (§4.1) | Delete, with `ROUTES.devTokens`, the README line, and `simulateGateArrival` if nothing else calls it | Out of date (wrong font, radii, type scale), so it misleads more than it helps. |
| P5 | `app/(app)/settings/page.tsx` redirect (§4.1) | Keep. Point `nav-items.ts` at `ROUTES.settings` instead of the literal `'/settings'`. | Installed PWAs and APKs can hold the old path; the redirect costs 20 lines. |
| P6 | `triggerPanic`, `reset` in `TripContext` (§4.2) | Delete, plus any import tsc then flags | No consumer; panic runs through `PanicPageClient`. |
| P7 | `droppedCount` / `dismissDropped` and the `OfflineBanner` block that renders them (§4.2) | Delete | Never above 0: the queue no longer drops anything. A banner that can never show is dead UI. |
| P8 | `dismissAttention` (§4.2) | Delete, and fix the comment claiming the banner offers it | Test-only; the banner offers Retry, not dismiss. |
| P9 | `SIGNED_OUT_REASON_KEY` (§4.2) | Wire it up: the login page reads it once, shows the message ("Signed in on another device."), then removes it | Small and user-visible; it explains an otherwise silent sign-out. Test first. |
| P10 | `DuskRoad` fallback on the login page (§4.2) | Delete, with the `null` branch of `WELCOME_IMAGE_SRC` | Unreachable: the constant is non-null. |

Keep, per the audit's §4.5: all legacy-migration code (queue v1, legacy exceptions, legacy drafts, quarantine,
legacy waybill photo).

## Stages (one green gate between each)

1. **Bugs (§2).**
   - B1: add every static `page.tsx` route under `app/` to `STATIC_ROUTES` (exclude dynamic `[id]` and dev routes).
     Prefer deriving the list from the `app/` tree; if that is awkward, keep it hand-written and add a vitest
     test that fails when a static page has no entry.
   - B2: check `useRotatingHandover`. If a server change to the rotation cadence really is ignored, fix it
     test-first; if not, report why and change nothing.
   - B3: delete the stale `vitest.config.ts` comment and `passWithNoTests`.
2. **Dead code (§3, §4.1–§4.4)** with P1–P10 applied. Includes the unused `tripId`/`draft` props and their test
   call sites, the aliases, the unused re-exports, `__resetQueueMigrationForTests`, `removeCapture`, the
   `Button` `danger` variant, the legacy single `supporting_artifact_id` branch, and the unused Tailwind config
   (shorthand colours, font aliases, accordion and confirm-pulse keyframes). The three §4.3 duplications go to
   the files the audit names.
3. **Mechanical comment passes (§5 P1–P6).** Comments only; one pass at a time. P6 rewords "handshake"
   wording in comments and user-visible strings. If any *identifier* still uses the old names, report it
   rather than renaming.
4. **File-by-file comments (§6): STALE rows only** (wrong file names, wrong functions, claims the code
   contradicts). Skip pure HIST/ESSAY trims unless time remains; they are the lowest value and the largest diff.

## Gate (from `frontend/driver-pwa/`)

```
npx tsc --noEmit
npx eslint .
npx vitest run
```

After stage 2, also `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` (only the `shared/` findings may
remain) and `npm run build`. Confirm the precache manifest contains the new routes. After stage 4, run the full
gate and the build again.

## Hand-off

No commits. Stage only the changed files. Report per stage, list every skipped row and why, and finish with
CLAUDE.md's TASK COMPLETE block. Suggested commit: `fix(driver-pwa): cleanup-audit findings and offline routes`.
