'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@shared/lib/utils/cn'
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
        className={cn(
          'flex items-center gap-1.5 rounded-xl px-3 py-3 text-sm font-medium text-surface-on',
          'bg-surface-container-low border border-outline-variant/30',
          'focus:outline-none focus:border-secondary focus:bg-surface-container-lowest',
          'transition-colors duration-150 min-h-[44px]',
        )}
      >
        <span aria-hidden="true">{value.flag}</span>
        <span>{value.dialCode}</span>
        <ChevronDown className="w-3.5 h-3.5 text-surface-on-variant" />
      </button>

      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute z-10 mt-1 w-64 max-h-72 overflow-y-auto rounded-xl',
            'bg-surface-container-lowest border border-outline-variant/30 shadow-ambient',
          )}
        >
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search country or code"
            className={cn(
              'w-full px-4 py-3 text-sm bg-transparent text-surface-on',
              'placeholder:text-surface-on-variant/50',
              'border-b border-outline-variant/30 focus:outline-none',
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
