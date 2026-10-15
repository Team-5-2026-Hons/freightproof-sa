import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface Requirement {
  label: string
  met: boolean
}

interface RequirementChipsProps {
  requirements: readonly Requirement[]
  className?: string
}

/**
 * What a step still needs, as a row of chips beside the swipe — green with a tick when
 * done, grey with an empty ring when not. The state is also spoken ("Done:" / "Still
 * needed:"), so it is never carried by colour alone.
 */
export function RequirementChips({ requirements, className }: RequirementChipsProps) {
  if (requirements.length === 0) return null
  return (
    <ul aria-label="Needed to continue" className={cn('flex flex-wrap gap-2', className)}>
      {requirements.map(({ label, met }) => (
        <li
          key={label}
          className={cn(
            'inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-subhead font-semibold',
            met ? 'bg-success-tint text-success' : 'bg-fill text-surface-on',
          )}
        >
          {met ? (
            <Check aria-hidden className="size-3.5" strokeWidth={3} />
          ) : (
            <span aria-hidden className="size-2.5 rounded-full border-[1.5px] border-outline" />
          )}
          <span className="sr-only">{met ? 'Done: ' : 'Still needed: '}</span>
          {label}
        </li>
      ))}
    </ul>
  )
}
