'use client'

import { useEffect, useId, useRef, useState, type JSX } from 'react'
import Link from 'next/link'
import { LogOut, UserRound } from 'lucide-react'
import { LiveBadge } from '@/components/layout/LiveBadge'
import { useAuth } from '@/lib/hooks/useAuth'
import { ROUTES } from '@/lib/constants/routes'
import { SETTINGS_SECTION_IDS } from '@/lib/settings/section-query'
import { initialsOf, roleLabel } from '@/lib/format/dispatcher-identity'
import { cn } from '@shared/lib/utils/cn'

const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-white/40'
const MENU_ITEM = 'flex w-full items-center gap-2.5 rounded-md px-3 h-9 text-[13px] text-left text-on-surf transition-colors hover:bg-surf-low outline-none focus-visible:ring-2 focus-visible:ring-sec'

interface Props {
  collapsed?: boolean
  /** Closes the mobile drawer when a menu item navigates away. */
  onClose?: () => void
}

/**
 * The signed-in row at the foot of the sidebar. It is the one place the dispatcher's identity
 * is shown, so it is also where leaving lives: pressing it opens a small menu above the row
 * with View profile (Settings > Account) and Log out. Log out signs out at once, with no
 * confirmation, as the menu is itself the deliberate step; AppLayout then returns to /login.
 */
export function ProfileMenu({ collapsed = false, onClose }: Props): JSX.Element {
  const { user, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLAnchorElement>(null)
  const displayName = user?.full_name ?? 'Dispatcher'

  useEffect(() => {
    if (!open) return

    function onPointerDown(event: MouseEvent): void {
      if (event.target instanceof Node && wrapperRef.current?.contains(event.target)) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    firstItemRef.current?.focus()
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function viewProfile(): void {
    setOpen(false)
    onClose?.()
  }

  function logOut(): void {
    setOpen(false)
    signOut().catch((error: unknown) => console.error('ProfileMenu: sign-out failed', error))
  }

  return (
    <div ref={wrapperRef} className="relative mt-2">
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account"
          className="absolute bottom-full left-0 z-overlay mb-2 w-56 rounded-lg bg-surf-lowest p-1.5 shadow-level-5"
        >
          <Link
            ref={firstItemRef}
            href={ROUTES.settingsSection(SETTINGS_SECTION_IDS.account)}
            role="menuitem"
            onClick={viewProfile}
            className={MENU_ITEM}
          >
            <UserRound aria-hidden className="h-4 w-4" />
            View profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={logOut}
            className={MENU_ITEM}
          >
            <LogOut aria-hidden className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}

      <div className={cn('flex flex-col gap-2', collapsed ? 'items-center' : 'px-1')}>
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-label={collapsed ? `${displayName}, account menu` : undefined}
          title={collapsed ? displayName : undefined}
          onClick={() => setOpen(isOpen => !isOpen)}
          className={cn(
            'flex items-center gap-2.5 min-w-0 rounded-lg text-left transition-colors hover:bg-white/[0.08]',
            collapsed ? 'p-1' : 'w-full px-2 py-1.5',
            open && 'bg-white/[0.08]',
            FOCUS_RING,
          )}
        >
          <span className="relative shrink-0">
            <span
              aria-hidden
              className="w-8 h-8 rounded-full bg-white/10 ring-1 ring-white/10 flex items-center justify-center text-[12px] font-[600] text-white/85"
            >
              {initialsOf(user?.full_name)}
            </span>
            {collapsed && <LiveBadge compact className="absolute -bottom-0.5 -right-0.5" />}
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block text-[13px] font-[500] text-white/90 leading-tight truncate">{displayName}</span>
              <span className="block text-[11px] text-white/45 leading-tight truncate">{roleLabel(user?.role)}</span>
            </span>
          )}
        </button>
        {!collapsed && <div className="px-2"><LiveBadge /></div>}
      </div>
    </div>
  )
}
