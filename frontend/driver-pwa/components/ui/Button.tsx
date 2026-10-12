'use client'

import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Title-style labels at semibold (iOS button voice), not the old bold uppercase with wide
// tracking — that read as a Material/Android control on the iPhones this app is demoed on.
// Callers write the label in Title Case ("Arrive at Destination"); nothing transforms it.
const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center font-semibold',
    'rounded-xl transition-all duration-200 active:scale-[0.98]',
    // Disabled reads as "not yet", not "broken": each variant gets a full-strength muted
    // look below instead of the whole button faded to 40% (2.6:1, which drivers took for
    // a dead control). What it is waiting for is said next to it (RequirementChecklist).
    'disabled:cursor-not-allowed disabled:pointer-events-none',
  ),
  {
    variants: {
      // Flat fills, no drop shadows (audit M10): controls sit ON the surface like iOS
      // buttons; elevation is reserved for layers that actually float (tab bar, sheets,
      // map chips), so a shadow keeps meaning "this is above the page".
      variant: {
        primary:   'bg-primary text-primary-on hover:opacity-90 disabled:bg-surface-container-highest disabled:text-surface-on-variant',
        // Bordered tonal style: a visible outline keeps enabled secondary buttons clearly
        // distinct from the disabled:opacity-40 state, which testers otherwise misread as disabled.
        secondary: 'bg-surface-container-lowest text-surface-on border border-outline-variant/60 hover:bg-surface-container-low disabled:bg-surface-container-low disabled:text-surface-on-variant',
        ghost:     'bg-transparent text-secondary hover:bg-secondary/10 disabled:text-surface-on-variant',
        danger:    'bg-error-container text-error-on-container hover:opacity-90 disabled:opacity-40',
      },
      size: {
        // 44px is the app's documented touch-target minimum (see IconButton/Switch/
        // SubpageHeader) — sm was 36px, below it. Padding/text stay compact; only the
        // hit area grows, so dense sm buttons (filter toggles, inline pill actions)
        // still read as "small" while staying tappable one-handed in a truck.
        sm: 'px-4 py-2 text-subhead min-h-[44px] gap-1.5',
        md: 'px-6 py-3 text-body min-h-[44px] gap-2',
        lg: 'px-6 py-4 text-body min-h-[52px] gap-2 w-full',
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
