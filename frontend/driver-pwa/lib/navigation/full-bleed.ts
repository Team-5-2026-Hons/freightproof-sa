// Lives in lib/, not app/(app)/layout.tsx: Next.js App Router forbids extra named
// exports from layout files.
//
// Routes here render their own header (a sticky StepHeader/SubpageHeader, or panic's
// bare full-bleed surface) — stacking AppShell's own sticky chrome on top produces a
// double header or, on panic, viewport overflow. Any route whose page renders
// <SubpageHeader> must have its prefix listed here or it doubles up with AppShell's bar.
const FULL_BLEED_ROUTE_PREFIXES = [
  '/panic',           // bare full-bleed emergency surface — no shell chrome at all
  '/trip/phase/',     // phase steps render their own sticky StepHeader
  '/trip/in-transit', // in-transit hub, checkpoint, and exception screens render SubpageHeader
  '/trips/',          // /trips/active and /trips/[id] render SubpageHeader
] as const

export function isFullBleedRoute(pathname: string): boolean {
  return FULL_BLEED_ROUTE_PREFIXES.some((prefix) => pathname.includes(prefix))
}
