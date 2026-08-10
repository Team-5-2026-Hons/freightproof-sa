'use client'

import { useEffect, useRef, useState } from 'react'
import { Ic } from '@/components/ui/Ic'
import { cn } from '@shared/lib/utils/cn'

export interface SearchSelectOption {
  value: string
  label: string
  sublabel?: string
}

interface Props {
  options: SearchSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  error?: boolean
}

// Matches the underline field style used across the trip wizard.
const inputCls =
  'w-full bg-surf-low border-0 border-b-2 border-outline-v rounded-t-sm ' +
  'px-3 py-[10px] text-[14px] text-on-surf font-[Inter,sans-serif] ' +
  'outline-none focus:bg-sec-c focus:border-sec transition-all duration-150'

export function SearchSelect({
  options, value, onChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  disabled = false,
  error = false,
}: Props) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const containerRef          = useRef<HTMLDivElement>(null)
  const searchRef             = useRef<HTMLInputElement>(null)

  const selected = options.find(o => o.value === value)

  const filtered = query.trim()
    ? options.filter(o =>
        o.label.toLowerCase().includes(query.toLowerCase()) ||
        o.sublabel?.toLowerCase().includes(query.toLowerCase()),
      )
    : options

  function openDropdown() {
    if (disabled) return
    setOpen(true)
    setQuery('')
    // Focus the search input after paint
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  function select(opt: SearchSelectOption) {
    onChange(opt.value)
    setOpen(false)
    setQuery('')
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setOpen(false)
  }

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger — shows selected label or placeholder */}
      <button
        type="button"
        onClick={openDropdown}
        disabled={disabled}
        className={cn(
          inputCls,
          'flex items-center justify-between cursor-pointer text-left',
          error && !value && 'border-err',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span className={selected ? 'text-on-surf' : 'text-on-surf-v'}>
          {selected?.label ?? placeholder}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {value && (
            <span
              role="button"
              onClick={clear}
              className="text-on-surf-v hover:text-on-surf transition-colors text-[16px] leading-none"
            >
              ×
            </span>
          )}
          <Ic n="chev" s={12} className={cn('text-on-surf-v transition-transform duration-150', open && 'rotate-90')} />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-surf-lowest rounded-lg shadow-level-5 overflow-hidden">
          {/* Search input */}
          <div className="px-3 py-2 border-b border-outline-v/20">
            <div className="flex items-center gap-2">
              <Ic n="search" s={13} className="text-on-surf-v shrink-0" />
              <input
                ref={searchRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="flex-1 bg-transparent text-[13px] text-on-surf outline-none placeholder:text-on-surf-v"
              />
            </div>
          </div>

          {/* Options list */}
          <div className="max-h-[220px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-[13px] text-on-surf-v">No results</div>
            ) : (
              filtered.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => select(opt)}
                  className={cn(
                    'w-full flex items-start gap-3 px-4 py-[10px] text-left',
                    'transition-colors duration-100 hover:bg-sec-c',
                    opt.value === value && 'bg-sec-c',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-[500] text-on-surf truncate">{opt.label}</div>
                    {opt.sublabel && (
                      <div className="text-[11px] text-on-surf-v mt-[1px] truncate">{opt.sublabel}</div>
                    )}
                  </div>
                  {opt.value === value && (
                    <Ic n="check" s={13} className="text-sec shrink-0 mt-[1px]" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
