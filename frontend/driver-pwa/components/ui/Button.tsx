'use client'

import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'
import { Slot, Slottable } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center font-semibold',
    'rounded-xl transition-all duration-200 active:scale-[0.98]',
    'disabled:cursor-not-allowed disabled:pointer-events-none',
  ),
  {
    variants: {
      variant: {
        primary:   'bg-primary text-primary-on hover:opacity-90 disabled:bg-surface-container-highest disabled:text-surface-on-variant',
        secondary: 'bg-surface-container-lowest text-surface-on border border-outline-variant hover:bg-surface-container-low active:bg-surface-container-low disabled:bg-surface-container-low disabled:text-surface-on-variant',
        fill:      'bg-fill text-surface-on active:bg-surface-container-high disabled:text-surface-on-variant',
        destructive: 'bg-error text-error-on active:opacity-90 disabled:opacity-40',
      },
      size: {
        sm: 'px-4 py-2 text-subhead min-h-[44px] gap-1.5',
        md: 'px-6 py-3 text-body min-h-[44px] gap-2',
        lg: 'px-6 py-4 text-body min-h-[52px] gap-2 w-full',
        pill:      'px-6 text-body min-h-[56px] gap-2 w-full rounded-full',
        'pill-sm': 'px-4 text-subhead min-h-[44px] gap-1.5 rounded-full',
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
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : iconLeft}
      {asChild ? <Slottable>{children}</Slottable> : children}
      {!loading && iconRight}
    </Comp>
  )
})
