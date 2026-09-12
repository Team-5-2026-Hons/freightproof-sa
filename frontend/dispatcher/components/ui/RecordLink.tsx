'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@shared/lib/utils/cn'
import { Ic } from '@/components/ui/Ic'

/**
 * The single affordance for "this names another record you can open".
 *
 * Shared as a constant so a driver, vehicle or precinct name all read the same way even
 * though most of them open a preview modal via a plain <button> rather than this
 * component directly — RecordLink itself now only backs links that navigate immediately.
 * min-h-9 is the touch target, not decoration.
 */
export const RECORD_AFFORDANCE =
  'inline-flex min-h-9 items-center gap-1 rounded-md text-left font-semibold text-sec ' +
  'underline underline-offset-4 transition-colors hover:text-on-surf ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-sec'

export function RecordLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={cn(RECORD_AFFORDANCE, className)}>
      {children}<Ic n="chev" s={12} aria-hidden />
    </Link>
  )
}
