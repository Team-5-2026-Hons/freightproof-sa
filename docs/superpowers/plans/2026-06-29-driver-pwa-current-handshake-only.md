# Driver PWA — Show Only the Current Handshake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home and Trips→Active screens show exactly one handshake (the current one) instead of a growing list of every reachable handshake, with a new compact card under the H1–H5 progress dots.

**Architecture:** Replace `visibleHandshakeNumbers()` (returns an array) with `currentHandshakeNumber()` (returns a single number or `null`) in the existing `handshake-progress.ts` utility. Add one new presentational component, `CurrentHandshakeCard`, and wire it into the two existing screens in place of their old multi-item list sections. No backend, schema, or routing changes.

**Tech Stack:** Next.js 15 App Router, TypeScript 5.5+, Tailwind (existing design tokens), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-06-29-driver-pwa-current-handshake-only-design.md`

**Project note:** Per this repo's `CLAUDE.md`, Claude never runs `git commit`. Each task's "Commit" step below means: stage the listed files with `git add <files>` and report the suggested commit message — the human runs `git commit` themselves.

---

### Task 1: Rename `visibleHandshakeNumbers` to `currentHandshakeNumber`

**Files:**
- Modify: `frontend/driver-pwa/lib/utils/handshake-progress.ts`
- Test: `frontend/driver-pwa/lib/utils/__tests__/handshake-progress.test.ts`

- [ ] **Step 1: Replace the `visibleHandshakeNumbers` describe block with a failing test for `currentHandshakeNumber`**

  In `frontend/driver-pwa/lib/utils/__tests__/handshake-progress.test.ts`, the file currently ends with a `describe('visibleHandshakeNumbers', ...)` block (5 tests). Replace that entire block (leave the `handshakeProgress` describe block above it untouched) with:

  ```ts
  describe('currentHandshakeNumber', () => {
    it('returns H1 before any handshake has started', () => {
      const progress = handshakeProgress([])

      expect(currentHandshakeNumber(progress)).toBe(1)
    })

    it('returns H1 while it is in progress', () => {
      const progress = handshakeProgress([makeEvent(1, 'in_progress')])

      expect(currentHandshakeNumber(progress)).toBe(1)
    })

    it('returns H2 once H1 is completed and H2 has not started', () => {
      const progress = handshakeProgress([makeEvent(1, 'completed')])

      expect(currentHandshakeNumber(progress)).toBe(2)
    })

    it('returns H3 once H1 and H2 are completed and H3 is in progress', () => {
      const progress = handshakeProgress([
        makeEvent(1, 'completed'),
        makeEvent(2, 'completed'),
        makeEvent(3, 'in_progress'),
      ])

      expect(currentHandshakeNumber(progress)).toBe(3)
    })

    it('returns the exception stage rather than skipping past it', () => {
      const progress = handshakeProgress([
        makeEvent(1, 'completed'),
        makeEvent(2, 'exception'),
      ])

      expect(currentHandshakeNumber(progress)).toBe(2)
    })

    it('returns null once every handshake is completed', () => {
      const progress = handshakeProgress([
        makeEvent(1, 'completed'),
        makeEvent(2, 'completed'),
        makeEvent(3, 'completed'),
        makeEvent(4, 'completed'),
        makeEvent(5, 'completed'),
      ])

      expect(currentHandshakeNumber(progress)).toBeNull()
    })
  })
  ```

  Also update the top import line from:
  ```ts
  import { handshakeProgress, visibleHandshakeNumbers } from '../handshake-progress'
  ```
  to:
  ```ts
  import { handshakeProgress, currentHandshakeNumber } from '../handshake-progress'
  ```

- [ ] **Step 2: Run the test file to verify it fails**

  Run: `cd frontend/driver-pwa && npx vitest run lib/utils/__tests__/handshake-progress.test.ts`

  Expected: FAIL — `currentHandshakeNumber is not a function` (or a TypeScript import error), since the export doesn't exist yet.

- [ ] **Step 3: Replace `visibleHandshakeNumbers` with `currentHandshakeNumber` in the implementation**

  In `frontend/driver-pwa/lib/utils/handshake-progress.ts`, replace the final exported function (currently `visibleHandshakeNumbers`, with its preceding comment) with:

  ```ts
  // Which single handshake the driver should currently act on — the first stage (in
  // H1-H5 order) that isn't 'completed' yet. That's the in-progress one if there is
  // one, otherwise the next not-yet-started one, otherwise (if an earlier stage is in
  // 'exception') the exception stage itself, since 'exception' isn't 'completed'
  // either. Returns null once every stage is completed (trip closed) — nothing left
  // to show.
  export function currentHandshakeNumber(
    progress: Record<1 | 2 | 3 | 4 | 5, HandshakeStageState>,
  ): 1 | 2 | 3 | 4 | 5 | null {
    return STAGE_NUMBERS.find((n) => progress[n] !== 'completed') ?? null
  }
  ```

  The rest of the file (the `HandshakeStageState` type, `STAGE_NUMBERS` constant, and `handshakeProgress` function) is unchanged.

- [ ] **Step 4: Run the test file to verify it passes**

  Run: `cd frontend/driver-pwa && npx vitest run lib/utils/__tests__/handshake-progress.test.ts`

  Expected: PASS — all tests in both describe blocks green.

- [ ] **Step 5: Stage the change**

  ```bash
  git add frontend/driver-pwa/lib/utils/handshake-progress.ts frontend/driver-pwa/lib/utils/__tests__/handshake-progress.test.ts
  ```

  Suggested commit message: `refactor(driver-pwa): replace visibleHandshakeNumbers with currentHandshakeNumber`

---

### Task 2: Add the `CurrentHandshakeCard` component

**Files:**
- Create: `frontend/driver-pwa/components/trip/CurrentHandshakeCard.tsx`
- Test: `frontend/driver-pwa/components/trip/__tests__/CurrentHandshakeCard.test.tsx`

- [ ] **Step 1: Write the failing test**

  Create `frontend/driver-pwa/components/trip/__tests__/CurrentHandshakeCard.test.tsx`:

  ```tsx
  import { render, screen, fireEvent } from '@testing-library/react'
  import { describe, it, expect, vi } from 'vitest'
  import { CurrentHandshakeCard } from '../CurrentHandshakeCard'

  describe('CurrentHandshakeCard', () => {
    it('renders the handshake number and name', () => {
      render(<CurrentHandshakeCard handshakeNumber={2} onSelect={vi.fn()} />)

      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('Loading')).toBeInTheDocument()
    })

    it('calls onSelect when clicked', () => {
      const onSelect = vi.fn()
      render(<CurrentHandshakeCard handshakeNumber={3} onSelect={onSelect} />)

      fireEvent.click(screen.getByRole('button'))

      expect(onSelect).toHaveBeenCalledTimes(1)
    })
  })
  ```

- [ ] **Step 2: Run the test to verify it fails**

  Run: `cd frontend/driver-pwa && npx vitest run components/trip/__tests__/CurrentHandshakeCard.test.tsx`

  Expected: FAIL — cannot find module `../CurrentHandshakeCard` (file doesn't exist yet).

- [ ] **Step 3: Create the component**

  Create `frontend/driver-pwa/components/trip/CurrentHandshakeCard.tsx`:

  ```tsx
  // frontend/driver-pwa/components/trip/CurrentHandshakeCard.tsx
  import { ChevronDown, ArrowRight } from 'lucide-react'
  import { HANDSHAKE_NAMES } from '@shared/lib/constants/handshake-meta'

  interface CurrentHandshakeCardProps {
    handshakeNumber: 1 | 2 | 3 | 4 | 5
    onSelect: () => void
  }

  // Sits directly under HandshakeProgressBar's H1-H5 dots — the chevron visually
  // continues from the highlighted "current" dot into this single actionable card.
  // Replaces the old multi-item "Handshakes" list: only ever one handshake is shown
  // at a time (see docs/superpowers/specs/2026-06-29-driver-pwa-current-handshake-only-design.md).
  // Callers decide whether to render this at all — it has no "nothing to show" state.
  export function CurrentHandshakeCard({ handshakeNumber, onSelect }: CurrentHandshakeCardProps) {
    return (
      <div className="flex flex-col items-center">
        <ChevronDown className="h-4 w-4 text-secondary" aria-hidden />
        <button
          onClick={onSelect}
          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-secondary-container px-4 py-3 text-left transition-colors duration-150 hover:bg-secondary-container/80"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-on">
              {handshakeNumber}
            </span>
            <span className="font-semibold text-secondary-on-container">
              {HANDSHAKE_NAMES[handshakeNumber]}
            </span>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-secondary" aria-hidden />
        </button>
      </div>
    )
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  Run: `cd frontend/driver-pwa && npx vitest run components/trip/__tests__/CurrentHandshakeCard.test.tsx`

  Expected: PASS — both tests green.

- [ ] **Step 5: Stage the change**

  ```bash
  git add frontend/driver-pwa/components/trip/CurrentHandshakeCard.tsx frontend/driver-pwa/components/trip/__tests__/CurrentHandshakeCard.test.tsx
  ```

  Suggested commit message: `feat(driver-pwa): add CurrentHandshakeCard component`

---

### Task 3: Wire `CurrentHandshakeCard` into the Home screen

**Files:**
- Modify: `frontend/driver-pwa/components/home/HomeContent.tsx`

- [ ] **Step 1: Replace imports**

  Current imports block:
  ```tsx
  import { useRouter } from 'next/navigation'
  import { PackageSearch } from 'lucide-react'
  import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
  import { ROUTES } from '@/lib/constants/routes'
  import { useTrip } from '@/lib/hooks/useTrip'
  import { tripStatusChip } from '@/lib/utils/trip-status-chip'
  import { handshakeProgress, visibleHandshakeNumbers } from '@/lib/utils/handshake-progress'
  import { Chip } from '@/components/ui/Chip'
  import { Button } from '@/components/ui/Button'
  import { EmptyState } from '@/components/ui/EmptyState'
  import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'
  ```

  Replace with:
  ```tsx
  import { useRouter } from 'next/navigation'
  import { PackageSearch } from 'lucide-react'
  import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
  import { ROUTES } from '@/lib/constants/routes'
  import { useTrip } from '@/lib/hooks/useTrip'
  import { tripStatusChip } from '@/lib/utils/trip-status-chip'
  import { handshakeProgress, currentHandshakeNumber } from '@/lib/utils/handshake-progress'
  import { Chip } from '@/components/ui/Chip'
  import { EmptyState } from '@/components/ui/EmptyState'
  import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'
  import { CurrentHandshakeCard } from '@/components/trip/CurrentHandshakeCard'
  ```

  (`HANDSHAKE_NAMES` and `Button` are dropped — no longer used in this file; `STEP_SLUGS` is kept for the route below.)

- [ ] **Step 2: Replace the progress/visibility calculation**

  Current:
  ```tsx
  const { kind, label } = tripStatusChip(trip.status)
  const progress = handshakeProgress(trip.handshakes)
  const visibleHandshakes = visibleHandshakeNumbers(progress)
  ```

  Replace with:
  ```tsx
  const { kind, label } = tripStatusChip(trip.status)
  const progress = handshakeProgress(trip.handshakes)
  const current = currentHandshakeNumber(progress)
  ```

- [ ] **Step 3: Replace the "Handshakes" section**

  Current:
  ```tsx
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-surface-on-variant">Handshakes</h2>
        {visibleHandshakes.map((n) => (
          <Button
            key={n}
            variant="primary"
            size="lg"
            className="justify-start"
            onClick={() => router.push(ROUTES.handshakeStep(n, STEP_SLUGS[n][0]))}
          >
            <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
          </Button>
        ))}
      </section>
  ```

  Replace with:
  ```tsx
      {current !== null && (
        <CurrentHandshakeCard
          handshakeNumber={current}
          onSelect={() => router.push(ROUTES.handshakeStep(current, STEP_SLUGS[current][0]))}
        />
      )}
  ```

  Leave the `<HandshakeProgressBar progress={progress} />` line and the `in_transit` → "In-Transit Hub →" `<button>` block exactly where they are, unchanged, both directly above this new block (matches the file's existing order).

- [ ] **Step 4: Manually verify the file compiles and the unused-import lint is clean**

  Run: `cd frontend/driver-pwa && npx tsc --noEmit`

  Expected: no errors referencing `HomeContent.tsx`.

  Run: `cd frontend/driver-pwa && npx eslint components/home/HomeContent.tsx`

  Expected: no `no-unused-vars` warnings for `HANDSHAKE_NAMES` or `Button`.

- [ ] **Step 5: Stage the change**

  ```bash
  git add frontend/driver-pwa/components/home/HomeContent.tsx
  ```

  Suggested commit message: `feat(driver-pwa): show only the current handshake on the Home screen`

---

### Task 4: Wire `CurrentHandshakeCard` into the Trips → Active screen

**Files:**
- Modify: `frontend/driver-pwa/app/(app)/trips/active/ActiveTripPageClient.tsx`

- [ ] **Step 1: Replace imports**

  Current imports block:
  ```tsx
  import { useRouter } from 'next/navigation'
  import { HANDSHAKE_NAMES, STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
  import { ROUTES } from '@/lib/constants/routes'
  import { useTrip } from '@/lib/hooks/useTrip'
  import { tripStatusChip } from '@/lib/utils/trip-status-chip'
  import { handshakeProgress, visibleHandshakeNumbers } from '@/lib/utils/handshake-progress'
  import { Card } from '@/components/ui/Card'
  import { Chip } from '@/components/ui/Chip'
  import { Button } from '@/components/ui/Button'
  import { Spinner } from '@/components/ui/Spinner'
  import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'
  ```

  Replace with:
  ```tsx
  import { useRouter } from 'next/navigation'
  import { STEP_SLUGS } from '@shared/lib/constants/handshake-meta'
  import { ROUTES } from '@/lib/constants/routes'
  import { useTrip } from '@/lib/hooks/useTrip'
  import { tripStatusChip } from '@/lib/utils/trip-status-chip'
  import { handshakeProgress, currentHandshakeNumber } from '@/lib/utils/handshake-progress'
  import { Card } from '@/components/ui/Card'
  import { Chip } from '@/components/ui/Chip'
  import { Button } from '@/components/ui/Button'
  import { Spinner } from '@/components/ui/Spinner'
  import { HandshakeProgressBar } from '@/components/trip/HandshakeProgressBar'
  import { CurrentHandshakeCard } from '@/components/trip/CurrentHandshakeCard'
  ```

  (`HANDSHAKE_NAMES` is dropped. `Card` and `Button` stay — `Card` is still used for the "Status" section above, and `Button` is still used for the "In-Transit Hub →" button further down.)

- [ ] **Step 2: Replace the progress/visibility calculation**

  Current:
  ```tsx
    const { kind, label } = tripStatusChip(trip.status)
    const progress = handshakeProgress(trip.handshakes)
    const visibleHandshakes = visibleHandshakeNumbers(progress)
  ```

  Replace with:
  ```tsx
    const { kind, label } = tripStatusChip(trip.status)
    const progress = handshakeProgress(trip.handshakes)
    const current = currentHandshakeNumber(progress)
  ```

- [ ] **Step 3: Replace the "Handshakes" section**

  Current:
  ```tsx
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-surface-on-variant">Handshakes</h2>
          {visibleHandshakes.map((n) => (
            <Card
              key={n}
              variant="dark"
              onClick={() => router.push(ROUTES.handshakeStep(n, STEP_SLUGS[n][0]))}
            >
              <span className="font-semibold">H{n}:</span> {HANDSHAKE_NAMES[n]}
            </Card>
          ))}
        </section>
  ```

  Replace with:
  ```tsx
        {current !== null && (
          <CurrentHandshakeCard
            handshakeNumber={current}
            onSelect={() => router.push(ROUTES.handshakeStep(current, STEP_SLUGS[current][0]))}
          />
        )}
  ```

  Leave the `<HandshakeProgressBar progress={progress} />` line and the `in_transit` → "In-Transit Hub →" `<Button>` block exactly where they are, unchanged, both directly above this new block.

- [ ] **Step 4: Manually verify the file compiles and the unused-import lint is clean**

  Run: `cd frontend/driver-pwa && npx tsc --noEmit`

  Expected: no errors referencing `ActiveTripPageClient.tsx`.

  Run: `cd frontend/driver-pwa && npx eslint app/'(app)'/trips/active/ActiveTripPageClient.tsx`

  Expected: no `no-unused-vars` warning for `HANDSHAKE_NAMES`; no warning for `Card`/`Button` (both still used elsewhere in the file).

- [ ] **Step 5: Stage the change**

  ```bash
  git add "frontend/driver-pwa/app/(app)/trips/active/ActiveTripPageClient.tsx"
  ```

  Suggested commit message: `feat(driver-pwa): show only the current handshake on the active trip screen`

---

### Task 5: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full driver-pwa test suite**

  Run: `cd frontend/driver-pwa && npx vitest run`

  Expected: all test files pass, including the two touched/added in Tasks 1–2 (`handshake-progress.test.ts`, `CurrentHandshakeCard.test.tsx`) and all pre-existing tests (no regressions).

- [ ] **Step 2: Typecheck the whole project**

  Run: `cd frontend/driver-pwa && npx tsc --noEmit`

  Expected: no errors.

- [ ] **Step 3: Grep for any remaining reference to the removed function**

  Run: `cd frontend/driver-pwa && grep -rn "visibleHandshakeNumbers" . --include="*.ts*" | grep -v node_modules`

  Expected: no output (every call site was updated in Tasks 1, 3, 4).

- [ ] **Step 4: Manual smoke test (driver PWA dev server)**

  Run: `cd frontend/driver-pwa && npm run dev`, open `http://localhost:3001`, sign in as the test driver, and load the trip used in earlier testing (status `origin_gate_in`, i.e. H1 done, H2 in progress).

  Expected:
  - Home screen shows the H1–H5 dot stepper with H1 marked done, then directly below it a single card reading "2 · Loading" (no H1 entry, no list).
  - Tapping the card navigates to H2's first step (`/trip/handshake/2/step/1-arrive-bay`).
  - The Trips → Active screen (tap "My Trips" → the Active tab → into the trip) shows the same single-card behavior.
  - Once H2 also completes, the card updates to show H3, and so on; once H5 completes, the card disappears (no card, no error) on both screens.

  This step is not automatable from this plan (depends on live backend state) — report what you observed instead of assuming pass.

---

## Self-Review Notes

- **Spec coverage:** rename matches spec Decision 2 (Task 1); component matches Decision 4's visual direction (Task 2); both consumer wiring tasks match spec's "Consumers" section (Tasks 3–4); the in-transit/H4 alongside-hub-button decision is preserved by explicitly *not* touching that block in Tasks 3–4 Step 3. `HandshakeProgressBar` is explicitly left untouched per spec's "Out of scope."
- **No placeholders:** every step has literal file content, not descriptions.
- **Type consistency:** `currentHandshakeNumber` returns `1 | 2 | 3 | 4 | 5 | null` consistently across Task 1 (definition), Task 3/4 (consumption with `current !== null` guard before passing to `CurrentHandshakeCard`, which itself requires non-null `1 | 2 | 3 | 4 | 5`).
