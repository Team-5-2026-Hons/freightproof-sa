'use client'

import type { ReactNode } from 'react'
import { Button } from './Button'

interface ListToolbarProps {
  children: ReactNode
  hasActiveFilters?: boolean
  onClear?: () => void
}

/** The row of list controls above a table. Same spacing and wrapping on every page. */
export function ListToolbar({ children, hasActiveFilters = false, onClear }: ListToolbarProps) {
  return (
    <div role="search" className="flex shrink-0 flex-wrap items-center gap-3 px-6 py-3">
      {children}
      {hasActiveFilters && onClear && <Button size="sm" variant="ghost" onClick={onClear}>Clear filters</Button>}
    </div>
  )
}
