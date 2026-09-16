import type { LocationCoords } from '@/lib/hooks/useLocation'

// The longest an emergency or exception report waits for the phone's own fix before
// sending without one. Native lock is typically well under this (the panic page
// measured ~300 ms dev / <2 s real), while useLocation's own 10 s geolocation timeout
// is far too long to hold a panic or a broken-seal report behind. Anything slower is
// treated as "no fix right now": the report goes, and the location is simply absent.
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
    // useLocation.capture() already resolves null on failure; this only guards a
    // caller passing a rejecting implementation, so the race can never reject.
    .catch((): null => null)
  return Promise.race([fix, expiry]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}
