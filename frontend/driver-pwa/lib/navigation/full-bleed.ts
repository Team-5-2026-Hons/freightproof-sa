// Lives in lib/ (not app/(app)/layout.tsx) because Next.js App Router forbids
// extra named exports from layout files — the generated .next/types check
// rejects anything beyond default/metadata/etc. Keeping the predicate here lets
// both the layout and its regression tests import it.

// AppShell's header is in normal layout flow (not overlaid), so it always adds
// its own height on top of whatever the page renders. Panic and handshake-step
// pages already own their full layout (panic is a bare full-bleed emergency
// surface; handshake steps render their own sticky StepHeader with real
// back-navigation) — stacking AppShell's chrome on top causes viewport
// overflow on panic (pushing the cancel link below the fold). The remaining
// prefixes below cover every subpage that renders components/layout/SubpageHeader
// (its own sticky header) — stacking AppShell's sticky bar on top of that produces
// a redundant double sticky header. Exempt all of them from AppShell entirely.
//
// Invariant: any route whose page renders <SubpageHeader> (directly or via a
// shared view component) MUST have its prefix listed here, or it doubles up with
// AppShell's own sticky bar. Adding a new SubpageHeader-based screen without adding
// its prefix here reintroduces the exact bug this constant exists to prevent.
const FULL_BLEED_ROUTE_PREFIXES = [
  '/panic',          // bare full-bleed emergency surface (PanicPageClient + submitted) — no shell chrome at all
  '/handshake/',     // handshake steps render their own sticky StepHeader
  '/trip/in-transit', // in-transit hub, checkpoint, and exception screens all render SubpageHeader
  '/trips/',         // /trips/active and /trips/[id] render SubpageHeader (bare /trips list does not — it keeps AppShell)
] as const

export function isFullBleedRoute(pathname: string): boolean {
  return FULL_BLEED_ROUTE_PREFIXES.some((prefix) => pathname.includes(prefix))
}
