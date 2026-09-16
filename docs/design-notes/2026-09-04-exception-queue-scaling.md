# Exception queue — scaling the list, the subscription, and the archive

> **Author:** Ciaran · **Date:** 2026-09-04 · **Status:** proposed, not implemented
> **Follows** [2026-09-03-fp146-implementation-plan.md](2026-09-03-fp146-implementation-plan.md).
> FP-146/147/148 made the exception surface real; this is what shipping it exposed.
> Every claim below was verified against the working tree on 2026-09-04 and carries the
> command that re-checks it. Line numbers move — match on content, not on the number.

## 0 · TL;DR

The exception queue re-downloads the organisation's entire exception history every time
**any** trip in the org completes **any** phase. Three fixes, in ascending order of cost:

| # | Change | Contract impact | Story |
|---|---|---|---|
| 1 | Close the emit invariant at two sites | none | small |
| 2 | Subscribe on `kind`, not on `'any'` | none | small |
| 3 | `GET /exceptions/{id}` | additive | small |
| 4 | Split queue from archive | new surface only | real story |

1–3 are shippable independently and break nothing. Only 4 is a design decision.

**The headline: pagination is not the fix.** Pagination makes each wasteful refetch
smaller. It does not make it less wasteful.

## 1 · What actually happens today

```bash
grep -n "useLiveResource" frontend/dispatcher/lib/hooks/useExceptions.ts   # :58
grep -n "order_by\|select(TripException" backend/app/orchestration/exception_service.py
```

`useExceptions.ts:58` subscribes to every trip event in the organisation:

```ts
useLiveResource('trip', 'any', refetchSilent)
```

`exception_service.list_exceptions` (`:262`) has no `LIMIT`, no date floor and no cursor
— it returns every exception ever recorded on every trip, resolved ones included.

Stack three individually-correct decisions:

1. **Both screens fetch unfiltered.** The list page needs the whole set to compute its
   open/closed tab counts client-side (correct — three separate fetches could disagree).
   The detail page fetches the whole list to find one row, because there is no
   `GET /exceptions/{id}` (`[id]/page.tsx:49-51`).
2. **`'any'` is right for a queue** that must surface a seal mismatch on a trip nobody is
   watching.
3. **`phase_completed` is the highest-frequency event on the channel** — a trip runs 7+
   phases minimum, each firing one.

Multiply them: every phase completion on any trip triggers a full-table transfer to every
open exception screen. Ten active trips moving through phases is a full history download
every few seconds.

At demo scale this is a few kilobytes and invisible. **That is exactly why it needs a
ticket now** — nothing will alert anyone as it degrades.

## 2 · The channel already carries the answer

`TripEvent` carries `kind` and `severity` (`core/realtime.py`). The hook discards both,
then refetches everything. A `phase_completed` on an unrelated trip **cannot change the
exception list**, and the client refetches anyway.

```ts
useLiveResource('trip', 'any', refetchSilent, { kinds: ['exception_raised'] })
```

Exceptions are rare relative to phase completions, so this removes the overwhelming
majority of refetches — and specifically the frequent ones. No contract change.

### 2.1 · Why the "double emit" makes this safe

Every phase-service exception site publishes **both** `PHASE_COMPLETED` (from
`_finish_phase`) and `EXCEPTION_RAISED`. That looked like redundancy during the FP-147
review. It is what makes kind-filtering complete: an exception written during a phase
transition still announces itself as an exception, so filtering on kind cannot miss it.

```bash
grep -rn "TripException(" backend/app/orchestration/      # 9 construction sites
grep -rn "kind=RealtimeKind\." backend/app/orchestration/  # 12 emit sites
```

### 2.2 · The gap that must close first

Seven of the nine `TripException` writes emit `EXCEPTION_RAISED`. **Two do not:**

| Site | Writes | Emits |
|---|---|---|
| `phase_service.py:560` (phase override) | `DISPATCHER_NOTE`, WARNING | `PHASE_COMPLETED` only (`:575`) |
| `trip_service.py:565` (cancel trip) | `DISPATCHER_NOTE`, WARNING | `TRIP_CLOSED` only (`:574`) |

Today those rows reach the queue **by accident**, on the next unrelated refetch. Under
kind-filtering they would never appear at all — a dispatcher note written during a
cancellation would silently never show up on the exceptions screen.

**So the prerequisite is an invariant, not an optimisation:**

> Every `TripException` write emits `EXCEPTION_RAISED`.

Two lines, at the two sites above. Once it holds, kind-filtering is *provably* complete
rather than probably fine. Worth a test that asserts the invariant directly — count the
constructor sites against the emit sites — so a tenth write site cannot be added silently.

## 3 · `GET /exceptions/{id}`

The detail page downloads the org's entire history to render one row. A permalink pasted
into Slack pays for every exception ever recorded.

Purely additive: new route, point `[id]/page.tsx` at it, no existing caller changes. The
`useExceptions()` call on that page goes away entirely.

## 4 · Split the resource by state, not by page

This is the part that decides whether the design survives, and it is why paginating one
undifferentiated list is the wrong instinct.

**Open and resolved exceptions have different growth curves and different access
patterns.**

Open exceptions are **bounded by operational reality**. A dispatcher cannot work a queue
of 10,000 items; if that number is climbing, the business has already failed and a
scrollbar is not the problem. The working queue is self-limiting by the process it serves.

Resolved exceptions grow without bound, forever, and are never "worked" — they are
searched, filtered by date or trip or type, and read one at a time.

| | Queue (`resolved=false`) | Archive (`resolved=true`) |
|---|---|---|
| Growth | bounded by process | unbounded |
| Access | worked top to bottom | searched |
| Pagination | **never needed** | cursor-based |
| Realtime | subscribes to `exception_raised` | none — history does not change |

### 4.1 · What this buys

**The primary working surface never needs pagination.** No "load more" on the list a
dispatcher works during an incident — which is the correct UX, because a paginated queue
is one where the row you need is on a page you have not loaded.

**Counts stay free and stay honest.** Fetch `?resolved=false` and the open count is
`.length`. It cannot disagree with the list, because it *is* the list. Only the resolved
total needs a server number, and that is one cheap `COUNT(*)`.

**The response shape survives.** The queue stays `list[TripExceptionRead]` — bounded, so
it needs no envelope. Only the archive needs `{ items, next_cursor }`, and that is a new
surface with no existing callers to break.

## 5 · Why this survives the step-event ledger

The ledger (iteration 4, see
[2026-09-02-step-event-ledger-implementation-plan.md](2026-09-02-step-event-ledger-implementation-plan.md))
shares this channel.

Under today's design it makes things strictly worse: more kinds, more `'any'` matches,
more full-table refetches. Under kind-filtering it costs nothing — the ledger adds kinds
the exceptions queue does not subscribe to. **The subscription becomes a declaration of
what a screen depends on**, which is the property you want once several features share
one channel.

It also composes with the next optimisation. Once the queue only wakes on
`exception_raised`, the natural step is to stop refetching entirely and fetch the single
new row by id — the event already carries it. That only becomes possible once the
subscription is precise. §2 is the enabling move, not just a saving.

## 6 · Rejected alternatives

**Offset pagination (`?limit=&offset=`).** On an append-at-the-top feed, rows arriving
between page 1 and page 2 shift the window: page 2 re-serves rows already seen and
silently skips others. On an evidence queue a skipped row is a missed incident, and it
fails quietly. Rejected outright.

**A rate limit as the answer.** Caps how often you pay an unbounded cost without bounding
the cost — 60 requests a minute each dragging the whole table is still the whole table.
It also throttles the app's own correct realtime behaviour, making the queue stale during
exactly the incident it exists for. (The resolve endpoint *does* now carry
`FLEET_MUTATION`, but as a blast-radius cap on a write, not as a scaling measure.)

**Truncating server-side with a silent cap.** Bounds cost and keeps the response shape,
but a dispatcher scrolling for an older exception finds nothing and gets no indication
the list was cut. Silent truncation on an evidence surface is worse than slow.

## 7 · Suggested ticket split

| Story | Scope | Depends on |
|---|---|---|
| A | Emit invariant at the two `DISPATCHER_NOTE` sites + a test asserting it | — |
| B | `kinds` option on `useLiveResource`; exceptions queue subscribes to `exception_raised` | A |
| C | `GET /exceptions/{id}`; detail page stops fetching the list | — |
| D | Queue/archive split, cursor pagination on the archive, server-side resolved count | B |

A, B and C are small and independent of D. **A must land before B** — B without A silently
hides dispatcher notes from the queue.

## 8 · Out of scope

- `useAsyncData`'s stale-`fetchFn` effect (its dependency array tracks only `timeoutMs`).
  Real, but shared by every screen; no current caller can reach it since the exception
  hook's filters were deleted on 2026-09-04. Fix it when a screen needs a changing fetch,
  with a test that *rerenders* rather than mounting fresh per case.
- POPIA: nothing here changes what the channel carries. It stays ids, a kind and a
  severity. Any per-row realtime payload would change that and is not proposed.
