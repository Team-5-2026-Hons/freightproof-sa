"use client"

import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Spinner } from './Spinner'
import { cn } from '@shared/lib/utils/cn'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  iconLeft?: LucideIcon
  iconRight?: LucideIcon
}

const variantClass = {
  primary:   'bg-primary text-primary-on border-2 border-outline shadow-hard hover:bg-primary-container active:translate-y-px',
  secondary: 'bg-surface-container-highest text-surface-on border-2 border-outline hover:bg-surface-container-high',
  ghost:     'bg-transparent text-secondary border-0 hover:bg-secondary-container hover:text-secondary-on-container',
  danger:    'bg-error-container text-error-on-container border-2 border-outline hover:opacity-90',
}

const sizeClass = {
  sm: 'px-3 py-1.5 text-[12px] gap-1.5',
  md: 'px-6 py-3 text-[14px] gap-2',
  lg: 'px-6 py-3.5 text-[14px] gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  iconLeft: IconLeft,
  iconRight: IconRight,
  className,
  children,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      disabled={isDisabled}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-semibold tracking-[0.006em] transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size="sm" />
      ) : IconLeft ? (
        <IconLeft size={16} strokeWidth={1.5} aria-hidden="true" />
      ) : null}
      {children}
      {!loading && IconRight && <IconRight size={16} strokeWidth={1.5} aria-hidden="true" />}
    </button>
  )
}
