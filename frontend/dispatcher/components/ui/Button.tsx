'use client'

import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  full?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'text-[12px] px-[14px] py-[5px] gap-1.5',
  md: 'text-[14px] px-[20px] py-[9px] gap-1.5',
  lg: 'text-[15px] px-[28px] py-[13px] gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  full = false,
  iconLeft,
  iconRight,
  disabled,
  children,
  className,
  style,
  ...props
}: ButtonProps) {
  // Primary uses an inline gradient — cannot be expressed as a static Tailwind class.
  const isPrimary = variant === 'primary'

  return (
    <button
      disabled={disabled || loading}
      style={
        isPrimary
          ? { background: 'linear-gradient(135deg,#1b1b1c 0%,#303031 100%)', border: '1px solid rgba(255,255,255,0.08)', ...style }
          : style
      }
      className={cn(
        'inline-flex items-center justify-center font-semibold rounded-md',
        'transition-all duration-[120ms] select-none',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
        // Hover / press interactions per DESIGN_SYSTEM.md §7.1
        !disabled && !loading && 'hover:brightness-[1.12] active:scale-[0.97]',
        // Variant styles (primary handled via inline style above)
        variant === 'primary'   && 'text-white',
        variant === 'secondary' && 'bg-surf-high text-on-surf border border-outline-v/20 hover:bg-outline-v/20',
        variant === 'ghost'     && 'bg-transparent text-sec',
        variant === 'danger'    && 'bg-err text-white',
        variant === 'success'   && 'bg-ok text-white',
        sizeClasses[size],
        full && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  )
}
