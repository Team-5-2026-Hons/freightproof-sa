# Driver PWA — show only the current handshake (design)

## Background

Today, the Home screen and the Trips → Active trip screen both list every
"reachable" handshake as a separate tappable button/card —
`visibleHandshakeNumbers()` returns H1 through "next not-yet-started" as an
array, so once a driver finishes H1 and starts H2, *both* H1 and H2 show in
the list. Completed handshakes never drop off. The driver wants only the
single handshake they should currently act on to be shown, on both screens.

## Decisions (resolved during brainstorming)

- Exactly one handshake number is shown at a time, not a list.
- The one shown is the first handshake (H1→H5 order) that is not
  `'completed'` — i.e. the in-progress one, or if none is in progress, the
  next not-yet-started one. This includes an `'exception'`-state handshake,
  since it's by definition not completed and sits before any later upcoming
  stage.
- Once every handshake is `'completed'` (trip closed), nothing is shown —
  the section disappears entirely.
- During `in_transit` (after H3, before H4 starts), the current-handshake
  card for H4 still shows *alongside* the existing "In-Transit Hub →"
  button — no special-casing to hide it.
- Visual direction: the current-handshake card sits directly under the
  H1–H5 progress dots (`HandshakeProgressBar`), connected by a small
  downward chevron, replacing the separate "Handshakes" heading + list.
  Approved visual option: a compact card in `secondary`/`secondary-container`
  tones with a numbered badge, the handshake name, and a trailing arrow.

## Scope

In scope:
- `frontend/driver-pwa/lib/utils/handshake-progress.ts` — replace
  `visibleHandshakeNumbers` with `currentHandshakeNumber`.
- `frontend/driver-pwa/lib/utils/__tests__/handshake-progress.test.ts` —
  update for the new function.
- New `frontend/driver-pwa/components/trip/CurrentHandshakeCard.tsx` +
  test.
- `frontend/driver-pwa/components/home/HomeContent.tsx` — consume the new
  function/component.
- `frontend/driver-pwa/app/(app)/trips/active/ActiveTripPageClient.tsx` —
  same.

Out of scope (not touched):
- `HandshakeProgressBar` — unchanged, still purely renders the five dots.
- `TripContext`'s `currentHandshake`/`handshakeFromStatus` — a separate,
  pre-existing piece of state used for in-handshake step navigation
  (`StepHeader`), not for deciding what's shown on Home/Active-trip. Not
  part of this change.
- The in-transit hub flow, exception handling/resolution UI, and the
  handshake step screens themselves (H*Step components) — unaffected.
- Dispatcher frontend — this is driver-pwa only; dispatcher has its own,
  unrelated progress UI.

## Design

### `currentHandshakeNumber(progress): 1 | 2 | 3 | 4 | 5 | null`

Replaces `visibleHandshakeNumbers(progress): (1|2|3|4|5)[]`. Same input
shape (`Record<1|2|3|4|5, HandshakeStageState>` from `handshakeProgress`,
unchanged). New behavior:

```ts
export function currentHandshakeNumber(
  progress: Record<1 | 2 | 3 | 4 | 5, HandshakeStageState>,
): 1 | 2 | 3 | 4 | 5 | null {
  return STAGE_NUMBERS.find((n) => progress[n] !== 'completed') ?? null
}
```

`handshakeProgress()` itself is unchanged.

### `CurrentHandshakeCard`

New component, `components/trip/CurrentHandshakeCard.tsx`:

```ts
interface CurrentHandshakeCardProps {
  handshakeNumber: 1 | 2 | 3 | 4 | 5
  onSelect: () => void
}
```

Renders the chevron + card described in Decisions above, using
`HANDSHAKE_NAMES[handshakeNumber]` for the label. No internal state, no
data fetching — purely presentational, driven entirely by props. Callers
are responsible for checking `currentHandshakeNumber(progress) !== null`
before rendering it (the component itself doesn't handle the "nothing to
show" case — that's the caller's decision, not a visual variant of this
component).

### Consumers

Both `HomeContent.tsx` and `ActiveTripPageClient.tsx` change identically:

```tsx
const progress = handshakeProgress(trip.handshakes)
const current = currentHandshakeNumber(progress)
// ...
<HandshakeProgressBar progress={progress} />
{current !== null && (
  <CurrentHandshakeCard
    handshakeNumber={current}
    onSelect={() => router.push(ROUTES.handshakeStep(current, STEP_SLUGS[current][0]))}
  />
)}
```

The existing "Handshakes" `<section>` (heading + `.map()` over multiple
buttons/cards) is deleted from both files. The `in_transit` →
"In-Transit Hub →" button block is untouched and stays where it is,
rendered independently of the current-handshake card.

## Testing

- `handshake-progress.test.ts`: rename the `visibleHandshakeNumbers`
  describe block to `currentHandshakeNumber`; replace array assertions with
  single-value assertions covering: nothing started (→ `1`), one in
  progress (→ that number), some completed + one in progress (→ the
  in-progress one), an exception present (→ the exception's number, not
  skipped), all five completed (→ `null`).
- New `components/trip/__tests__/CurrentHandshakeCard.test.tsx`: renders
  the correct handshake number/name for a given prop, calls `onSelect` when
  clicked.
- Existing `Spec self-review` note: no backend changes, no schema changes,
  no new dependencies — this is a frontend-only presentational change.

## Out of scope reminder

This does not change how a handshake becomes `'completed'`/`'exception'`,
how the backend computes trip status, or the in-handshake step flow
(`HandshakeStepPageClient`, `StepHeader`, individual step components). It
only changes which handshake number(s) the two summary screens choose to
surface.
