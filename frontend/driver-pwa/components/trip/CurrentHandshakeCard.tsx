// frontend/driver-pwa/components/trip/CurrentHandshakeCard.tsx
import { ChevronDown, ArrowRight } from 'lucide-react'
import { HANDSHAKE_NAMES } from '@shared/lib/constants/handshake-meta'
import { Card } from '@/components/ui/Card'

interface CurrentHandshakeCardProps {
  handshakeNumber: 1 | 2 | 3 | 4 | 5
  onSelect: () => void
}

// Sits directly under HandshakeProgressBar's H1-H5 dots — the chevron visually
// continues from the highlighted "current" dot into this single actionable card.
// Replaces the old multi-item "Handshakes" list: only ever one handshake is shown
// at a time (see docs/superpowers/specs/2026-06-29-driver-pwa-current-handshake-only-design.md).
// Callers decide whether to render this at all — it has no "nothing to show" state.
//
// Uses the interactive Card (role="button" + Enter/Space handling already built into
// components/ui/Card.tsx) rather than Button asChild: this row's content (icon circle +
// label + trailing arrow, left-aligned, normal case) doesn't fit Button's cva, which
// always forces centered/uppercase/font-bold text — asChild would just fight that
// layout with overrides. Card's onClick path gives the same real keyboard semantics
// without the mismatch, and the colors/padding are overridden via className.
export function CurrentHandshakeCard({ handshakeNumber, onSelect }: CurrentHandshakeCardProps) {
  return (
    <div className="flex flex-col items-center">
      <ChevronDown className="h-4 w-4 text-secondary" aria-hidden />
      <Card
        variant="default"
        onClick={onSelect}
        className="w-full rounded-2xl bg-secondary-container px-4 py-3 shadow-none hover:bg-secondary-container/80"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-on">
              {handshakeNumber}
            </span>
            <span className="font-semibold text-secondary-on-container">
              {HANDSHAKE_NAMES[handshakeNumber]}
            </span>
          </div>
          <ArrowRight className="h-5 w-5 shrink-0 text-secondary" aria-hidden />
        </div>
      </Card>
    </div>
  )
}
