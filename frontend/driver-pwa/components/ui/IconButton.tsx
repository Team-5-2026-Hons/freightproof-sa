'use client'

import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const iconButtonVariants = cva(
  cn(
    'inline-flex items-center justify-center rounded-xl',
    'text-surface-on-variant hover:bg-surface-container-high',
    'transition-all duration-200 active:scale-95',
    'disabled:opacity-40 disabled:cursor-not-allowed',
  ),
  {
    variants: {
      // md bumped from 40px (w-10 h-10) to 44px — the WCAG/Android touch-target
      // minimum. It backs the hamburger + avatar buttons in AppShell, both of
      // which are tapped one-handed roadside.
      size: {
        sm: 'w-8 h-8',
        md: 'w-11 h-11',
        lg: 'w-12 h-12',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
)

interface IconButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  icon: ReactNode
  'aria-label': string
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = 'md', className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(iconButtonVariants({ size }), className)}
      {...props}
    >
      {icon}
    </button>
  )
})
