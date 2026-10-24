'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { COUNTRY_CODES, type CountryCode } from '@/lib/constants/country-codes'

interface CountryCodeSelectProps {
  value: CountryCode
  onChange: (country: CountryCode) => void
  className?: string
}

// Flag + dial-code dropdown for the login phone field, matching the country
// picker pattern used by Google/WhatsApp sign-in. No new dependency — built
// on the country list in lib/constants/country-codes.ts.
export function CountryCodeSelect({ value, onChange, className }: CountryCodeSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handleOutsideClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const filtered = COUNTRY_CODES.filter((country) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return country.name.toLowerCase().includes(q) || country.dialCode.includes(q)
  })

  function handleSelect(country: CountryCode) {
    onChange(country)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        // Same filled, borderless 56px field as the number beside it on the sign-in
        // screen: the pair reads as one phone-number control split in two.
        className={cn(
          'flex h-14 items-center gap-2 rounded-2xl px-4 text-body font-medium tabular-nums text-surface-on',
          'bg-surface-container-high',
          'outline-none ring-inset focus:ring-2 focus:ring-surface-on/40',
          'transition-shadow duration-150',
        )}
      >
        <span aria-hidden="true" className="text-title-3">{value.flag}</span>
        <span>{value.dialCode}</span>
        <ChevronDown className="h-4 w-4 text-surface-on-variant" aria-hidden />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute z-10 mt-1 w-64 max-h-72 overflow-y-auto rounded-xl',
            'bg-card border border-input shadow-ambient',
          )}
        >
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search country or code"
            className={cn(
              // 16px+ so iOS doesn't zoom.
              'w-full px-4 py-3 text-base bg-transparent text-foreground',
              'placeholder:text-muted-foreground/80',
              'border-b border-input focus:outline-none',
            )}
          />
          <ul>
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm text-surface-on-variant">No matches</li>
            ) : (
              filtered.map((country) => (
                <li key={country.iso}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={country.iso === value.iso}
                    onClick={() => handleSelect(country)}
                    className={cn(
                      'w-full flex items-center gap-2 px-4 py-2.5 text-sm text-left text-surface-on',
                      'hover:bg-surface-container-low transition-colors duration-100',
                      country.iso === value.iso && 'bg-surface-container-low font-semibold',
                    )}
                  >
                    <span aria-hidden="true">{country.flag}</span>
                    <span className="flex-1">{country.name}</span>
                    <span className="text-surface-on-variant">{country.dialCode}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
