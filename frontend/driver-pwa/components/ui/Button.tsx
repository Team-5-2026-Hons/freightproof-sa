'use client'

import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:   'bg-primary text-primary-on shadow-ambient hover:opacity-90',
  secondary: 'bg-surface-container-highest text-surface-on hover:bg-surface-container-high',
  ghost:     'bg-transparent text-secondary hover:bg-secondary/10',
  danger:    'bg-error-container text-error-on-container shadow-ambient-sm hover:opacity-90',
}

const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-4 py-2 text-xs min-h-[36px] gap-1.5',
  md: 'px-6 py-3 text-sm min-h-[44px] gap-2',
  lg: 'px-6 py-4 text-sm min-h-[52px] gap-2 w-full',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  disabled,
  children,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-bold uppercase tracking-wider',
        'rounded-xl transition-all duration-200 active:scale-[0.98]',
        'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
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
