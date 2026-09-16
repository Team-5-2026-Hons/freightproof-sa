'use client'

import { useId, type KeyboardEvent } from 'react'

import { cn } from '@shared/lib/utils/cn'

export interface RadioOption<T extends string> {
  value: T
  label: string
  /** Shown but not selectable. */
  disabled?: boolean
  /** Why it can't be chosen, shown as the option's tooltip. */
  disabledReason?: string
}

interface RadioToggleProps<T extends string> {
  /** The group's name. Shown as a caption only when showLabel is on; always the accessible name. */
  label: string
  /** Off inside a card header, where a caption would crowd the title row (spec §7.7 item 5). */
  showLabel?: boolean
  value: T
  options: readonly RadioOption<T>[]
  onChange: (value: T) => void
}

/** A small segmented radio group: View by, Departures | Arrivals. A radio group rather than
 *  Tabs, because it regroups the same charts instead of switching to another view (spec §7.2).
 *  Arrow keys move among the enabled options, so the group is one stop in the tab order. */
export function RadioToggle<T extends string>({ label, showLabel = true, value, options, onChange }: RadioToggleProps<T>) {
  const labelId = useId()
  const optionId = (option: T): string => `${labelId}-${option}`
  const enabled = options.filter((option) => !option.disabled).map((option) => option.value)

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    const back = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    if ((!forward && !back) || enabled.length === 0) return
    event.preventDefault()
    const index = Math.max(0, enabled.indexOf(value))
    const next = enabled[(index + (forward ? 1 : -1) + enabled.length) % enabled.length]
    onChange(next)
    document.getElementById(optionId(next))?.focus()
  }

  return (
    <div className="flex flex-col gap-1.5">
      {showLabel && <span id={labelId} className="text-xs font-bold uppercase tracking-wider text-on-surf-v">{label}</span>}
      <div
        role="radiogroup"
        aria-labelledby={showLabel ? labelId : undefined}
        aria-label={showLabel ? undefined : label}
        className="flex gap-1 rounded-[10px] bg-surf-low p-1"
      >
        {options.map((option) => {
          const isChecked = option.value === value
          const isDisabled = option.disabled === true
          return (
            <button
              key={option.value}
              id={optionId(option.value)}
              type="button"
              role="radio"
              aria-checked={isChecked}
              aria-disabled={isDisabled || undefined}
              tabIndex={isChecked ? 0 : -1}
              title={isDisabled ? option.disabledReason : undefined}
              onClick={() => { if (!isDisabled) onChange(option.value) }}
              onKeyDown={onKeyDown}
              className={cn(
                'min-h-[36px] rounded-md px-4 text-[12px] font-[700] transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sec',
                isChecked && 'bg-surf-lowest text-on-surf shadow-level-1',
                !isChecked && !isDisabled && 'text-on-surf-v hover:bg-surf-high/60 hover:text-on-surf',
                isDisabled && 'cursor-not-allowed text-on-surf-v/40',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
