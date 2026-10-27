'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ROUTES } from '@/lib/constants/routes'
import { cn } from '@shared/lib/utils/cn'
import styles from './landing.module.css'

export const COOKIE_NOTICE_KEY = 'fp:cookie-notice-seen'

/**
 * A notice, not a consent prompt. The site uses only first-party browser storage that is
 * strictly necessary (the sign-in session, idle sign-out) or a display preference the
 * visitor set themselves (see the Cookie Notice page for the full list), so there's
 * nothing to opt in to. A Reject button would offer a choice that doesn't exist. If analytics or any
 * other non-essential storage is ever added, this has to become a real opt-in first.
 */
export function CookieNotice() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let seen = false
    try {
      seen = window.localStorage.getItem(COOKIE_NOTICE_KEY) === '1'
    } catch {
      seen = false
    }
    if (!seen) {
      const frame = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(frame)
    }
  }, [])

  function dismiss(): void {
    setVisible(false)
    try {
      window.localStorage.setItem(COOKIE_NOTICE_KEY, '1')
    } catch {
    }
  }

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      aria-hidden={!visible}
      inert={!visible}
      className={cn(
        styles.notice,
        styles.glass,
        !visible && styles.noticeHidden,
        !visible && 'pointer-events-none',
        'fixed inset-x-4 bottom-4 z-overlay max-w-[420px] rounded-xl border border-outline-v/40 bg-surf/85 p-5 shadow-level-5 backdrop-blur-xl sm:left-6 sm:right-auto sm:bottom-6',
      )}
    >
      <p className="text-[0.875rem] leading-relaxed text-on-surf">
        We only use essential browser storage, to keep you signed in and remember your display
        settings. There’s no tracking and no advertising cookies.
      </p>
      <div className="mt-4 flex items-center justify-between gap-3">
        <Link
          href={ROUTES.legalCookies}
          tabIndex={visible ? undefined : -1}
          className="inline-flex min-h-[44px] items-center text-[0.875rem] font-semibold text-sec underline-offset-[3px] hover:underline"
        >
          Cookie notice
        </Link>
        <button
          type="button"
          onClick={dismiss}
          tabIndex={visible ? undefined : -1}
          className="min-h-[44px] rounded-md bg-gradient-to-br from-primary to-primary-container px-5 text-[0.875rem] font-semibold text-white transition-transform duration-150 active:scale-[0.97]"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
