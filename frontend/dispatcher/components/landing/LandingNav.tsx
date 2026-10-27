'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { useAuth } from '@/lib/hooks/useAuth'
import { ROUTES } from '@/lib/constants/routes'
import { SECTIONS } from '@/lib/landing/content'
import { cn } from '@shared/lib/utils/cn'
import { CtaLink } from './CtaLink'
import { Logo } from './Logo'

const NAV_LINKS = [
  { label: 'How it works', hash: SECTIONS.journey },
  { label: 'Why it matters', hash: SECTIONS.why },
  { label: 'About', hash: SECTIONS.about },
] as const

interface LandingNavProps {
  onLanding?: boolean
}

export function LandingNav({ onLanding = false }: LandingNavProps) {
  const { user } = useAuth()
  const menuId = useId()
  const headerRef = useRef<HTMLElement>(null)
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    const onPointer = (e: PointerEvent) => {
      if (!headerRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [menuOpen])

  const sectionHref = (hash: string) => (onLanding ? `#${hash}` : `${ROUTES.landing}#${hash}`)
  const account = user
    ? { href: ROUTES.home, label: 'Open dashboard' }
    : { href: ROUTES.login, label: 'Sign in' }

  return (
    <header
      ref={headerRef}
      className={cn(
        'sticky top-0 z-sticky border-b bg-surf transition-[border-color,box-shadow] duration-300',
        scrolled || menuOpen ? 'border-outline-v/40 shadow-level-1' : 'border-transparent',
      )}
    >
      <nav aria-label="Main" className="mx-auto flex h-[64px] max-w-[1240px] items-center justify-between gap-[12px] px-[16px] md:h-[72px] md:px-[32px]">
        <Link href={ROUTES.landing} aria-label="FreightProof home" className="-m-1 rounded-md p-1">
          <Logo size={30} showRegion={false} className="md:hidden" />
          <Logo size={34} showRegion={false} className="hidden md:inline-flex" />
        </Link>

        <ul className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map(link => (
            <li key={link.hash}>
              <a
                href={sectionHref(link.hash)}
                className="rounded-md px-3 py-2 text-[14px] font-medium text-on-surf-v transition-colors hover:bg-surf-high/60 hover:text-on-surf"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex shrink-0 items-center gap-[6px] sm:gap-[8px]">
          <CtaLink href={account.href} variant="quiet" size="sm" className="hidden md:inline-flex">
            {account.label}
          </CtaLink>
          <CtaLink href={sectionHref(SECTIONS.access)} size="sm" className="hidden min-[375px]:inline-flex">
            Request access
          </CtaLink>
          <button
            type="button"
            className="grid h-[44px] w-[44px] place-items-center rounded-md text-on-surf transition-[background-color,transform] duration-150 hover:bg-surf-high/60 active:scale-[0.94] md:hidden"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen(open => !open)}
          >
            {menuOpen ? <X className="h-[20px] w-[20px]" /> : <Menu className="h-[20px] w-[20px]" />}
          </button>
        </div>
      </nav>

      <div
        id={menuId}
        inert={!menuOpen}
        className={cn(
          'absolute inset-x-0 top-full border-b border-outline-v/40 bg-surf shadow-level-4 md:hidden',
          'transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          menuOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
        )}
      >
        <ul className="px-4 py-3">
          {NAV_LINKS.map(link => (
            <li key={link.hash}>
              <a
                href={sectionHref(link.hash)}
                onClick={() => setMenuOpen(false)}
                className="flex min-h-[48px] items-center border-b border-outline-v/30 text-[1.0625rem] font-semibold text-on-surf"
              >
                {link.label}
              </a>
            </li>
          ))}
          <li className="min-[375px]:hidden">
            <a
              href={sectionHref(SECTIONS.access)}
              onClick={() => setMenuOpen(false)}
              className="flex min-h-[48px] items-center border-b border-outline-v/30 text-[1.0625rem] font-semibold text-on-surf"
            >
              Request access
            </a>
          </li>
          <li>
            <Link
              href={account.href}
              onClick={() => setMenuOpen(false)}
              className="flex min-h-[48px] items-center text-[1.0625rem] font-semibold text-sec"
            >
              {account.label}
            </Link>
          </li>
        </ul>
      </div>
    </header>
  )
}
