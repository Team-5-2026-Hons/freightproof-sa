'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'

interface Props {
  href: string
  onClick?: () => void
  full?: boolean
  className?: string
  children: ReactNode
}

/**
 * Button's own element is a native <button> (see Button.tsx), so it cannot navigate.
 * This is the "View record" action preview modals hand off to a full page with — sized
 * and coloured identically to Button's secondary/md so it can sit in the same
 * flex-col button stack every other modal in the app uses, but a real link so returnTo
 * survives middle-click, cmd-click and "open in new tab".
 */
export function LinkButton({ href, onClick, full = false, className, children }: Props) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-[20px] py-[9px]',
        'text-[14px] font-semibold text-on-surf bg-surf-high border border-outline-v/20',
        'transition-all duration-[120ms] hover:brightness-[1.12] hover:bg-outline-v/20 active:scale-[0.97]',
        full && 'w-full',
        className,
      )}
    >
      {children}
    </Link>
  )
}
