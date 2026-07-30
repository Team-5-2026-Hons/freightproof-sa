# Stage 5 breakage inventory — driver-pwa vs. the phase-model cut

## Why this exists

As of this commit, **`frontend/driver-pwa` does not type-check.** This is not an
accident or a regression to chase down — it is the deliberate, known cost of Stage
4.2's "clean cut": `frontend/shared/lib/types/handshake.ts` and
`frontend/shared/lib/constants/handshake-meta.ts` were deleted, `types/trip.ts`'s
`Trip`/`TripSummary` now carry `phases: PhaseDescriptor[]` and a five-value coarse
`TripStatus` instead of `handshakes: HandshakeEvent[]` and the old ten-value union,
and `constants/status-meta.ts`'s `HANDSHAKE_STATUS_META` was renamed and re-keyed to
`PHASE_STATUS_META`. The decision to cut in one commit rather than keep a
compatibility shim alongside the phase types was Ciaran's, taken 2026-07-30, so that
the dispatcher is fully integrated with the phase model without carrying two
structurally-identical `Trip` shapes. `driver-pwa` was intentionally left broken;
mapping it onto the phase types is Stage 5, owned by Tim.

## Actual file count vs. the plan's prediction

The parent plan estimated **32 files** across both dead modules. A grep for every
import of `types/handshake`, `constants/handshake-meta`, `mocks/trips`, or
`types/trip` under `driver-pwa/{app,components,lib}`, plus targeted greps for
`HandshakeEvent`, `HANDSHAKE_NAMES`, `HANDSHAKE_STATUS_META`, and `.handshakes` usage
that the path-based grep could miss, finds **32 files** — an exact match, no
discrepancy. (One additional non-code reference exists: a comment on
`driver-pwa/next.config.ts:77` names `handshake-meta.ts`; it is a code comment, not
an import, and does not fail to compile.)

## Files grouped by which shared module they lost

### Lost `@shared/lib/types/handshake` (module deleted)

- `app/(app)/trip/handshake/[h]/step/[slug]/HandshakeStepPageClient.tsx` — imports `HANDSHAKE_NAMES`, `Trip`, `TripStatus`
- `components/handshake/StepHeader.tsx` — imports `HandshakeNumber`
- `components/handshake/__tests__/StepHeader.test.tsx` — imports `HandshakeNumber`
- `components/trip/__tests__/TripDetailView.test.tsx` — imports `HandshakeEvent`, `HandshakeEventId`, `HandshakeNumber`, `HandshakeStatus`, `Trip`, `TripId`, `TripStatus`
- `lib/utils/handshake-progress.ts` — imports `HandshakeEvent`
- `lib/utils/__tests__/handshake-progress.test.ts` — imports `HandshakeEvent`, `HandshakeEventId`, `HandshakeNumber`, `HandshakeStatus`, `HandshakeType`
- `lib/hooks/useOfflineQueue.ts` — imports `HandshakeType`
- `lib/hooks/useStepIndicator.ts` — imports `HandshakeNumber`
- `lib/hooks/useHandshakeDraft.ts` — imports `HandshakeType`
- `lib/api/handshakes.ts` — imports `HandshakeType`, `Trip`

### Lost `@shared/lib/constants/handshake-meta` (module deleted)

- `app/(app)/trip/handshake/[h]/step/[slug]/HandshakeStepPageClient.tsx` — `HANDSHAKE_NAMES`
- `app/(app)/trip/handshake/[h]/step/[slug]/page.tsx` — `STEP_SLUGS`
- `app/(app)/trip/in-transit/InTransitPageClient.tsx` — `STEP_SLUGS`
- `app/(app)/trips/[id]/TripDetailPageClient.tsx` — `STEP_SLUGS`
- `app/(app)/trips/active/ActiveTripPageClient.tsx` — `STEP_SLUGS`
- `components/home/HomeContent.tsx` — `STEP_SLUGS`
- `components/handshake/StepHeader.tsx` — `STEP_SLUGS`
- `components/trip/TripDetailView.tsx` — `HANDSHAKE_NAMES`
- `components/trip/CurrentHandshakeCard.tsx` — `HANDSHAKE_NAMES`
- `components/trip/HandshakeProgressBar.tsx` — `HANDSHAKE_NAMES`
- `lib/navigation/handshake-flow.ts` — `STEP_SLUGS`
- `lib/hooks/useStepIndicator.ts` — `HANDSHAKE_NAMES`, `HANDSHAKE_STEP_COUNTS`, `STEP_NAMES`
- `lib/hooks/usePushNotifications.ts` — `STEP_SLUGS`

### Reading `Trip.phases` as `Trip.handshakes`, or importing `Trip`/`TripStatus` shapes that changed

- `app/(app)/trip/handshake/[h]/step/[slug]/HandshakeStepPageClient.tsx` — `trip.handshakes`
- `components/home/HomeContent.tsx` — `trip.handshakes`
- `components/trip/TripDetailView.tsx` — `trip.handshakes`, `import type { Trip }`
- `components/trip/__tests__/TripDetailView.test.tsx` — `trip.handshakes`, `Trip`, `TripId`, `TripStatus`
- `lib/utils/handshake-progress.ts` — `trip.handshakes`
- `lib/utils/trip-filters.ts` — `import type { Trip }`
- `lib/utils/trip-status-chip.ts` — `import type { TripStatus }` (indexes `TRIP_STATUS_META` with the old ten values)
- `lib/utils/__tests__/trip-filters.test.ts` — `Trip`, `TripId`
- `lib/context/TripContext.tsx` — `import type { Trip }`, `mockTrips`
- `lib/api/handshakes.ts` — `import type { Trip }`
- `lib/api/trips.ts` — `import type { Trip }`

### Consuming `@shared/lib/mocks/trips` (shape now phase-based, still exports the same `TRIP_00xx_ID`s and `mockTrips`)

- `app/(app)/trips/page.tsx`
- `app/(app)/trips/[id]/page.tsx`
- `app/(app)/trips/[id]/TripDetailPageClient.tsx`
- `app/(app)/trips/[id]/__tests__/TripDetailPageClient.test.tsx`
- `app/(app)/trips/active/__tests__/ActiveTripPageClient.test.tsx`
- `components/layout/ProfilePanel.tsx`
- `lib/context/TripContext.tsx`
- `lib/context/__tests__/TripContext.test.tsx`
- `lib/context/__tests__/TripContext.real.test.tsx`

(Files appear in more than one group above where they import from more than one dead
or reshaped module — that overlap is why the per-group lists sum to more than 32 while
the deduplicated file count is exactly 32.)

## Dead symbol → replacement map

| Dead symbol | Replacement |
|---|---|
| `HandshakeEvent` | `PhaseDescriptor` (`@shared/lib/types/phase`) |
| `HandshakeEventId` | `PhaseEventId` |
| `HandshakeNumber` | none — position is `sequence_number: number`, not an enum index |
| `HandshakeType` | `PhaseType` |
| `HandshakeStatus` | `PhaseStatus` |
| `HANDSHAKE_NAMES` | `PHASE_NAMES` (`@shared/lib/constants/phase-meta`) |
| `HANDSHAKE_STEP_COUNTS` | none — recipe length is `step_recipe.length`, not a static table |
| `STEP_SLUGS[1\|2\|3\|4\|5]` | `STEP_SLUGS[phase_type]` (`@shared/lib/constants/phase-meta`, keyed by `PhaseType`) |
| `STEP_NAMES[1\|2\|3\|4\|5]` | `STEP_NAMES[phase_type]` (same file, same keying change) |
| `HANDSHAKE_STATUS_META` | `PHASE_STATUS_META` (`@shared/lib/constants/status-meta`, re-keyed on `PhaseStatus`) |
| `Trip.handshakes` | `Trip.phases: PhaseDescriptor[]` — length is DATA, never assume 6 or 7 |
| `TripStatus`'s ten values (`created \| origin_gate_in \| loading \| origin_gate_out \| in_transit \| dest_gate_in \| unloading \| closed \| cancelled \| exception_hold`) | the coarse five: `created \| active \| closed \| cancelled \| exception_hold` — position within `active` comes from `Trip.phases`, never from `status` |

## Not broken by this cut, but stale and yours to hit — `TripException.handshake_event_id`

Added 2026-07-30 after Stage 4's whole-diff review. **This one does not appear in the greps above**,
because the symbol still compiles — it is a *live* field, not a deleted one. It is recorded here because
you are the developer who will hit it.

`frontend/shared/lib/types/exception.ts:43` declares:

```ts
handshake_event_id: string | null
```

The backend field is **`phase_event_id`** (`backend/app/schemas/transit.py:77`, `TripExceptionBase`). So
the shared TypeScript is describing a field the API does not send — the same class of silent lie that made
the dispatcher's trip-detail page throw before Stage 4.

**Why it was left alone:** nothing under `frontend/dispatcher` reads that field, so it is latent rather
than live, and `types/exception.ts` was outside Stage 4's declared file list. Renaming it touches
**`frontend/driver-pwa/lib/context/TripContext.tsx`**, which *does* consume it — your file, so the rename
needs you, not a drive-by from another branch.

**When you fix it:** rename to `phase_event_id` in `types/exception.ts`, then update the 9
`handshake_event_id: null` keys in `frontend/shared/lib/mocks/trips.ts` and the read in `TripContext.tsx`.
`frontend/shared/lib/constants/copy.ts:36` also still holds an unused string reading
`'Start trip · Begin Handshake 1'`.

## Fixture source for Stage 5

`frontend/shared/lib/mocks/phase-trips.ts` is the phase-shaped fixture source and
survives this cut untouched (header comment only). It exports:

- `makePhasePlan(tripId, stops, at, idPrefix)` — the one plan generator, mirroring
  the backend's `orchestration/phase_plan.build_phase_plan`. `./trips.ts` now builds
  its own mock plans by calling this directly.
- `SINGLE_LEG_PHASE_PLAN` — 7-row canonical single-leg plan fixture.
- `CROSS_DOCK_PHASE_PLAN` — 11-row canonical three-stop cross-dock plan fixture,
  proof that a phase type (`loading`/`unloading`) can occur more than once in one
  trip's plan.
- `PlanStopInput`, `SINGLE_LEG_TRIP_ID`, `CROSS_DOCK_TRIP_ID`, `SINGLE_LEG_STOPS`,
  `CROSS_DOCK_STOPS` — supporting types/fixtures for both.

`frontend/shared/lib/mocks/trips.ts` (`mockTrips` and the seven `TRIP_00xx_ID`
constants) is the other fixture source Stage 5 should reuse — it now builds
2-stop/7-row plans with `makePhasePlan` + `walkPlan`/`positionOf` helpers local to
that file, exactly the shape `driver-pwa` will need to read once it maps onto
`PhaseDescriptor`.

## The false-green trap: `node_modules` is not installed

`frontend/driver-pwa/node_modules` does not exist in this checkout. Its
`type-check` (`tsc --noEmit`), `lint` (`eslint .`), and `test` (`vitest run`, per
`package.json`) scripts all shell out to binaries that don't exist, so `npm run
type-check` etc. report `command not found` — and, because that failure is a shell
error rather than a script exit code `npm` recognises as a lint/type failure, some
CI wrappers observe `npm run <script>` **exit 0** on this failure shape. Do not
trust a green driver-pwa CI run at face value until `npm install` has actually run
in that job. **Installing dependencies is the first concrete step of Stage 5** —
without it, `npx tsc --noEmit` cannot even be attempted, and the 32-file count above
is untested against a real compiler, only against grep.
