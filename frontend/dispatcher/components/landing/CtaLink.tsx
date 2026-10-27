import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface CtaLinkProps {
  href: string
  variant?: 'primary' | 'secondary' | 'quiet'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  children: ReactNode
}

/**
 * A link styled as the design system's buttons. A real <Link> rather than a <button>
 * with a router push, so cmd-click and "open in new tab" work on the way to sign-in.
 */
export function CtaLink({ href, variant = 'primary', size = 'md', className, children }: CtaLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold',
        'transition-[transform,filter,background-color] duration-150 ease-out active:scale-[0.97]',
        size === 'sm' && 'min-h-[44px] gap-[8px] px-[12px] text-[13px] sm:px-[16px] sm:text-[14px] md:min-h-[40px]',
        size === 'md' && 'min-h-[40px] px-[18px] text-[0.875rem]',
        size === 'lg' && 'min-h-[48px] px-[26px] text-[0.9375rem]',
        variant === 'primary' && 'border border-white/10 bg-gradient-to-br from-primary to-primary-container text-white hover:brightness-[1.18]',
        variant === 'secondary' && 'border border-outline-v/40 bg-surf-lowest text-on-surf hover:bg-surf-low',
        variant === 'quiet' && 'text-on-surf hover:bg-surf-high/60',
        className,
      )}
    >
      {children}
    </Link>
  )
}
