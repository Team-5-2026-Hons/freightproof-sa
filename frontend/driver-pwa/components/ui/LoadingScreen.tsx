// fixed inset-0 (not h-full/min-h-dvh) centres reliably on both shell and full-bleed
// routes; z-raised keeps it below BottomNav so the nav stays usable while a trip loads.
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
