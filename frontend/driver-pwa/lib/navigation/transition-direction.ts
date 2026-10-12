// Which way the next screen change should move — set by the control that starts the
// navigation, read once by app/(app)/template.tsx as the new screen mounts.
//
//   'forward' (default) — drilling in: the new screen enters from the trailing edge.
//   'back'              — a back control: it enters from the leading edge, so a screen
//                         leaves the way it came (emil-apple-design §7, spatial consistency).
//   'none'              — a tab switch: iOS swaps tabs in place, it does not slide them.
//
// A module-level value rather than context: it only has to survive the gap between a
// click handler and the next screen's first render, and the router API gives no way to
// attach data to a navigation.

export type TransitionDirection = 'forward' | 'back' | 'none'

let pending: TransitionDirection = 'forward'

/** Call immediately before router.push/replace/back when the move isn't a plain drill-in. */
export function markTransition(direction: TransitionDirection): void {
  pending = direction
}

/** The direction for the screen now mounting. Pure read — see resetTransition. */
export function peekTransition(): TransitionDirection {
  return pending
}

/**
 * Back to the default once the new screen has read it. Separate from peek because React
 * may run a state initialiser twice in development; resetting there would hand the
 * second run 'forward' for a back navigation.
 */
export function resetTransition(): void {
  pending = 'forward'
}
