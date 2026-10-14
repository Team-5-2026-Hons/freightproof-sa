'use client'

import { Ic } from './Ic'
import { cn } from '@shared/lib/utils/cn'

export interface FilterOption<V extends string> { value: V; label: string }

interface FilterSelectProps<V extends string> {
  value: V
  onChange: (value: V) => void
  options: readonly FilterOption<V>[]
  /** Visible text is the selected option, so the control needs an explicit name. */
  ariaLabel: string
  className?: string
}

/** A native select in the list pages' filter skin. Native on purpose: keyboard, mobile and
 *  screen-reader behaviour come for free. */
export function FilterSelect<V extends string>({ value, onChange, options, ariaLabel, className }: FilterSelectProps<V>) {
  return (
    <div className={cn('relative shrink-0', className)}>
      <select
        aria-label={ariaLabel}
        value={value}
        // The option values are the caller's own V, so narrowing the DOM string back is safe.
        onChange={event => onChange(event.target.value as V)}
        className="appearance-none rounded-md border border-outline-v/30 bg-surf-low py-2 pl-3 pr-8 text-[13px] text-on-surf outline-none transition-colors focus:border-sec focus:bg-surf-lowest"
      >
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <Ic n="chev" s={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90 text-on-surf-v" />
    </div>
  )
}
