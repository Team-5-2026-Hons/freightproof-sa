'use client'

import { cn } from '@shared/lib/utils/cn'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  ariaLabel: string
  className?: string
}

// Reusable on/off switch — visual style matches the existing "Active" toggle on the
// vehicle/driver edit pages, but adds the role/aria-checked semantics that one lacks.
export function Switch({ checked, onCheckedChange, ariaLabel, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative w-[40px] h-[22px] rounded-full transition-colors duration-200 shrink-0',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-chain/40 focus-visible:ring-offset-2',
        checked ? 'bg-ok' : 'bg-outline-v',
        className,
      )}
    >
      <span
        className="absolute top-[3px] w-[16px] h-[16px] rounded-full bg-white shadow transition-all duration-200"
        style={{ left: checked ? '21px' : '3px' }}
      />
    </button>
  )
}
