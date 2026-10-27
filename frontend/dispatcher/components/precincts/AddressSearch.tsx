'use client'

import React, { useEffect, useId, useRef, useState } from 'react'

import { cn } from '@shared/lib/utils/cn'
import {
  ADDRESS_QUERY_MIN_LENGTH,
  searchAddresses,
  type AddressSuggestion,
} from '@/lib/geocode/photon'

export const ADDRESS_SEARCH_DEBOUNCE_MS = 350

type SearchStatus = 'idle' | 'loading' | 'done' | 'error'

interface AddressSearchProps {
  /** Called with the picked place. The caller moves the map and fills the address. */
  onSelect: (suggestion: AddressSuggestion) => void
}

/**
 * Search-as-you-type over South African addresses (WAI-ARIA combobox pattern). Picking a
 * result only positions the map — the dispatcher still confirms the pin on the gate.
 */
export function AddressSearch({ onSelect }: AddressSearchProps): React.JSX.Element {
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<AddressSuggestion[]>([])
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (searchTerm === '') return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setStatus('loading')
      searchAddresses(searchTerm, controller.signal)
        .then((found) => {
          setResults(found)
          setStatus('done')
          setActiveIndex(found.length > 0 ? 0 : -1)
          setOpen(true)
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          console.warn('[AddressSearch] search failed', err)
          setResults([])
          setStatus('error')
          setOpen(true)
        })
    }, ADDRESS_SEARCH_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [searchTerm])

  function handleChange(value: string): void {
    setQuery(value)
    if (value.trim().length < ADDRESS_QUERY_MIN_LENGTH) {
      setSearchTerm('')
      setResults([])
      setStatus('idle')
      return
    }
    setSearchTerm(value)
  }

  useEffect(() => {
    function handlePointerDown(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [])

  function pick(suggestion: AddressSuggestion): void {
    setQuery(suggestion.detail ? `${suggestion.label}, ${suggestion.detail}` : suggestion.label)
    setOpen(false)
    setResults([])
    setStatus('idle')
    onSelect(suggestion)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      pick(results[activeIndex])
    }
  }

  const showPanel = open && (status === 'done' || status === 'error')
  const optionId = (index: number): string => `${listboxId}-option-${index}`

  return (
    <div ref={containerRef} className="relative flex flex-col gap-1">
      <label htmlFor={`${listboxId}-input`} className="text-xs font-medium text-surface-on-variant">
        Search address
      </label>
      <input
        id={`${listboxId}-input`}
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (results.length > 0) setOpen(true) }}
        onKeyDown={handleKeyDown}
        placeholder="Street, suburb or place name"
        className={cn(
          'border border-outline-variant rounded-lg px-3 py-2 text-sm bg-surface-container-lowest',
          'text-surface-on focus:outline-none focus:ring-2 focus:ring-primary',
        )}
      />
      <span className="text-[11px] text-on-surf-v" aria-live="polite">
        {status === 'loading'
          ? 'Searching…'
          : 'Moves the pin there and fills in the address. Then click the gate to place the pin exactly.'}
      </span>

      {showPanel && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address results"
          className="absolute left-0 right-0 top-[4.25rem] z-[600] max-h-72 overflow-y-auto rounded-lg bg-surf-lowest shadow-level-2 border border-outline-v/30 py-1"
        >
          {status === 'error' && (
            <li className="px-3 py-2 text-xs text-error">
              Address search is unavailable. Click the map or paste coordinates instead.
            </li>
          )}
          {status === 'done' && results.length === 0 && (
            <li className="px-3 py-2 text-xs text-on-surf-v">No matches in South Africa.</li>
          )}
          {results.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => { e.preventDefault(); pick(suggestion) }}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn(
                'cursor-pointer px-3 py-2 flex flex-col',
                index === activeIndex && 'bg-surf-low',
              )}
            >
              <span className="text-sm text-on-surf">{suggestion.label}</span>
              {suggestion.detail !== null && (
                <span className="text-[11px] text-on-surf-v">{suggestion.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
