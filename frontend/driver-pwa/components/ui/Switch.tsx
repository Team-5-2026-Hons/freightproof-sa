'use client'

import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (v: boolean) => void
  'aria-label'?: string
  id?: string
  disabled?: boolean
}

// iOS switch proportions — 51×31 track, 27px thumb inset 2px — so the one toggle in the
// app reads as the platform control a driver already knows, not a web lookalike.
export function Switch({ checked, onCheckedChange, id, disabled, ...props }: SwitchProps) {
  return (
    // The Root is the 44px hit area (HIG minimum); the visible track sits centred inside
    // it, so the control looks native-sized while staying easy to hit in gloves.
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'peer inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-full',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
      {...props}
    >
      <span
        className={cn(
          'relative inline-flex h-[31px] w-[51px] shrink-0 items-center rounded-full',
          'transition-colors duration-200',
          // Off: a step darker than any card it sits on, plus a hairline ring, so the
          // off state always shows a track.
          checked
            ? 'bg-secondary'
            : 'bg-surface-container-highest ring-1 ring-inset ring-outline-variant',
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            // White in both themes, as on iOS: a theme-toned thumb went dark-on-dark at
            // night and vanished into the track.
            'block h-[27px] w-[27px] rounded-full bg-white shadow-level-3',
            'transition-transform duration-200 ease-out motion-reduce:transition-none',
            checked ? 'translate-x-[22px]' : 'translate-x-[2px]',
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  )
}
