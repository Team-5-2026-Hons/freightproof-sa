// frontend/driver-pwa/components/ui/LoadingScreen.tsx
//
// A whole-screen wait: nothing on the display but the loader, centred on the phone.
//
// fixed inset-0, deliberately, rather than the h-full / min-h-dvh boxes the loading states
// in this app grew up using. Neither centres reliably here:
//
//   • h-full is 100% of a parent that has no resolved height. <body> is min-h-dvh, and
//     full-bleed routes (lib/navigation/full-bleed.ts — /trips/, /trip/, /panic) render
//     without AppShell's sized frame, so the percentage falls back to auto: the box
//     shrink-wraps the loader and pins it to the TOP of the screen. That is what made the
//     trip-detail loader look like it was sitting up in the corner.
//   • min-h-dvh does centre, but inside AppShell it stacks on top of the shell's own
//     header and nav reserve, so the box runs taller than the visible area and drags the
//     loader below the middle.
//
// Measuring against the viewport works identically on both kinds of route, which is what
// lets every loading screen in the app share this one component.
//
// z-raised (10) keeps it below the BottomNav (z-sticky, 20), so on shell routes the nav
// stays visible and tappable while a trip loads — the driver is never trapped here.
import { TruckLoader } from '@/components/ui/TruckLoader'

interface LoadingScreenProps {
  /** Announced to assistive tech, e.g. "Loading trip". */
  label?: string
}

export function LoadingScreen({ label }: LoadingScreenProps) {
  return (
    <main className="fixed inset-0 z-raised flex items-center justify-center p-6">
      <TruckLoader label={label} />
    </main>
  )
}
