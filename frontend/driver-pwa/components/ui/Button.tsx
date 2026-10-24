'use client'

import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react'
import { Slot, Slottable } from '@radix-ui/react-slot'
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
    // a dead control). What it is waiting for is said next to it (RequirementChips).
    'disabled:cursor-not-allowed disabled:pointer-events-none',
  ),
  {
    variants: {
      // Flat fills, no drop shadows: controls sit ON the surface like iOS
      // buttons; elevation is reserved for layers that actually float (tab bar, sheets,
      // map chips), so a shadow keeps meaning "this is above the page".
      variant: {
        primary:   'bg-primary text-primary-on hover:opacity-90 disabled:bg-surface-container-highest disabled:text-surface-on-variant',
        // The one quiet style: ink label on a white face with a full-strength hairline.
        // There is deliberately no text-only (ghost) variant any more — blue label-only
        // buttons read as web links beside the black primary, and on a phone in a cab a
        // control needs an edge to be found. Blue is kept for progress and status only.
        // active: because touch has no hover (hoverOnlyWhenSupported), the press needs
        // its own tone alongside the base scale-dip.
        secondary: 'bg-surface-container-lowest text-surface-on border border-outline-variant hover:bg-surface-container-low active:bg-surface-container-low disabled:bg-surface-container-low disabled:text-surface-on-variant',
        // Secondary action (Directions, Edit, Retake, See all): a grey face, no
        // hairline — on a white page the fill itself is the edge, as in Uber's app.
        fill:      'bg-fill text-surface-on active:bg-surface-container-high disabled:text-surface-on-variant',
        // The confirm step of an irreversible action only (Sign Out in its sheet), so
        // full-strength red means "this is the last tap".
        destructive: 'bg-error text-error-on active:opacity-90 disabled:opacity-40',
      },
      size: {
        // 44px is the app's documented touch-target minimum (see Switch/
        // SubpageHeader) — sm was 36px, below it. Padding/text stay compact; only the
        // hit area grows, so dense sm buttons (filter toggles, inline pill actions)
        // still read as "small" while staying tappable one-handed in a truck.
        sm: 'px-4 py-2 text-subhead min-h-[44px] gap-1.5',
        md: 'px-6 py-3 text-body min-h-[44px] gap-2',
        lg: 'px-6 py-4 text-body min-h-[52px] gap-2 w-full',
        // Capsules. Added, not changed: sign-in uses `lg` and must stay
        // pixel-identical, so the existing sizes keep their 14px corners. The base
        // `rounded-xl` loses to these `rounded-full`s in cn()'s merge.
        pill:      'px-6 text-body min-h-[56px] gap-2 w-full rounded-full',
        // Inline row action. The renders drew it at 36pt; it ships at the 44pt HIG
        // minimum, because a gloved thumb in a cab outranks the drawing.
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
      // Busy is not the same as unavailable: assistive tech announces it, and callers can
      // style a sending button (aria-busy:) apart from one that is waiting on input.
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
