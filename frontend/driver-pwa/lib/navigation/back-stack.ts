// Where "back" goes: the screen the driver actually came from, not a hard-coded parent.
//
// Every back control used to push a fixed destination (In Transit → Trip Detail, Trip
// Detail → Trips), so a driver who opened In Transit from Home was sent somewhere they had
// never been. This keeps a small stack of the screens visited since the last tab switch,
// recorded by app/(app)/template.tsx as each screen mounts.
//
// Not the browser history: the app navigates by explicit pushes (a submitted form pushes
// In Transit again; a finished phase pushes Home), so raw history is full of screens a
// driver must never land back on. Instead:
//   - a tab switch starts a fresh stack (tabs are roots, as on iOS);
//   - visiting a screen already on the stack cuts back to it, so a form that returns to
//     In Transit leaves no form behind it;
//   - back skips transient screens (phase steps, panic): once a phase is submitted its
//     steps are done, and stepping back into one would only bounce off the step gate.

import { ROUTES } from '@/lib/constants/routes'
import { PHASE_STEP_PREFIX } from '@/lib/phase/routes'
import type { TransitionDirection } from '@/lib/navigation/transition-direction'

interface StackEntry {
  /** Compared to decide "already on the stack". */
  pathname: string
  /** What back navigates to — the pathname plus any query (trip detail's ?id=). */
  url: string
}

let stack: StackEntry[] = []

function isTransient(pathname: string): boolean {
  return pathname.startsWith(PHASE_STEP_PREFIX) || pathname.startsWith(ROUTES.panic)
}

/** Called once per screen as it mounts, with the direction the navigation was marked. */
export function recordScreen(pathname: string, url: string, direction: TransitionDirection): void {
  const entry = { pathname, url }
  if (direction === 'none') {
    stack = [entry]
    return
  }
  const at = stack.map((e) => e.pathname).lastIndexOf(pathname)
  if (at >= 0) {
    stack = [...stack.slice(0, at), entry]
  } else if (direction === 'back') {
    // Going back to a screen the stack never saw (the fallback after a cold start) lands
    // BEHIND everything known, so it becomes the root. Appending it instead made the screen
    // just left look like its predecessor: In Transit ⇄ Trip looped with no tab bar to escape.
    stack = [entry]
  } else {
    stack = [...stack, entry]
  }
}

/** The nearest earlier, non-transient screen, or null on a cold start or deep link. */
export function previousScreen(): string | null {
  for (let i = stack.length - 2; i >= 0; i--) {
    if (!isTransient(stack[i].pathname)) return stack[i].url
  }
  return null
}

/** The nearest earlier, non-transient screen — or `fallback` on a cold start or deep link. */
export function backTarget(fallback: string): string {
  return previousScreen() ?? fallback
}

/** Test-only reset; the stack is module state that would otherwise leak between tests. */
export function resetBackStack(): void {
  stack = []
}
