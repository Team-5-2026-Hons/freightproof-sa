'use client'

import { Ic } from './Ic'
import { cn } from '@shared/lib/utils/cn'

interface SearchFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  /** Screen-reader name; defaults to the placeholder, which already says what is searched. */
  ariaLabel?: string
  className?: string
}

/** The list pages' search box. One skin so every list reads as the same product. */
export function SearchField({ value, onChange, placeholder, ariaLabel, className }: SearchFieldProps) {
  return (
    <div className={cn('relative min-w-[220px] max-w-sm flex-1', className)}>
      <Ic n="search" s={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-outline-v" />
      <input
        type="search"
        aria-label={ariaLabel ?? placeholder}
        placeholder={placeholder}
        value={value}
        onChange={event => onChange(event.target.value)}
        // The native clear button is hidden: it only exists in some browsers, so it would make
        // the control differ between them.
        className="w-full rounded-md border border-outline-v/30 bg-surf-low py-2 pl-8 pr-4 text-[13px] text-on-surf outline-none transition-colors placeholder:text-on-surf-v/60 focus:border-sec focus:bg-surf-lowest [&::-webkit-search-cancel-button]:appearance-none"
      />
    </div>
  )
}
