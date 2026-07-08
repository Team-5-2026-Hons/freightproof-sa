'use client'

import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center font-bold uppercase tracking-wider',
    'rounded-xl transition-all duration-200 active:scale-[0.98]',
    'disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none',
  ),
  {
    variants: {
      variant: {
        primary:   'bg-primary text-primary-on shadow-ambient hover:opacity-90',
        // Bordered tonal style: a visible outline keeps enabled secondary buttons clearly
        // distinct from the disabled:opacity-40 state, which testers otherwise misread as disabled.
        secondary: 'bg-surface-container-lowest text-surface-on border border-outline-variant/60 shadow-ambient-sm hover:bg-surface-container-low',
        ghost:     'bg-transparent text-secondary hover:bg-secondary/10',
        danger:    'bg-error-container text-error-on-container shadow-ambient-sm hover:opacity-90',
      },
      size: {
        sm: 'px-4 py-2 text-xs min-h-[36px] gap-1.5',
        md: 'px-6 py-3 text-sm min-h-[44px] gap-2',
        lg: 'px-6 py-4 text-sm min-h-[52px] gap-2 w-full',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    iconLeft,
    iconRight,
    disabled,
    children,
    className,
    asChild = false,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp
      ref={ref}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : iconLeft}
      {children}
      {!loading && iconRight}
    </Comp>
  )
})
