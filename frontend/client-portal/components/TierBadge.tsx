import type { EvidenceTier } from '@/lib/types'

// DESIGN_SYSTEM.md: chain palette is reserved for anchored facts; declared is dashed so
// it can never be mistaken for something the system captured itself.
const STYLE: Record<EvidenceTier, { label: string; className: string; meaning: string }> = {
  anchored: {
    label: 'Anchored', className: 'bg-chain-c text-chain-on',
    meaning: 'Hash recorded on the Hedera public ledger; re-verifiable by anyone.',
  },
  corroborated: {
    label: 'Corroborated', className: 'bg-sec-c text-sec-on',
    meaning: 'Independent sources agreed at the time; not anchored.',
  },
  recorded: {
    label: 'Recorded', className: 'bg-surf-high text-muted',
    meaning: "FreightProof's own record, captured at the time; not anchored.",
  },
  declared: {
    label: 'Declared', className: 'border border-dashed border-warn text-warn',
    meaning: 'Entered by the operator after the event.',
  },
}

export const TIER_ORDER: EvidenceTier[] = ['anchored', 'corroborated', 'recorded', 'declared']

export function tierMeaning(tier: EvidenceTier): string {
  return STYLE[tier].meaning
}

export function TierBadge({ tier }: { tier: EvidenceTier }) {
  const style = STYLE[tier]
  return (
    <span
      title={style.meaning}
      className={`inline-block rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${style.className}`}
    >
      {style.label}
    </span>
  )
}
