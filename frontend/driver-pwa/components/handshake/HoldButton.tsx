'use client'

import { useHoldToConfirm } from '@/lib/hooks/useHoldToConfirm'
import { cn } from '@shared/lib/utils/cn'

interface HoldButtonProps {
  label: string
  durationMs?: number
  onConfirm: () => void
  disabled?: boolean
  variant?: 'primary' | 'danger'
}

export function HoldButton({
  label,
  durationMs = 2000,
  onConfirm,
  disabled = false,
  variant = 'primary',
}: HoldButtonProps) {
  const { isPressing, progress, onPressStart, onPressEnd } = useHoldToConfirm(
    durationMs,
    onConfirm,
  )

  const circumference = 2 * Math.PI * 26  // r=26
  const strokeDashoffset = circumference * (1 - progress)

  return (
    <button
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerLeave={onPressEnd}
      disabled={disabled}
      className={cn(
        'relative flex h-20 w-20 items-center justify-center rounded-full',
        'select-none touch-none transition-opacity disabled:opacity-40',
        variant === 'primary' ? 'bg-primary' : 'bg-error',
      )}
    >
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="26" fill="none" stroke="white" strokeOpacity={0.2} strokeWidth="4" />
        {isPressing && (
          <circle
            cx="30" cy="30" r="26"
            fill="none" stroke="white" strokeWidth="4"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        )}
      </svg>
      <span className="relative z-10 text-center text-xs font-bold uppercase tracking-wider text-white leading-tight px-2">
        {isPressing ? 'Hold…' : label}
      </span>
    </button>
  )
}
