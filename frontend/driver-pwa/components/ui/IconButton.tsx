"use client"

import type { ButtonHTMLAttributes } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  'aria-label': string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClass = { sm: 'h-8 w-8', md: 'h-10 w-10', lg: 'h-12 w-12' }
const iconSize  = { sm: 16, md: 20, lg: 24 }

export function IconButton({ icon: Icon, size = 'md', className, ...rest }: IconButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-lg text-surface-on',
        'hover:bg-surface-container-high transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-40',
        sizeClass[size],
        className,
      )}
      {...rest}
    >
      <Icon size={iconSize[size]} strokeWidth={1.5} aria-hidden="true" />
    </button>
  )
}
