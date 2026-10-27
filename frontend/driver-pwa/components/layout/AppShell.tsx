'use client'

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { OfflineBanner } from './OfflineBanner'
import { BottomNav } from './BottomNav'

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Home',
  '/trips': 'Trips',
  '/profile': 'Profile',
}

const HIDDEN_LARGE_TITLE = new Set(['/', '/profile'])

const FIT_TO_SCREEN = new Set(['/trips'])

export const TAB_BAR_SPACER = 'h-[calc(84px+env(safe-area-inset-bottom))]'

interface AppShellProps {
  children: ReactNode
}

export function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)
  const headerRef = useRef<HTMLElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const barRowRef = useRef<HTMLDivElement | null>(null)
  const scrollportRef = useRef<HTMLDivElement | null>(null)
  const pathname = usePathname()
  const title = ROUTE_TITLES[pathname] ?? 'FreightProof'
  const largeTitleHidden = HIDDEN_LARGE_TITLE.has(pathname)
  const fitToScreen = FIT_TO_SCREEN.has(pathname)

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const titleEl = titleRef.current
    const headerEl = headerRef.current
    if (!titleEl || !headerEl || largeTitleHidden) return
    const titleMidline = titleEl.offsetTop + titleEl.offsetHeight / 2
    const barBottom = headerEl.offsetHeight + (barRowRef.current?.offsetHeight ?? 0)
    setCollapsed(event.currentTarget.scrollTop > Math.max(0, titleMidline - barBottom))
  }, [largeTitleHidden])

  useLayoutEffect(() => {
    setCollapsed(false)
    const scrollport = scrollportRef.current
    if (!scrollport) return
    scrollport.style.overflowY = 'hidden'
    scrollport.scrollTop = 0
    const frame = window.requestAnimationFrame(() => {
      scrollport.style.overflowY = ''
    })
    return () => {
      window.cancelAnimationFrame(frame)
      scrollport.style.overflowY = ''
    }
  }, [pathname])

  return (
    <>
      <div
        ref={scrollportRef}
        onScroll={handleScroll}
        className={cn('h-dvh overflow-y-auto overscroll-contain', fitToScreen && 'flex flex-col')}
      >

        <header ref={headerRef} className="sticky top-0 z-sticky pt-safe">
          <div
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-0 top-0 border-b transition-[height,background-color,border-color] duration-200',
              collapsed ? 'glass-nav h-[calc(100%+2.75rem)] border-outline-variant/40' : 'h-full border-transparent bg-surface',
            )}
          />
          <div className="relative">
            <OfflineBanner />
          </div>
          {!largeTitleHidden && (
            <div className="relative h-0">
              <div ref={barRowRef} className="pointer-events-none absolute inset-x-0 top-0 flex h-11 items-center justify-center px-4">
                <p
                  aria-hidden={!collapsed}
                  className={cn(
                    'text-headline text-surface-on transition-opacity duration-200',
                    collapsed ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {title}
                </p>
              </div>
            </div>
          )}
        </header>

        <h1 ref={titleRef} className={cn(largeTitleHidden ? 'sr-only' : 'px-4 pt-2 text-large-title text-surface-on')}>
          {title}
        </h1>

        <div className={cn(fitToScreen ? 'flex min-h-0 flex-1 flex-col [&>*]:flex [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex-col' : 'pb-32')}>{children}</div>
      </div>

      <BottomNav />
    </>
  )
}
