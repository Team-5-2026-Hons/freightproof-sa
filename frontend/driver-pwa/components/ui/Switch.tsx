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

export function Switch({ checked, onCheckedChange, id, disabled, ...props }: SwitchProps) {
  return (
    // The track is visually 24x44px (shadcn default), but touch targets under 44px
    // fail Android/WCAG guidance — pad the hit area with a transparent border rather
    // than growing the track itself, which would look oversized next to labels.
    <SwitchPrimitive.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        'peer inline-flex h-11 w-16 shrink-0 items-center justify-center',
        'rounded-full border-8 border-transparent',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      )}
      {...props}
    >
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full',
          'transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-muted',
        )}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            'block h-5 w-5 rounded-full bg-card shadow-ambient-sm',
            'transition-transform duration-200',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  )
}
