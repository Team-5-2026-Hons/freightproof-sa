import { cn } from '@shared/lib/utils/cn'

// The FreightProof mark: a shield with a tick, then the wordmark. Two colours only, from
// DESIGN_SYSTEM.md: white and the brand blue (sec, #0051d5). The blue is always the shield;
// on paper "Proof" takes it too (6.35:1). On a dark photo the system blue measures about
// 2:1, too low for text, so there the whole wordmark is white and the shield carries the blue.

export type LogoTone = 'on-dark' | 'on-light'

interface Props {
  tone: LogoTone
  /** Wordmark size; the shield scales with it. */
  size?: 'md' | 'lg'
  className?: string
}

const SIZES = {
  md: { mark: 'size-7', text: 'text-[22px]' },
  lg: { mark: 'size-9', text: 'text-[28px]' },
} as const

/** The shield-with-tick mark: a solid blue shield with a white check. */
export function FreightProofMark({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <path className="fill-sec" d="M16 2.6 5.2 6.5c-.6.2-1 .8-1 1.4v7.2c0 6.9 4.7 12.4 11.3 14.7.3.1.7.1 1 0 6.6-2.3 11.3-7.8 11.3-14.7V7.9c0-.6-.4-1.2-1-1.4L16 2.6Z" />
      <path className="stroke-white" d="m10.8 16.1 3.6 3.6 7-7.4" fill="none" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** FreightProof mark + wordmark. `tone` is the background it sits on. */
export function FreightProofLogo({ tone, size = 'md', className }: Props): React.JSX.Element {
  const s = SIZES[size]
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <FreightProofMark className={s.mark} />
      <span className={cn('font-[800] leading-none tracking-[-0.035em]', s.text, tone === 'on-dark' ? 'text-white' : 'text-on-surf')}>
        Freight<span className={tone === 'on-dark' ? undefined : 'text-sec'}>Proof</span>
      </span>
    </span>
  )
}
