import type { LocationCoords } from '@/lib/hooks/useLocation'

export const REPORT_CAPTURE_BUDGET_MS = 2_000

/**
 * Race a `useLocation().capture()` call against REPORT_CAPTURE_BUDGET_MS.
 *
 * Resolves with the fix if it arrives in time, otherwise `null` — never throws and
 * never waits longer than the budget, so a report's send is bounded whatever the GPS
 * does. A late fix is discarded rather than attached: it would describe a different
 * instant from the one the report claims. The budget timer is cleared on either
 * outcome so a fast fix leaves no dangling timeout behind.
 */
export function captureWithinBudget(
  capture: () => Promise<LocationCoords | null>,
  budgetMs: number = REPORT_CAPTURE_BUDGET_MS,
): Promise<LocationCoords | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), budgetMs)
  })
  const fix = capture()
    .catch((): null => null)
  return Promise.race([fix, expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
