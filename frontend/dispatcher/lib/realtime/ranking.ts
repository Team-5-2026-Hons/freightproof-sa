// How a live event turns into an alert, kept free of React imports so it can be
// unit-tested in isolation from the RealtimeProvider that uses it — the same split
// sse.ts already makes for frame parsing and backoff.
//
// This is the one place that sees every event, so it is the only place that can weigh
// one against another. It deliberately does NOT live in the toast component: a
// component that renders one toast cannot know what else arrived. §9.4's debounce
// lands here too, when the ledger starts sharing the channel.

import type { ToastData } from '@/components/ui/Toast'
import type { RealtimeEvent } from './types'

export type ToastRequest = Omit<ToastData, 'id'>

/**
 * The alert an event should raise, or null when it should pass silently.
 *
 * Ranked on `severity`, never on `kind` and never on which service published it. An
 * earlier revision encoded loudness into the kind, which meant `exception_service`
 * could not participate: every driver-raised exception published as ordinary, so a
 * panic button pressed during a hijacking reached the dispatcher quieter than an
 * automated parcel-count check. Reading the band off the event is what stops that.
 *
 * The copy names no driver, no seal number and no trip reference. The channel carries
 * an id and a kind by design (POPIA — see core/realtime.py); the dispatcher opens the
 * trip, whose page has already refetched, to see anything more. It also names no
 * actor: this kind carries system-detected findings no driver touched, and naming one
 * who did not act would be a false statement on an evidence platform.
 */
export function toastForEvent(event: RealtimeEvent): ToastRequest | null {
  // Progress is not an alert. A trip being created, a phase completing and a trip
  // closing all refetch the relevant screen without interrupting whoever is on shift.
  if (event.kind !== 'exception_raised') return null

  // INFO means the same thing on this kind as it does on every other: progress, refetch
  // silently, do not interrupt. The only INFO exception event is a RESOLUTION
  // (exception_service.resolve_exception) — so without this gate, one dispatcher closing
  // a queue item planted a sticky red "Exception raised" alert on every colleague's
  // screen, pointing at an incident that had just been CLOSED. Twenty resolutions,
  // twenty permanent false alarms, and an alert surface nobody trusts.
  if (event.severity === 'info') return null

  const critical = event.severity === 'critical'
  return {
    // 'error' is what exempts a toast from auto-dismiss (ToastContext), so an alert
    // cannot time out while nobody is at the desk. Both bands qualify: a warning the
    // dispatcher never saw is a warning that did not happen.
    kind: 'error',
    title: critical ? 'Critical exception' : 'Exception raised',
    body: critical
      ? 'A critical exception was recorded on a live trip — open it now.'
      : 'An exception was recorded on a live trip — open the trip to review.',
  }
}
