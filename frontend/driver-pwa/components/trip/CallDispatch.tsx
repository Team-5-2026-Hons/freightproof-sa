'use client'

import { Phone } from 'lucide-react'
import { SUPPORT_PHONE } from '@/lib/constants/app'
import { cn } from '@/lib/utils'

/** Dial dispatch directly — the one thing that beats an app in an emergency. Hidden when no number is configured. */
export function CallDispatch({ className }: { className?: string }) {
  if (SUPPORT_PHONE === null) return null
  return (
    <a
      href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`}
      className={cn('flex h-14 items-center justify-center gap-2 rounded-full bg-primary text-body font-semibold text-primary-on active:scale-[0.98]', className)}
    >
      <Phone className="size-5" strokeWidth={2.2} aria-hidden />
      Call Dispatch
    </a>
  )
}

