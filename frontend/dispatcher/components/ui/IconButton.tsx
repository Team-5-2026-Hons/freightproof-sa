'use client'

import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  'aria-label': string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = { sm: 'w-8 h-8', md: 'w-10 h-10', lg: 'w-12 h-12' }

export function IconButton({ icon, size = 'md', className, ...props }: IconButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-xl',
        'text-surface-on-variant hover:bg-surface-container-high',
        'transition-all duration-200 active:scale-95',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  )
}
